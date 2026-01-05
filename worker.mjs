/**
 * Trading Buddy Worker
 * 
 * Cloud-only Bitcoin daytrading bot worker that runs continuously.
 * Designed to run on Render Background Worker.
 * 
 * Environment variables required:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - DERIBIT_CLIENT_ID
 * - DERIBIT_CLIENT_SECRET
 * - DERIBIT_ENV (default: 'test')
 * - BOT_MODE (default: 'paper')
 * - SYMBOL (default: 'BTC-PERPETUAL')
 * - TIMEFRAMES (default: '1,5,15,60')
 * - POLL_INTERVAL_SECONDS (default: 60)
 * - LOG_LEVEL (default: 'info')
 */

console.log("Worker started OK (ESM)");

import { getSupabaseClient, healthCheckStrategyRuns } from './src/db/supabaseClient.js';
import { ingestAllTimeframes, needsBackfill, initializeWebSocketFallback } from './src/ingest/marketDataIngest.mjs';
import { getDataSource } from './src/ingest/candleBuilder.js';
import { runStateUpdate } from './src/analysis/stateRunner.mjs';
import { evaluateStrategy } from './src/strategy/strategyEvaluator.mjs';
import { saveProposal } from './src/strategy/proposalWriter.mjs';
import { runPaperEngine } from './src/paper/paperEngine.mjs';
import { runOptimizer } from './src/backtest/optimizer.mjs';
import { runBackfill } from './src/backfill/backfillEngine.mjs';
import { subtractDaysISO } from './src/utils/time.mjs';
import http from 'http';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const POLL_INTERVAL_SECONDS = parseInt(process.env.POLL_INTERVAL_SECONDS || '60', 10);

/**
 * Structured logging
 */
function log(level, message, data = {}) {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const currentLevel = levels[LOG_LEVEL] || 1;
  const messageLevel = levels[level] || 1;

  if (messageLevel >= currentLevel) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...data,
    };
    console.log(JSON.stringify(logEntry));
  }
}

/**
 * Main worker loop
 */
async function runWorker() {
  log('info', 'Trading Buddy Worker starting', {
    pollInterval: POLL_INTERVAL_SECONDS,
    nodeEnv: process.env.NODE_ENV || 'production',
  });

  // Check Supabase connection
  const supabase = getSupabaseClient();
  if (!supabase) {
    log('warn', 'Supabase not configured - worker will run in limited mode');
  } else {
    log('info', 'Supabase connected');
    
    // Health check: Test if strategy_runs table is accessible
    try {
      const healthCheck = await healthCheckStrategyRuns();
      if (!healthCheck.success) {
        log('warn', 'Supabase health check failed', {
          error: healthCheck.error,
          status: healthCheck.status,
          urlHostname: healthCheck.urlHostname,
          selectedKeyType: healthCheck.selectedKeyType,
        });
      }
    } catch (healthError) {
      log('warn', 'Supabase health check error', {
        error: healthError.message,
      });
    }
  }

  // Main loop
  let iteration = 0;
  let backfillDone = false;

  while (true) {
    try {
      iteration++;
      log('info', 'Worker alive', { iteration, timestamp: new Date().toISOString() });

      // FASE 3: Market Data Ingest
      try {
        // Check if backfill is needed (only once)
        if (!backfillDone) {
          const needsBackfillCheck = await needsBackfill();
          if (needsBackfillCheck) {
            log('info', 'Starting backfill - fetching last 100 candles per timeframe');
            
            try {
              const backfillResults = await ingestAllTimeframes(true);
              const dataSource = getDataSource();
              log('info', 'Backfill complete', { 
                results: backfillResults,
                dataSource,
              });
              
              // If chart_data API failed, initialize WebSocket fallback
              if (dataSource === 'ws-candles') {
                log('info', 'Initializing WebSocket fallback for real-time candle building');
                await initializeWebSocketFallback();
              }
              
              backfillDone = true;
            } catch (backfillError) {
              // If backfill fails with chart_data error, try WebSocket
              if (backfillError.message.includes('CHART_DATA_NOT_AVAILABLE') || 
                  backfillError.message.includes('Method not found')) {
                log('info', 'Chart data API not available, initializing WebSocket fallback');
                await initializeWebSocketFallback();
                backfillDone = true;
              } else {
                throw backfillError;
              }
            }
          } else {
            log('info', 'Backfill not needed - candles already exist');
            backfillDone = true;
          }
        }

        // Incremental ingest (every iteration)
        // Only if using chart_data API (WebSocket handles its own saves)
        const dataSource = getDataSource();
        if (dataSource === 'chart_data') {
          const ingestResults = await ingestAllTimeframes(false);
          const totalNew = Object.values(ingestResults).reduce((sum, r) => sum + (r.newCandles || 0), 0);
          if (totalNew > 0) {
            log('info', 'Market data ingested', {
              newCandles: totalNew,
              results: ingestResults,
              dataSource,
            });
          }
        } else {
          // WebSocket mode: candles are saved automatically as they complete
          log('debug', 'WebSocket mode active - candles saved in real-time', {
            dataSource,
          });
        }
      } catch (ingestError) {
        log('error', 'Market data ingest failed', {
          error: ingestError.message,
        });
        // Continue - don't crash worker on ingest errors
      }

      // FASE 4: Timeframe State Builder
      try {
        const SYMBOL = process.env.SYMBOL || 'BTC-PERPETUAL';
        const TIMEFRAMES = (process.env.TIMEFRAMES || '1,5,15,60').split(',').map(t => parseInt(t.trim(), 10));
        
        const stateResults = await runStateUpdate({ symbol: SYMBOL, timeframes: TIMEFRAMES });
        
        // Log successful state updates
        for (const [tf, result] of Object.entries(stateResults)) {
          if (result.success) {
            log('info', `State updated for ${tf}m`, {
              timeframe: tf,
              ts: result.state.ts,
              trend: result.state.trend,
              atr: result.state.atr,
              swingHigh: result.state.last_swing_high,
              swingLow: result.state.last_swing_low,
              bos: result.state.bos_direction,
              choch: result.state.choch_direction,
              candlesProcessed: result.candlesProcessed,
            });
          } else if (result.reason !== 'No new candles to process') {
            log('warn', `State update failed for ${tf}m`, {
              timeframe: tf,
              reason: result.reason || result.error,
            });
          }
        }
      } catch (stateError) {
        log('error', 'State builder failed', {
          error: stateError.message,
        });
        // Continue - don't crash worker on state errors
      }

      // FASE 5: Strategy Evaluator
      try {
        const SYMBOL = process.env.SYMBOL || 'BTC-PERPETUAL';
        
        // Compute consistent "now" timestamp for this iteration
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        
        const proposal = await evaluateStrategy({ symbol: SYMBOL, nowMs, nowIso });
        
        if (proposal) {
          // Save proposal
          const saved = await saveProposal(proposal);
          if (saved) {
            log('info', 'Proposal created', {
              direction: saved.direction,
              entry: saved.entry_price,
              sl: saved.stop_loss,
              tp: saved.take_profit,
              rr: saved.rr,
              reason: saved.reason,
            });
          }
        } else {
          log('debug', 'No setup found', {
            symbol: SYMBOL,
          });
        }
      } catch (strategyError) {
        log('error', 'Strategy evaluator failed', {
          error: strategyError.message,
        });
        // Continue - don't crash worker on strategy errors
      }

      // FASE 6: Paper Performance Engine
      try {
        const SYMBOL = process.env.SYMBOL || 'BTC-PERPETUAL';
        
        const paperResults = await runPaperEngine({ symbol: SYMBOL });
        
        if (paperResults.success) {
          if (paperResults.executed > 0 || paperResults.closed > 0 || paperResults.expired > 0) {
            log('info', 'Paper engine results', {
              executed: paperResults.executed,
              closed: paperResults.closed,
              expired: paperResults.expired,
              errors: paperResults.errors,
            });
          }
        } else {
          log('warn', 'Paper engine failed', {
            error: paperResults.error,
            errors: paperResults.errors,
          });
        }
      } catch (paperError) {
        log('error', 'Paper engine error', {
          error: paperError.message,
        });
        // Continue - don't crash worker on paper errors
      }

      // TODO: FASE 7 - Add live execution here

      // Wait for next iteration
      await sleep(POLL_INTERVAL_SECONDS * 1000);
    } catch (error) {
      log('error', 'Worker error', {
        error: error.message,
        stack: error.stack,
      });
      // Wait before retrying
      await sleep(5000);
    }
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Graceful shutdown handler
 */
process.on('SIGTERM', () => {
  log('info', 'SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('info', 'SIGINT received, shutting down gracefully');
  process.exit(0);
});

/**
 * Run backtest optimizer mode
 */
async function runBacktestMode() {
  const BACKTEST_MODE = process.env.BACKTEST_MODE === '1';
  const BACKTEST_START_TS = process.env.BACKTEST_START_TS;
  const BACKTEST_END_TS = process.env.BACKTEST_END_TS;
  const SYMBOL = process.env.SYMBOL || 'BTC-PERPETUAL';
  
  if (!BACKTEST_MODE) {
    return false; // Not in backtest mode
  }
  
  if (!BACKTEST_START_TS || !BACKTEST_END_TS) {
    throw new Error('BACKTEST_MODE=1 requires BACKTEST_START_TS and BACKTEST_END_TS environment variables');
  }
  
  log('info', 'Running in BACKTEST_MODE', {
    symbol: SYMBOL,
    startTs: BACKTEST_START_TS,
    endTs: BACKTEST_END_TS,
  });
  
  // Initialize status
  lastRunStatus = {
    mode: 'backtest',
    status: 'running',
    completedAt: null,
    results: null,
    error: null,
    optimizerRunId: null,
    currentConfigIndex: null,
    totalConfigs: null,
  };
  
  try {
    const top10 = await runOptimizer({
      symbol: SYMBOL,
      startTs: BACKTEST_START_TS,
      endTs: BACKTEST_END_TS,
    });
    
    // Update status on success
    lastRunStatus.status = 'finished';
    lastRunStatus.completedAt = new Date().toISOString();
    lastRunStatus.results = {
      topConfigs: top10.length,
      top10: top10.map((config, idx) => ({
        rank: idx + 1,
        score: config.primaryScore,
        trades: config.metrics?.trades,
        pnl: config.metrics?.total_pnl_pct,
        dd: config.metrics?.max_drawdown_pct,
      })),
    };
    
    log('info', 'Backtest optimizer complete', {
      topConfigs: top10.length,
    });
    
    return true; // Backtest mode completed
  } catch (error) {
    log('error', 'Backtest optimizer failed', {
      error: error.message,
      stack: error.stack,
    });
    
    // Update status on error
    lastRunStatus.status = 'failed';
    lastRunStatus.completedAt = new Date().toISOString();
    lastRunStatus.error = error.message;
    
    // Don't throw - we'll start the server in finally
    return true;
  } finally {
    // Always start HTTP server to keep process alive (success or failure)
    startBackfillServer();
    
    const PORT = parseInt(process.env.PORT || '10000', 10);
    log('info', 'Backtest mode complete, HTTP server running to keep process alive', {
      port: PORT,
      endpoints: ['/health', '/status'],
      status: lastRunStatus.status,
    });
  }
}

// Store last run status for status endpoint
let lastRunStatus = {
  mode: null,
  completedAt: null,
  results: null,
  error: null,
  // For backtest mode
  optimizerRunId: null,
  currentConfigIndex: null,
  totalConfigs: null,
  status: null, // 'running' | 'finished' | 'failed'
};

/**
 * Start HTTP server for backfill/backtest mode
 */
function startBackfillServer() {
  const PORT = parseInt(process.env.PORT || '10000', 10);
  
  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid URL' }));
      return;
    }
    
    const path = url.pathname;
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (path === '/health') {
      const mode = lastRunStatus.mode === 'backtest' ? 'BACKTEST_MODE' : 'BACKFILL_MODE';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mode }));
    } else if (path === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      
      // Build status response based on mode
      const statusResponse = {
        mode: lastRunStatus.mode,
        completedAt: lastRunStatus.completedAt,
        status: lastRunStatus.status || (lastRunStatus.completedAt ? 'finished' : 'running'),
      };
      
      if (lastRunStatus.mode === 'backtest') {
        statusResponse.optimizerRunId = lastRunStatus.optimizerRunId;
        statusResponse.currentConfigIndex = lastRunStatus.currentConfigIndex;
        statusResponse.totalConfigs = lastRunStatus.totalConfigs;
        if (lastRunStatus.error) {
          statusResponse.error = lastRunStatus.error;
        }
        if (lastRunStatus.results) {
          statusResponse.results = lastRunStatus.results;
        }
      } else if (lastRunStatus.mode === 'backfill') {
        statusResponse.results = lastRunStatus.results;
        if (lastRunStatus.error) {
          statusResponse.error = lastRunStatus.error;
        }
      }
      
      res.end(JSON.stringify(statusResponse, null, 2));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  
  server.listen(PORT, () => {
    const mode = lastRunStatus.mode === 'backtest' ? 'Backtest' : 'Backfill';
    log('info', `${mode} HTTP server started`, {
      port: PORT,
      endpoints: ['/health', '/status'],
    });
  });
  
  server.on('error', (error) => {
    log('error', 'HTTP server error', {
      error: error.message,
    });
  });
}

/**
 * Run backfill mode
 */
async function runBackfillMode() {
  const BACKFILL_MODE = process.env.BACKFILL_MODE === '1';
  const BACKFILL_SYMBOL = process.env.BACKFILL_SYMBOL || process.env.SYMBOL || 'BTC-PERPETUAL';
  const BACKFILL_START_TS = process.env.BACKFILL_START_TS;
  const BACKFILL_END_TS = process.env.BACKFILL_END_TS;
  const BACKFILL_TIMEFRAMES = (process.env.BACKFILL_TIMEFRAMES || '1,5,15,60').split(',').map(t => parseInt(t.trim(), 10));
  const BACKFILL_BATCH_LIMIT = parseInt(process.env.BACKFILL_BATCH_LIMIT || '5000', 10);
  const BACKFILL_OVERLAP_MINUTES = process.env.BACKFILL_OVERLAP_MINUTES ? parseInt(process.env.BACKFILL_OVERLAP_MINUTES, 10) : null;
  
  if (!BACKFILL_MODE) {
    return false; // Not in backfill mode
  }
  
  if (!BACKFILL_START_TS || !BACKFILL_END_TS) {
    throw new Error('BACKFILL_MODE=1 requires BACKFILL_START_TS and BACKFILL_END_TS environment variables');
  }
  
  // Validate and compute warmup days
  let warmupDays = parseInt(process.env.WARMUP_DAYS ?? '1', 10);
  if (isNaN(warmupDays) || warmupDays < 0 || warmupDays > 30) {
    log('warn', 'Invalid WARMUP_DAYS, using default', {
      provided: process.env.WARMUP_DAYS,
      defaultValue: 1,
    });
    warmupDays = 1;
  }
  
  // Calculate effective start (with warmup period) using helper
  const effectiveStartTs = subtractDaysISO(BACKFILL_START_TS, warmupDays);
  
  // ALWAYS log this structured line when BACKFILL_MODE starts
  log('info', 'BACKFILL_MODE starting with warmup', {
    symbol: BACKFILL_SYMBOL,
    startTs: BACKFILL_START_TS,
    effectiveStartTs,
    warmupDays,
    endTs: BACKFILL_END_TS,
    timeframes: BACKFILL_TIMEFRAMES,
    batchLimit: BACKFILL_BATCH_LIMIT,
    overlapMinutes: BACKFILL_OVERLAP_MINUTES,
  });
  
  try {
    const results = await runBackfill({
      symbol: BACKFILL_SYMBOL,
      startTs: effectiveStartTs, // Use effective start (with warmup) - this is the actual range
      endTs: BACKFILL_END_TS,
      timeframes: BACKFILL_TIMEFRAMES,
      batchLimit: BACKFILL_BATCH_LIMIT,
      overlapMinutes: BACKFILL_OVERLAP_MINUTES,
    });
    
    // Store status for /status endpoint
    lastRunStatus = {
      mode: 'backfill',
      completedAt: new Date().toISOString(),
      results: Object.keys(results).reduce((acc, tf) => {
        acc[tf] = {
          totalFetched: results[tf].totalFetched,
          totalUpserted: results[tf].totalUpserted,
          batches: results[tf].batches,
          lastCandleTs: results[tf].lastCandleTs,
        };
        return acc;
      }, {}),
    };
    
    log('info', 'Backfill complete', {
      results: Object.keys(results).map(tf => {
        const r = results[tf];
        return `${tf}m: ${r.totalUpserted} candles`;
      }).join(', '),
    });
    
    // Start HTTP server to keep process alive
    startBackfillServer();
    
    return true; // Backfill mode completed (but process stays alive)
  } catch (error) {
    log('error', 'Backfill failed', {
      error: error.message,
      stack: error.stack,
    });
    
    // Store error status
    lastRunStatus = {
      mode: 'backfill',
      completedAt: new Date().toISOString(),
      error: error.message,
    };
    
    // Start HTTP server even on error to keep process alive
    startBackfillServer();
    
    // Don't throw - keep process alive
    return true;
  }
}

// Start worker, backtest mode, or backfill mode
(async () => {
  const isBacktestMode = await runBacktestMode();
  
  if (isBacktestMode) {
    // HTTP server already started in runBacktestMode finally block
    // Don't exit - HTTP server keeps process alive
    return;
  }
  
  const isBackfillMode = await runBackfillMode();
  
  if (isBackfillMode) {
    // HTTP server already started in runBackfillMode
    // Don't exit - HTTP server keeps process alive
    return;
  }
  
  // Run normal worker
  runWorker().catch((error) => {
    log('error', 'Fatal error starting worker', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
})();

