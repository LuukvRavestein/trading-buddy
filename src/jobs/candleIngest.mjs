/**
 * Candle Ingest Job
 * 
 * Robust candle ingestion from Deribit to Supabase.
 * Supports both one-time backfill and continuous ingest.
 * 
 * Usage:
 *   node src/jobs/candleIngest.mjs
 * 
 * Environment variables:
 *   SYMBOL - Symbol to ingest (default: BTC-PERPETUAL)
 *   BACKFILL - true|false (default: false)
 *   BACKFILL_START_TS - ISO timestamp for backfill start (required if BACKFILL=true)
 *   BACKFILL_END_TS - ISO timestamp for backfill end (required if BACKFILL=true)
 *   DRY_RUN - true|false (default: false, skip actual DB writes)
 */

import { getCandles } from '../exchanges/deribitClient.mjs';
import { upsertCandles, getMaxCandleTs } from '../db/supabaseClient.js';
import { normalizeISO, addMinutesISO } from '../utils/time.mjs';

// Supported timeframes
const TIMEFRAMES = [1, 5, 15, 60];

/**
 * Round timestamp down to timeframe boundary
 * 
 * @param {string|number|Date} ts - Timestamp (ISO string, milliseconds, or Date)
 * @param {number} timeframeMin - Timeframe in minutes
 * @returns {string} ISO timestamp rounded down to timeframe boundary
 */
export function roundTsToTimeframe(ts, timeframeMin) {
  let date;
  
  if (typeof ts === 'string') {
    date = new Date(ts);
  } else if (typeof ts === 'number') {
    date = new Date(ts);
  } else if (ts instanceof Date) {
    date = ts;
  } else {
    throw new Error(`Invalid timestamp type: ${typeof ts}`);
  }
  
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${ts}`);
  }
  
  const ms = date.getTime();
  const tfMs = timeframeMin * 60 * 1000;
  
  // Round down to timeframe boundary
  const roundedMs = Math.floor(ms / tfMs) * tfMs;
  
  return new Date(roundedMs).toISOString();
}

/**
 * Floor timestamp to timeframe boundary (never rounds up)
 * 
 * This is an alias for roundTsToTimeframe, but explicitly named to indicate
 * it always floors (never rounds up) to the timeframe boundary.
 * 
 * @param {string|number|Date} ts - Timestamp (ISO string, milliseconds, or Date)
 * @param {number} timeframeMin - Timeframe in minutes
 * @returns {string} ISO timestamp floored to timeframe boundary
 */
export function floorToTimeframe(ts, timeframeMin) {
  return roundTsToTimeframe(ts, timeframeMin);
}

/**
 * Convert candle from Deribit format to Supabase format
 * 
 * @param {object} candle - Deribit candle {t, o, h, l, c, v}
 * @param {string} symbol - Symbol
 * @param {number} timeframeMin - Timeframe in minutes
 * @returns {object} Supabase candle format
 */
function convertCandleToSupabase(candle, symbol, timeframeMin) {
  // Round timestamp to timeframe boundary (Deribit may return slightly off timestamps)
  const roundedTs = roundTsToTimeframe(candle.t, timeframeMin);
  
  return {
    symbol,
    timeframe_min: timeframeMin,
    ts: roundedTs,
    open: candle.o.toString(),
    high: candle.h.toString(),
    low: candle.l.toString(),
    close: candle.c.toString(),
    volume: candle.v ? candle.v.toString() : null,
    source: 'deribit',
  };
}

/**
 * Fetch candles from Deribit with pagination
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol (e.g., 'BTC-PERPETUAL')
 * @param {number} options.timeframeMin - Timeframe in minutes
 * @param {string} options.startTs - Start timestamp (ISO string)
 * @param {string} options.endTs - End timestamp (ISO string)
 * @returns {Promise<Array>} Array of candles
 */
export async function fetchCandlesFromDeribit({ symbol, timeframeMin, startTs, endTs }) {
  const startMs = new Date(startTs).getTime();
  const endMs = new Date(endTs).getTime();
  
  if (isNaN(startMs) || isNaN(endMs)) {
    throw new Error(`Invalid timestamp range: ${startTs} to ${endTs}`);
  }
  
  if (startMs >= endMs) {
    throw new Error(`Invalid range: startTs (${startTs}) must be before endTs (${endTs})`);
  }
  
  console.log(`[ingest][${timeframeMin}m] Fetching candles from Deribit:`, {
    symbol,
    timeframeMin,
    startTs,
    endTs,
    rangeMinutes: Math.round((endMs - startMs) / (60 * 1000)),
  });
  
  try {
    const candles = await getCandles({
      symbol,
      timeframeMin,
      startTs: startMs,
      endTs: endMs,
    });
    
    if (!candles || candles.length === 0) {
      console.warn(`[ingest][${timeframeMin}m] No candles returned from Deribit`);
      return [];
    }
    
    // Round timestamps to timeframe boundaries
    const roundedCandles = candles.map(c => {
      const roundedTs = roundTsToTimeframe(c.t, timeframeMin);
      return {
        ...c,
        t: new Date(roundedTs).getTime(), // Keep as milliseconds for consistency
      };
    });
    
    console.log(`[ingest][${timeframeMin}m] Fetched ${roundedCandles.length} candles from Deribit`, {
      firstTs: roundedCandles.length > 0 ? new Date(roundedCandles[0].t).toISOString() : null,
      lastTs: roundedCandles.length > 0 ? new Date(roundedCandles[roundedCandles.length - 1].t).toISOString() : null,
    });
    
    return roundedCandles;
  } catch (error) {
    console.error(`[ingest][${timeframeMin}m] Error fetching candles from Deribit:`, error.message);
    throw error;
  }
}

/**
 * Ingest candles for a single timeframe
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol
 * @param {number} options.timeframeMin - Timeframe in minutes
 * @param {string} options.startTs - Start timestamp (ISO string)
 * @param {string} options.endTs - End timestamp (ISO string)
 * @param {boolean} options.dryRun - Skip DB writes if true
 * @returns {Promise<object>} Result with counts
 */
export async function ingestCandlesForTimeframe({ symbol, timeframeMin, startTs, endTs, dryRun = false }) {
  const startTime = Date.now();
  
  try {
    // Fetch candles from Deribit
    const candles = await fetchCandlesFromDeribit({
      symbol,
      timeframeMin,
      startTs,
      endTs,
    });
    
    if (candles.length === 0) {
      console.log(`[ingest][${timeframeMin}m] No candles to ingest`);
      return {
        timeframeMin,
        fetched: 0,
        inserted: 0,
        firstTs: null,
        lastTs: null,
        durationMs: Date.now() - startTime,
      };
    }
    
    // Convert to Supabase format
    const supabaseCandles = candles.map(c => convertCandleToSupabase(c, symbol, timeframeMin));
    
    // Upsert to Supabase (unless dry run)
    let inserted = 0;
    if (!dryRun) {
      const upserted = await upsertCandles(supabaseCandles);
      inserted = upserted ? upserted.length : supabaseCandles.length;
    } else {
      console.log(`[ingest][${timeframeMin}m] DRY RUN: Would insert ${supabaseCandles.length} candles`);
      inserted = supabaseCandles.length; // Count as if inserted for logging
    }
    
    const firstTs = supabaseCandles[0].ts;
    const lastTs = supabaseCandles[supabaseCandles.length - 1].ts;
    const durationMs = Date.now() - startTime;
    
    console.log(`[ingest][${timeframeMin}m] ✓ Ingested candles:`, {
      fetched: candles.length,
      inserted,
      range: `${firstTs} -> ${lastTs}`,
      durationMs,
    });
    
    return {
      timeframeMin,
      fetched: candles.length,
      inserted,
      firstTs,
      lastTs,
      durationMs,
    };
  } catch (error) {
    console.error(`[ingest][${timeframeMin}m] ✗ Failed to ingest candles:`, error.message);
    throw error;
  }
}

/**
 * Run candle ingest for all timeframes
 * 
 * @deprecated Use runIngestIteration() instead for continuous mode
 * @param {object} options
 * @param {string} options.symbol - Symbol (default: BTC-PERPETUAL)
 * @param {string} options.startTs - Start timestamp (ISO string, optional for continuous mode)
 * @param {string} options.endTs - End timestamp (ISO string, optional for continuous mode)
 * @param {boolean} options.backfill - If true, use explicit startTs/endTs; if false, determine from DB
 * @param {boolean} options.dryRun - Skip DB writes if true
 * @returns {Promise<object>} Results for all timeframes
 */
export async function runCandleIngest({ symbol = 'BTC-PERPETUAL', startTs, endTs, backfill = false, dryRun = false }) {
  // For backward compatibility, use TIMEFRAMES constant
  const config = {
    symbol,
    timeframes: TIMEFRAMES,
    pollSeconds: 15,
    backfill,
    startTs,
    endTs,
    dryRun,
  };
  
  return await runIngestIteration(config);
}

/**
 * Normalize environment variables with multiple name support
 */
function getEnvConfig() {
  // SYMBOL
  const symbol = process.env.SYMBOL || 'BTC-PERPETUAL';
  
  // TIMEFRAMES: from INGEST_TIMEFRAMES or BACKFILL_TIMEFRAMES (fallback "1,5,15,60")
  const timeframesStr = process.env.INGEST_TIMEFRAMES || process.env.BACKFILL_TIMEFRAMES || '1,5,15,60';
  const timeframes = timeframesStr.split(',').map(tf => parseInt(tf.trim(), 10)).filter(tf => !isNaN(tf) && tf > 0);
  if (timeframes.length === 0) {
    throw new Error('Invalid TIMEFRAMES: must be comma-separated numbers (e.g., "1,5,15,60")');
  }
  
  // POLL_SECONDS: from INGEST_POLL_SECONDS or POLL_SECONDS (fallback 15)
  const pollSeconds = parseInt(
    process.env.INGEST_POLL_SECONDS || process.env.POLL_SECONDS || '15',
    10
  );
  if (isNaN(pollSeconds) || pollSeconds < 1) {
    throw new Error('Invalid POLL_SECONDS: must be a positive integer');
  }
  
  // BACKFILL mode: enabled if BACKFILL=true OR BACKFILL_MODE=1 OR BACKFILL_MODE=true
  const backfillEnv = process.env.BACKFILL || process.env.BACKFILL_MODE || 'false';
  const backfill = backfillEnv === 'true' || backfillEnv === '1';
  
  // BACKFILL timestamps
  const startTs = process.env.BACKFILL_START_TS ? normalizeISO(process.env.BACKFILL_START_TS) : null;
  const endTs = process.env.BACKFILL_END_TS ? normalizeISO(process.env.BACKFILL_END_TS) : null;
  
  // DRY_RUN
  const dryRun = process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';
  
  return {
    symbol,
    timeframes,
    pollSeconds,
    backfill,
    startTs,
    endTs,
    dryRun,
  };
}

/**
 * Run a single ingest iteration for all timeframes
 */
async function runIngestIteration(config) {
  const { symbol, timeframes, backfill, startTs, endTs, dryRun } = config;
  
  const results = {};
  const errors = {};
  
  // Determine ingest range for each timeframe
  for (const timeframeMin of timeframes) {
    try {
      let ingestStartTs = startTs;
      let ingestEndTs = endTs;
      const nowUtc = new Date();
      const nowUtcIso = nowUtc.toISOString();
      
      if (!backfill) {
        // Continuous mode: determine range from current time and DB
        const maxTsInDb = await getMaxCandleTs({ symbol, timeframeMin });
        
        // Compute endTsSafe: most recent CLOSED candle timestamp
        // endTsSafe = floorToTimeframe(now, timeframeMin) - timeframeMin minutes
        const floorNow = roundTsToTimeframe(nowUtcIso, timeframeMin);
        ingestEndTs = addMinutesISO(floorNow, -timeframeMin);
        
        // Compute startTs
        if (maxTsInDb) {
          // Start from next candle after maxTs
          const maxDate = new Date(maxTsInDb);
          const nextCandleMs = maxDate.getTime() + (timeframeMin * 60 * 1000);
          ingestStartTs = new Date(nextCandleMs).toISOString();
        } else {
          // No data in DB, start from 24h ago (floored to timeframe)
          const oneDayAgo = new Date(nowUtc.getTime() - 24 * 60 * 60 * 1000);
          ingestStartTs = floorToTimeframe(oneDayAgo.toISOString(), timeframeMin);
        }
        
        // Log per-timeframe computed values
        console.log(`[ingest][${timeframeMin}m] endTsSafe=${ingestEndTs} now=${nowUtcIso} startTs=${ingestStartTs}`);
      } else {
        // Backfill mode: use explicit range
        if (!ingestStartTs || !ingestEndTs) {
          throw new Error(`Backfill mode requires BACKFILL_START_TS and BACKFILL_END_TS`);
        }
        
        // Round to timeframe boundaries
        ingestStartTs = roundTsToTimeframe(ingestStartTs, timeframeMin);
        ingestEndTs = roundTsToTimeframe(ingestEndTs, timeframeMin);
      }
      
      // Validate range
      const startMs = new Date(ingestStartTs).getTime();
      const endMs = new Date(ingestEndTs).getTime();
      
      if (startMs >= endMs) {
        if (!backfill) {
          // Continuous mode: no new closed candles yet
          console.log(`[ingest][${timeframeMin}m] No new closed candles yet (startTs > endTs). Waiting...`);
        } else {
          // Backfill mode: log warning
          console.warn(`[ingest][${timeframeMin}m] Skipping: startTs >= endTs (${ingestStartTs} >= ${ingestEndTs})`);
        }
        results[timeframeMin] = {
          timeframeMin,
          fetched: 0,
          inserted: 0,
          skipped: true,
          reason: 'startTs >= endTs',
        };
        continue;
      }
      
      // Ingest candles
      const result = await ingestCandlesForTimeframe({
        symbol,
        timeframeMin,
        startTs: ingestStartTs,
        endTs: ingestEndTs,
        dryRun,
      });
      
      results[timeframeMin] = result;
      
      // Get max ts in DB after ingest (for logging)
      let maxTsAfter = null;
      try {
        maxTsAfter = await getMaxCandleTs({ symbol, timeframeMin });
      } catch (e) {
        // Ignore errors getting max ts
      }
      
      console.log(`[ingest][${timeframeMin}m] Loop iteration complete:`, {
        fetched: result.fetched,
        inserted: result.inserted,
        maxTsAfter,
      });
      
      // Rate limiting: small delay between timeframes
      if (timeframeMin !== timeframes[timeframes.length - 1]) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`[ingest][${timeframeMin}m] Error in iteration:`, error.message);
      errors[timeframeMin] = error.message;
      results[timeframeMin] = {
        timeframeMin,
        fetched: 0,
        inserted: 0,
        error: error.message,
      };
    }
  }
  
  // Summary
  const totalFetched = Object.values(results).reduce((sum, r) => sum + (r.fetched || 0), 0);
  const totalInserted = Object.values(results).reduce((sum, r) => sum + (r.inserted || 0), 0);
  
  console.log(`[ingest] Iteration complete:`, {
    symbol,
    totalFetched,
    totalInserted,
    timeframes: Object.keys(results).map(tf => {
      const r = results[tf];
      return `${tf}m: fetched=${r.fetched || 0}, inserted=${r.inserted || 0}${r.error ? `, error=${r.error}` : ''}`;
    }).join(', '),
    errors: Object.keys(errors).length > 0 ? errors : null,
  });
  
  return {
    symbol,
    results,
    errors: Object.keys(errors).length > 0 ? errors : null,
    totals: {
      fetched: totalFetched,
      inserted: totalInserted,
    },
  };
}

/**
 * CLI entry point
 */
async function main() {
  let config;
  try {
    config = getEnvConfig();
  } catch (error) {
    console.error(`[ingest] Configuration error:`, error.message);
    process.exit(1);
  }
  
  const { symbol, timeframes, pollSeconds, backfill, startTs, endTs, dryRun } = config;
  
  // Startup logging
  console.log(`[ingest] Starting candle ingest worker:`, {
    symbol,
    timeframes: timeframes.join(','),
    pollSeconds,
    mode: backfill ? 'backfill' : 'continuous',
    dryRun,
    startTs: backfill ? startTs : null,
    endTs: backfill ? endTs : null,
  });
  
  // Validate backfill mode
  if (backfill && (!startTs || !endTs)) {
    console.error(`[ingest] Error: BACKFILL mode requires BACKFILL_START_TS and BACKFILL_END_TS`);
    process.exit(1);
  }
  
  // Backfill mode: run once and exit
  if (backfill) {
    try {
      const result = await runIngestIteration(config);
      
      // Exit with error code if any timeframes failed
      if (result.errors && Object.keys(result.errors).length > 0) {
        console.error(`[ingest] Some timeframes failed:`, result.errors);
        process.exit(1);
      }
      
      console.log(`[ingest] ✓ Backfill complete successfully`);
      process.exit(0);
    } catch (error) {
      console.error(`[ingest] ✗ Fatal error:`, error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }
  
  // Continuous mode: run forever
  console.log(`[ingest] Entering continuous mode (polling every ${pollSeconds}s)`);
  
  let iterationCount = 0;
  let lastError = null;
  
  while (true) {
    iterationCount++;
    const iterationStart = Date.now();
    
    try {
      console.log(`[ingest] Starting iteration #${iterationCount}`);
      const result = await runIngestIteration(config);
      
      // Log iteration summary
      const durationMs = Date.now() - iterationStart;
      console.log(`[ingest] Iteration #${iterationCount} complete in ${durationMs}ms:`, {
        fetched: result.totals.fetched,
        inserted: result.totals.inserted,
        errors: result.errors ? Object.keys(result.errors).length : 0,
      });
      
      lastError = null;
    } catch (error) {
      // Log error but continue to next iteration
      console.error(`[ingest] Iteration #${iterationCount} failed:`, error.message);
      console.error(`[ingest] Error stack:`, error.stack);
      lastError = error;
    }
    
    // Wait before next iteration
    console.log(`[ingest] Waiting ${pollSeconds}s before next iteration...`);
    await new Promise(resolve => setTimeout(resolve, pollSeconds * 1000));
  }
}

// Run if called directly (Node.js ESM)
// In Node.js ESM, check if this file is being run directly
import { fileURLToPath } from 'url';
import { basename } from 'path';

const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('candleIngest.mjs') ||
  basename(process.argv[1]) === basename(__filename)
);

if (isMainModule) {
  main().catch(error => {
    console.error('[ingest] Unhandled error:', error);
    process.exit(1);
  });
}

