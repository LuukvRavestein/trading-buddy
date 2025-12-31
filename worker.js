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

import { getSupabaseClient } from './src/db/supabaseClient.js';
import { ingestAllTimeframes, needsBackfill } from './src/ingest/marketDataIngest.js';

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
            log('info', 'Starting backfill - fetching last 500 candles per timeframe');
            const backfillResults = await ingestAllTimeframes(true);
            log('info', 'Backfill complete', { results: backfillResults });
            backfillDone = true;
          } else {
            log('info', 'Backfill not needed - candles already exist');
            backfillDone = true;
          }
        }

        // Incremental ingest (every iteration)
        const ingestResults = await ingestAllTimeframes(false);
        const totalNew = Object.values(ingestResults).reduce((sum, r) => sum + (r.newCandles || 0), 0);
        if (totalNew > 0) {
          log('info', 'Market data ingested', {
            newCandles: totalNew,
            results: ingestResults,
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

