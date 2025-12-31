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

// TEMPORARY: Runtime diagnostics to verify package.json is loaded correctly
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

try {
  const cwd = process.cwd();
  const packageJsonPath = join(cwd, 'package.json');
  const packageJsonExists = existsSync(packageJsonPath);
  
  console.log('=== RUNTIME DIAGNOSTICS ===');
  console.log('process.cwd():', cwd);
  console.log('package.json exists:', packageJsonExists);
  console.log('package.json path:', packageJsonPath);
  
  if (packageJsonExists) {
    try {
      const packageJsonContent = readFileSync(packageJsonPath, 'utf8');
      console.log('package.json contents:');
      console.log(packageJsonContent);
      
      // Parse and show type field specifically
      const packageJson = JSON.parse(packageJsonContent);
      console.log('package.json.type:', packageJson.type);
      console.log('package.json.engines:', JSON.stringify(packageJson.engines));
    } catch (parseError) {
      console.error('Error reading/parsing package.json:', parseError.message);
    }
  } else {
    console.error('ERROR: package.json not found at', packageJsonPath);
  }
  console.log('=== END DIAGNOSTICS ===');
} catch (diagError) {
  console.error('Error in diagnostics:', diagError.message);
  console.error('Stack:', diagError.stack);
}

import { getSupabaseClient } from './src/db/supabaseClient.js';
import { ingestAllTimeframes, needsBackfill, initializeWebSocketFallback } from './src/ingest/marketDataIngest.js';
import { getDataSource } from './src/ingest/candleBuilder.js';

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

      // TODO: FASE 4 - Add state builder here
      // TODO: FASE 5 - Add strategy engine here
      // TODO: FASE 6 - Add paper trading here
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

// Start worker
runWorker().catch((error) => {
  log('error', 'Fatal error starting worker', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

