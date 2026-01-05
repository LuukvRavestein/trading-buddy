/**
 * Strategy Optimizer
 * 
 * Runs grid search over strategy parameter combinations and ranks by performance.
 */

import { runBacktest } from './backtestEngine.mjs';
import { createOptimizerRun, updateOptimizerRun, saveOptimizerTopConfigs, saveOptimizerAllConfigs, saveOptimizerOOSResults } from '../db/supabaseClient.js';
import { addMinutesISO, addDaysISO, setEndOfDayISO, normalizeISO } from '../utils/time.mjs';

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
  
  // Create optimizer run record
  let optimizerRunId = null;
  try {
    const run = await createOptimizerRun({
      symbol,
      train_start_ts: normalizeISO(startTs),
      train_end_ts: normalizeISO(endTs),
      dd_limit: DD_LIMIT,
      total_configs: 0, // Will update after configs are generated
      valid_configs: 0, // Will update after filtering
    });
    optimizerRunId = run.id;
    if (optimizerRunId) {
      console.log(`[optimizer] Created optimizer run: ${optimizerRunId}`);
    }
  } catch (error) {
    console.warn(`[optimizer] Failed to create optimizer run (continuing):`, error.message);
  }
  
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
  
  // Update optimizer run with final counts
  if (optimizerRunId) {
    console.log(`[optimizer] Updating optimizer run ${optimizerRunId} with counts: total=${results.length}, valid=${validResults.length}`);
    try {
      await updateOptimizerRun(optimizerRunId, results.length, validResults.length);
      console.log(`[optimizer] ✓ Successfully updated optimizer run ${optimizerRunId}`);
    } catch (error) {
      console.error(`[optimizer] ✗ Failed to update optimizer run counts:`, error);
    }
  } else {
    console.warn(`[optimizer] Cannot update optimizer run: optimizerRunId is null`);
  }
  
  // Save top 10 configs to database
  if (optimizerRunId && top10.length > 0) {
    console.log(`[optimizer] Saving ${top10.length} top configs to database for run ${optimizerRunId}`);
    try {
      await saveOptimizerTopConfigs(optimizerRunId, top10);
      console.log(`[optimizer] ✓ Successfully saved ${top10.length} top configs for run ${optimizerRunId}`);
    } catch (error) {
      console.error(`[optimizer] ✗ Failed to save top configs:`, error);
    }
  } else {
    if (!optimizerRunId) {
      console.warn(`[optimizer] Cannot save top configs: optimizerRunId is null`);
    }
    if (top10.length === 0) {
      console.warn(`[optimizer] Cannot save top configs: top10 array is empty`);
    }
  }
  
  // Optionally save all valid configs
  if (optimizerRunId && process.env.SAVE_ALL_CONFIGS === 'true' && validResults.length > 0) {
    try {
      await saveOptimizerAllConfigs(optimizerRunId, validResults);
    } catch (error) {
      console.warn(`[optimizer] Failed to save all configs (continuing):`, error.message);
    }
  }
  
  // Run out-of-sample backtests for top N configs
  if (optimizerRunId && top10.length > 0) {
    try {
      await runOutOfSampleTests({ symbol, trainEndTs: endTs, top10, optimizerRunId });
    } catch (error) {
      console.warn(`[optimizer] Failed to run OOS tests (continuing):`, error.message);
    }
  }
  
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

/**
 * Run out-of-sample backtests for top N configs
 * 
 * @param {object} options
 * @param {string} options.symbol
 * @param {string} options.trainEndTs - Training period end timestamp
 * @param {Array<object>} options.top10 - Top 10 configs from training
 * @param {string} options.optimizerRunId - Optimizer run ID
 * @returns {Promise<void>}
 */
async function runOutOfSampleTests({ symbol, trainEndTs, top10, optimizerRunId }) {
  // Determine OOS range
  let oosStartTs, oosEndTs;
  
  if (process.env.OOS_START_TS && process.env.OOS_END_TS) {
    // Use explicit OOS range
    oosStartTs = normalizeISO(process.env.OOS_START_TS);
    oosEndTs = normalizeISO(process.env.OOS_END_TS);
  } else {
    // Calculate OOS range: start 1 minute after trainEndTs, end after OOS_DAYS days
    const oosDays = parseInt(process.env.OOS_DAYS || '7', 10);
    oosStartTs = addMinutesISO(normalizeISO(trainEndTs), 1);
    const oosEndDate = addDaysISO(oosStartTs, oosDays);
    oosEndTs = setEndOfDayISO(oosEndDate);
  }
  
  const topN = parseInt(process.env.OOS_TOP_N || '3', 10);
  const configsToTest = top10.slice(0, Math.min(topN, top10.length));
  
  console.log(`[optimizer] Running OOS tests for top ${configsToTest.length} configs:`, {
    oosStartTs,
    oosEndTs,
    symbol,
  });
  
  const oosResults = [];
  
  for (let i = 0; i < configsToTest.length; i++) {
    const configItem = configsToTest[i];
    const rank = i + 1;
    
    console.log(`[optimizer] OOS test ${i + 1}/${configsToTest.length} (rank ${rank}):`, {
      config: configItem.config,
      trainMetrics: {
        pnl: configItem.metrics.total_pnl_pct.toFixed(2),
        dd: configItem.metrics.max_drawdown_pct.toFixed(2),
        pf: configItem.metrics.profit_factor.toFixed(2),
        trades: configItem.metrics.trades,
      },
    });
    
    try {
      const oosResult = await runBacktest({
        symbol,
        startTs: oosStartTs,
        endTs: oosEndTs,
        config: configItem.config,
      });
      
      const oosMetrics = oosResult.metrics;
      const oosPrimaryScore = calculatePrimaryScore(oosMetrics);
      
      oosResults.push({
        rank,
        symbol,
        test_start_ts: oosStartTs,
        test_end_ts: oosEndTs,
        config: configItem.config,
        metrics: oosMetrics,
        primaryScore: oosPrimaryScore,
      });
      
      // Log comparison
      console.log(`[optimizer] OOS test ${i + 1} complete (rank ${rank}):`);
      console.log(`[optimizer]   Train: PnL=${configItem.metrics.total_pnl_pct.toFixed(2)}%, DD=${configItem.metrics.max_drawdown_pct.toFixed(2)}%, PF=${configItem.metrics.profit_factor.toFixed(2)}, Trades=${configItem.metrics.trades}`);
      console.log(`[optimizer]   OOS:   PnL=${oosMetrics.total_pnl_pct.toFixed(2)}%, DD=${oosMetrics.max_drawdown_pct.toFixed(2)}%, PF=${oosMetrics.profit_factor.toFixed(2)}, Trades=${oosMetrics.trades}`);
    } catch (error) {
      console.error(`[optimizer] OOS test ${i + 1} (rank ${rank}) failed:`, error.message);
      // Continue with other configs
    }
  }
  
  // Save OOS results
  if (optimizerRunId && oosResults.length > 0) {
    try {
      await saveOptimizerOOSResults(optimizerRunId, oosResults);
    } catch (error) {
      console.warn(`[optimizer] Failed to save OOS results (continuing):`, error.message);
    }
  }
  
  console.log(`[optimizer] OOS testing complete: ${oosResults.length}/${configsToTest.length} configs tested`);
}

