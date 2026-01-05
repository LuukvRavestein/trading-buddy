/**
 * Strategy Optimizer
 * 
 * Runs grid search over strategy parameter combinations and ranks by performance.
 */

import { runBacktest } from './backtestEngine.mjs';
import { createOptimizerRun, updateOptimizerRun, saveOptimizerTopConfigs, saveOptimizerAllConfigs, saveOptimizerOOSResults } from '../db/supabaseClient.js';
import { addMinutesISO, addDaysISO, setEndOfDayISO, normalizeISO } from '../utils/time.mjs';

// BUILD_FINGERPRINT: Version with DB saving enabled
const BUILD_FINGERPRINT = 'optimizer-v2-db-saving-2025-01-01';
console.log(`[optimizer] BUILD_FINGERPRINT: ${BUILD_FINGERPRINT}`);

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
  const trainStartTs = normalizeISO(startTs);
  const trainEndTs = normalizeISO(endTs);
  
  let optimizerRunId = null;
  let configs = [];
  let results = [];
  let validResults = [];
  let top10 = [];
  let totalConfigs = 0;
  let validConfigs = 0;
  
  try {
    // Create optimizer run
    console.log(`[optimizer][db] Creating optimizer run:`, {
      symbol,
      train_start_ts: trainStartTs,
      train_end_ts: trainEndTs,
      dd_limit: DD_LIMIT,
    });
    
    try {
      const { data, error } = await createOptimizerRun({
        symbol,
        train_start_ts: trainStartTs,
        train_end_ts: trainEndTs,
        dd_limit: DD_LIMIT,
        total_configs: 0, // Will update after configs are generated
        valid_configs: 0, // Will update after filtering
      });
      
      if (error) {
        throw error;
      }
      
      optimizerRunId = data?.id;
      if (!optimizerRunId) {
        throw new Error('createOptimizerRun returned null run_id');
      }
      
      console.log(`[optimizer][db] ✓ Created optimizer run: run_id=${optimizerRunId}, inserted rows: 1`);
    } catch (error) {
      console.error(`[optimizer][db] ✗ Failed to create optimizer run:`, {
        errorMessage: error.message,
        errorStack: error.stack,
      });
      throw error; // Fail fast if we can't create the run
    }
    
    // Generate configs and run backtests
    configs = generateConfigGrid();
    results = [];
    
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
        console.error(`[optimizer] Config ${i + 1} failed:`, {
          errorMessage: error.message,
          errorStack: error.stack,
        });
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
    validResults = results.filter(r => 
      r.metrics && r.metrics.max_drawdown_pct <= DD_LIMIT
    );
    
    // Sort by primary score (descending)
    validResults.sort((a, b) => b.primaryScore - a.primaryScore);
    
    // Get top 10
    top10 = validResults.slice(0, 10);
    totalConfigs = results.length;
    validConfigs = validResults.length;
    
    console.log(`[optimizer] Optimization complete:`, {
      totalConfigs,
      validConfigs,
      exceededDDLimit: results.length - validResults.length,
      top10Length: top10.length,
      run_id: optimizerRunId,
    });
    
    // Log why top10 might be empty
    if (top10.length === 0) {
      console.warn(`[optimizer] ⚠ top10 is empty:`, {
        validResultsLength: validResults.length,
        resultsLength: results.length,
        ddLimit: DD_LIMIT,
        reason: validResults.length === 0 
          ? 'No configs passed DD_LIMIT filter' 
          : 'Unknown (should not happen)',
      });
    }
    
    console.log(`[optimizer] Top 10 configs:`);
    top10.forEach((result, idx) => {
      const m = result.metrics;
      console.log(`[optimizer] ${idx + 1}. Score: ${result.primaryScore.toFixed(2)} | Trades: ${m.trades} | Winrate: ${(m.winrate * 100).toFixed(1)}% | PnL: ${m.total_pnl_pct.toFixed(2)}% | DD: ${m.max_drawdown_pct.toFixed(2)}% | PF: ${m.profit_factor.toFixed(2)}`);
      console.log(`[optimizer]    Config: ${JSON.stringify(result.config)}`);
    });
    
    // Save top 10 configs to database - execute when top10.length > 0
    if (!optimizerRunId) {
      console.warn(`[optimizer] ⚠ Cannot save top configs: optimizerRunId is null`);
    } else if (top10.length === 0) {
      console.warn(`[optimizer] ⚠ Skipping saveOptimizerTopConfigs: top10 array is empty`);
    } else {
      console.log(`[optimizer][db] Saving top configs:`, {
        run_id: optimizerRunId,
        top10Length: top10.length,
      });
      
      try {
        const { data, error } = await saveOptimizerTopConfigs(optimizerRunId, top10);
        if (error) {
          throw error;
        }
        console.log(`[optimizer][db] ✓ Saved top configs: run_id=${optimizerRunId}, inserted rows: ${data?.length || 0}`);
      } catch (error) {
        console.error(`[optimizer][db] ✗ Failed to save top configs:`, {
          run_id: optimizerRunId,
          top10Length: top10.length,
          errorMessage: error.message,
          errorStack: error.stack,
        });
        // Continue - don't crash the process
      }
    }
    
    // Optionally save all valid configs
    if (optimizerRunId && process.env.SAVE_ALL_CONFIGS === 'true' && validResults.length > 0) {
      console.log(`[optimizer][db] Saving all configs:`, {
        run_id: optimizerRunId,
        validResultsLength: validResults.length,
      });
      
      try {
        await saveOptimizerAllConfigs(optimizerRunId, validResults);
        console.log(`[optimizer][db] ✓ Saved all configs: run_id=${optimizerRunId}, inserted rows: ${validResults.length}`);
      } catch (error) {
        console.error(`[optimizer][db] ✗ Failed to save all configs:`, {
          run_id: optimizerRunId,
          validResultsLength: validResults.length,
          errorMessage: error.message,
          errorStack: error.stack,
        });
        // Continue - don't crash the process
      }
    }
    
    // Run out-of-sample backtests for top N configs
    if (optimizerRunId && top10.length > 0) {
      console.log(`[optimizer] Starting OOS backtests for top configs (runId: ${optimizerRunId})`);
      try {
        await runOutOfSampleTests({ symbol, trainEndTs: endTs, top10, optimizerRunId });
        console.log(`[optimizer] ✓ OOS backtests completed successfully`);
      } catch (error) {
        console.error(`[optimizer] ✗ Failed to run OOS tests:`, {
          errorMessage: error.message,
          errorStack: error.stack,
          optimizerRunId,
          top10Length: top10.length,
        });
        // Continue - don't crash the process
      }
    } else {
      if (!optimizerRunId) {
        console.warn(`[optimizer] ⚠ Skipping OOS tests: optimizerRunId is null`);
      }
      if (top10.length === 0) {
        console.warn(`[optimizer] ⚠ Skipping OOS tests: top10 array is empty`);
      }
    }
    
  } catch (error) {
    console.error(`[optimizer] ✗ Optimizer failed:`, {
      errorMessage: error.message,
      errorStack: error.stack,
      run_id: optimizerRunId,
    });
    // Don't throw - we'll update counts in finally
  } finally {
    // Always attempt to update optimizer run with final counts (even if some configs failed)
    if (optimizerRunId) {
      // Use results from try block, or calculate from what we have
      const finalTotalConfigs = totalConfigs || results.length || configs.length;
      const finalValidConfigs = validConfigs || validResults.length || 0;
      
      console.log(`[optimizer][db] Updating optimizer run counts:`, {
        run_id: optimizerRunId,
        total_configs: finalTotalConfigs,
        valid_configs: finalValidConfigs,
      });
      
      try {
        const { data, error } = await updateOptimizerRun(optimizerRunId, finalTotalConfigs, finalValidConfigs);
        if (error) {
          throw error;
        }
        console.log(`[optimizer][db] ✓ Updated run counts: run_id=${optimizerRunId}, total=${finalTotalConfigs}, valid=${finalValidConfigs}, updated rows: ${data?.length || 0}`);
      } catch (error) {
        console.error(`[optimizer][db] ✗ Failed to update run counts:`, {
          run_id: optimizerRunId,
          total_configs: finalTotalConfigs,
          valid_configs: finalValidConfigs,
          errorMessage: error.message,
          errorStack: error.stack,
        });
        // Continue - don't crash the process
      }
    } else {
      console.warn(`[optimizer] ⚠ Cannot update run counts: optimizerRunId is null`);
    }
    
    // Always log completion
    console.log(`[optimizer] DONE`);
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
  // Validate inputs
  if (!optimizerRunId) {
    throw new Error('runOutOfSampleTests: optimizerRunId is required');
  }
  if (!top10 || top10.length === 0) {
    throw new Error('runOutOfSampleTests: top10 array is empty');
  }
  if (!symbol) {
    throw new Error('runOutOfSampleTests: symbol is required');
  }
  if (!trainEndTs) {
    throw new Error('runOutOfSampleTests: trainEndTs is required');
  }
  
  // Determine OOS range
  let oosStartTs, oosEndTs;
  
  if (process.env.OOS_START_TS && process.env.OOS_END_TS) {
    // Use explicit OOS range
    oosStartTs = normalizeISO(process.env.OOS_START_TS);
    oosEndTs = normalizeISO(process.env.OOS_END_TS);
    console.log(`[optimizer] Using explicit OOS range: ${oosStartTs} to ${oosEndTs}`);
  } else {
    // Calculate OOS range: start 1 minute after trainEndTs, end after OOS_DAYS days
    const oosDays = parseInt(process.env.OOS_DAYS || '7', 10);
    oosStartTs = addMinutesISO(normalizeISO(trainEndTs), 1);
    const oosEndDate = addDaysISO(oosStartTs, oosDays);
    oosEndTs = setEndOfDayISO(oosEndDate);
    console.log(`[optimizer] Calculated OOS range: ${oosStartTs} to ${oosEndTs} (${oosDays} days after training)`);
  }
  
  const topN = parseInt(process.env.OOS_TOP_N || '3', 10);
  const configsToTest = top10.slice(0, Math.min(topN, top10.length));
  
  console.log(`[optimizer] Running OOS tests for top ${configsToTest.length} configs (OOS_TOP_N=${topN}):`, {
    optimizerRunId,
    symbol,
    oosStartTs,
    oosEndTs,
    configsToTest: configsToTest.length,
  });
  
  const oosResults = [];
  
  for (let i = 0; i < configsToTest.length; i++) {
    const configItem = configsToTest[i];
    const rank = i + 1;
    
    if (!configItem.metrics) {
      console.error(`[optimizer] ⚠ Config at rank ${rank} has no metrics, skipping OOS test`);
      continue;
    }
    
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
      
      // Calculate stability indicators
      const trainPnl = configItem.metrics.total_pnl_pct;
      const trainDd = configItem.metrics.max_drawdown_pct;
      const oosPnl = oosMetrics.total_pnl_pct;
      const oosDd = oosMetrics.max_drawdown_pct;
      
      // Stability warnings
      const stabilityWarnings = [];
      if (oosPnl < 0) {
        stabilityWarnings.push(`OOS PnL is negative (${oosPnl.toFixed(2)}%)`);
      }
      if (oosDd > trainDd) {
        stabilityWarnings.push(`OOS DD (${oosDd.toFixed(2)}%) exceeds train DD (${trainDd.toFixed(2)}%)`);
      }
      
      // Log comparison with stability warnings
      console.log(`[optimizer] OOS test ${i + 1} complete (rank ${rank}):`);
      console.log(`[optimizer]   Train: PnL=${trainPnl.toFixed(2)}%, DD=${trainDd.toFixed(2)}%, PF=${configItem.metrics.profit_factor.toFixed(2)}, Trades=${configItem.metrics.trades}`);
      console.log(`[optimizer]   OOS:   PnL=${oosPnl.toFixed(2)}%, DD=${oosDd.toFixed(2)}%, PF=${oosMetrics.profit_factor.toFixed(2)}, Trades=${oosMetrics.trades}`);
      
      if (stabilityWarnings.length > 0) {
        console.warn(`[optimizer]   ⚠ STABILITY WARNING (rank ${rank}): ${stabilityWarnings.join('; ')}`);
      } else {
        console.log(`[optimizer]   ✓ Stability check passed (rank ${rank})`);
      }
    } catch (error) {
      console.error(`[optimizer] ✗ OOS test ${i + 1} (rank ${rank}) failed:`, error);
      console.error(`[optimizer] Error details:`, {
        rank,
        config: configItem.config,
        errorMessage: error.message,
        errorStack: error.stack,
      });
      // Continue with other configs
    }
  }
  
  // Save OOS results
  if (!optimizerRunId) {
    throw new Error('Cannot save OOS results: optimizerRunId is null');
  }
  
  if (oosResults.length === 0) {
    console.warn(`[optimizer] ⚠ No OOS results to save: ${configsToTest.length} configs tested, 0 succeeded`);
  } else {
    console.log(`[optimizer] Saving ${oosResults.length} OOS results to database for run_id=${optimizerRunId}`);
    console.log(`[optimizer] OOS results shape check:`, {
      oosResultsLength: oosResults.length,
      firstItemHasMetrics: oosResults[0]?.metrics ? true : false,
      firstItemHasRank: oosResults[0]?.rank !== undefined,
      firstItemHasConfig: oosResults[0]?.config ? true : false,
      firstItemSymbol: oosResults[0]?.symbol,
    });
    
    try {
      const { data, error } = await saveOptimizerOOSResults(optimizerRunId, oosResults);
      if (error) {
        throw error;
      }
      console.log(`[optimizer][db] saved OOS results: ${oosResults.length}`, {
        returnedRows: data?.length || 0,
        sampleRow: data?.[0] || null,
      });
    } catch (error) {
      console.error(`[optimizer] ✗ Failed to save OOS results:`, error);
      throw error; // Fail fast
    }
  }
  
  console.log(`[optimizer] OOS testing complete: ${oosResults.length}/${configsToTest.length} configs tested successfully`);
  
  if (oosResults.length === 0) {
    console.warn(`[optimizer] ⚠ No OOS results to save - all tests failed or no configs tested`);
  }
}

