/**
 * Strategy Optimizer
 * 
 * Runs grid search over strategy parameter combinations and ranks by performance.
 */

import { runBacktest } from './backtestEngine.mjs';

const DD_LIMIT = parseFloat(process.env.DD_LIMIT || '10', 10); // Default 10% max drawdown

/**
 * Generate grid of configs to test
 */
function generateConfigGrid() {
  const configs = [];
  
  // Regime options
  const require5mAlign = [false, true];
  const enablePullbackTrades = [false, true];
  const require60mAlign = [false, true];
  
  // Entry options
  const entryTrigger = ['choch', 'bos', 'either'];
  const requireChochOnPullback = [false, true];
  
  // Exit options
  const rrTarget = [1.5, 2.0, 2.5];
  const timeoutMin = [0, 30, 45];
  
  // Risk options
  const slAtrBuffer = [0.2, 0.3];
  const minRiskPct = [0.001, 0.0015];
  
  // Costs (fixed for now, can be varied)
  const takerFeeBps = 5; // 0.05%
  const slippageBps = 2; // 0.02%
  
  // Generate all combinations (reduced grid for performance)
  // For full grid, uncomment all combinations
  for (const req5m of require5mAlign) {
    for (const req60m of require60mAlign) {
      for (const entryTrig of entryTrigger) {
        for (const rr of rrTarget) {
          for (const slBuf of slAtrBuffer) {
            // Reduced grid: skip some combinations
            if (req5m && req60m) continue; // Skip if both required (too restrictive)
            if (entryTrig === 'choch' && req5m) continue; // Skip redundant combinations
            
            configs.push({
              // Regime
              require_5m_align: req5m,
              enable_pullback_trades: false, // Simplified for v1
              require_60m_align: req60m,
              
              // Entry
              entry_trigger: entryTrig,
              require_choch_on_pullback: false, // Simplified for v1
              
              // Exits
              rr_target: rr,
              timeout_min: timeoutMin[0], // Use 0 for now (no timeout)
              
              // Risk
              sl_atr_buffer: slBuf,
              min_risk_pct: minRiskPct[0], // Use 0.1% for now
              
              // Costs
              taker_fee_bps: takerFeeBps,
              slippage_bps: slippageBps,
            });
          }
        }
      }
    }
  }
  
  console.log(`[optimizer] Generated ${configs.length} config combinations`);
  return configs;
}

/**
 * Run optimizer
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol (e.g., 'BTC-PERPETUAL')
 * @param {string} options.startTs - Start timestamp (ISO)
 * @param {string} options.endTs - End timestamp (ISO)
 * @returns {Promise<Array>} Top 10 configs ranked by score
 */
export async function runOptimizer({ symbol, startTs, endTs }) {
  console.log(`[optimizer] Starting optimizer for ${symbol} from ${startTs} to ${endTs}`);
  console.log(`[optimizer] Max drawdown limit: ${DD_LIMIT}%`);
  
  const configs = generateConfigGrid();
  const results = [];
  
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    console.log(`[optimizer] Running backtest ${i + 1}/${configs.length}: ${JSON.stringify(config)}`);
    
    try {
      const result = await runBacktest({ symbol, startTs, endTs, config });
      
      const metrics = result.metrics;
      const primaryScore = calculatePrimaryScore(metrics);
      
      results.push({
        config,
        runId: result.runId,
        metrics,
        primaryScore,
      });
      
      console.log(`[optimizer] Config ${i + 1} complete: trades=${metrics.trades}, winrate=${(metrics.winrate * 100).toFixed(1)}%, pnl=${metrics.total_pnl_pct.toFixed(2)}%, dd=${metrics.max_drawdown_pct.toFixed(2)}%, score=${primaryScore.toFixed(2)}`);
    } catch (error) {
      console.error(`[optimizer] Config ${i + 1} failed:`, error.message);
      results.push({
        config,
        runId: null,
        metrics: null,
        primaryScore: -Infinity,
        error: error.message,
      });
    }
  }
  
  // Filter by drawdown limit and rank
  const validResults = results.filter(r => 
    r.metrics && r.metrics.max_drawdown_pct <= DD_LIMIT
  );
  
  // Sort by primary score (descending)
  validResults.sort((a, b) => b.primaryScore - a.primaryScore);
  
  // Get top 10
  const top10 = validResults.slice(0, 10);
  
  console.log(`[optimizer] Optimization complete: ${validResults.length} valid configs (${results.length - validResults.length} exceeded DD limit)`);
  console.log(`[optimizer] Top 10 configs:`);
  
  top10.forEach((result, idx) => {
    const m = result.metrics;
    console.log(`[optimizer] ${idx + 1}. Score: ${result.primaryScore.toFixed(2)} | Trades: ${m.trades} | Winrate: ${(m.winrate * 100).toFixed(1)}% | PnL: ${m.total_pnl_pct.toFixed(2)}% | DD: ${m.max_drawdown_pct.toFixed(2)}% | PF: ${m.profit_factor.toFixed(2)}`);
    console.log(`[optimizer]    Config: ${JSON.stringify(result.config)}`);
  });
  
  return top10;
}

/**
 * Calculate primary score for ranking
 * 
 * Uses expectancy_pct as primary metric, with constraints on drawdown.
 */
function calculatePrimaryScore(metrics) {
  if (!metrics || metrics.trades === 0) {
    return -Infinity;
  }
  
  // Primary: expectancy_pct
  // Secondary: profit_factor (if expectancy is close)
  // Penalty: if drawdown > limit, score is -Infinity (filtered out)
  
  const baseScore = metrics.expectancy_pct;
  
  // Bonus for higher profit factor
  const pfBonus = Math.min(metrics.profit_factor / 10, 0.5); // Max 0.5% bonus
  
  return baseScore + pfBonus;
}

