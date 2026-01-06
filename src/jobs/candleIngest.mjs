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
import { normalizeISO } from '../utils/time.mjs';

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
 * @param {object} options
 * @param {string} options.symbol - Symbol (default: BTC-PERPETUAL)
 * @param {string} options.startTs - Start timestamp (ISO string, optional for continuous mode)
 * @param {string} options.endTs - End timestamp (ISO string, optional for continuous mode)
 * @param {boolean} options.backfill - If true, use explicit startTs/endTs; if false, determine from DB
 * @param {boolean} options.dryRun - Skip DB writes if true
 * @returns {Promise<object>} Results for all timeframes
 */
export async function runCandleIngest({ symbol = 'BTC-PERPETUAL', startTs, endTs, backfill = false, dryRun = false }) {
  console.log(`[ingest] Starting candle ingest:`, {
    symbol,
    backfill,
    dryRun,
    startTs,
    endTs,
  });
  
  const results = {};
  const errors = {};
  
  // Determine ingest range for each timeframe
  for (const timeframeMin of TIMEFRAMES) {
    try {
      let ingestStartTs = startTs;
      let ingestEndTs = endTs;
      
      if (!backfill) {
        // Continuous mode: determine range from DB
        const maxTs = await getMaxCandleTs({ symbol, timeframeMin });
        
        if (maxTs) {
          // Start from next candle after maxTs
          const maxDate = new Date(maxTs);
          const nextCandleMs = maxDate.getTime() + (timeframeMin * 60 * 1000);
          ingestStartTs = new Date(nextCandleMs).toISOString();
        } else {
          // No data in DB, start from 1 day ago
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          ingestStartTs = roundTsToTimeframe(oneDayAgo.toISOString(), timeframeMin);
        }
        
        // End at current time, rounded to timeframe
        const now = new Date();
        ingestEndTs = roundTsToTimeframe(now.toISOString(), timeframeMin);
        
        console.log(`[ingest][${timeframeMin}m] Continuous mode:`, {
          maxTs,
          ingestStartTs,
          ingestEndTs,
        });
      } else {
        // Backfill mode: use explicit range
        if (!ingestStartTs || !ingestEndTs) {
          throw new Error(`Backfill mode requires startTs and endTs`);
        }
        
        // Round to timeframe boundaries
        ingestStartTs = roundTsToTimeframe(ingestStartTs, timeframeMin);
        ingestEndTs = roundTsToTimeframe(ingestEndTs, timeframeMin);
        
        console.log(`[ingest][${timeframeMin}m] Backfill mode:`, {
          ingestStartTs,
          ingestEndTs,
        });
      }
      
      // Validate range
      const startMs = new Date(ingestStartTs).getTime();
      const endMs = new Date(ingestEndTs).getTime();
      
      if (startMs >= endMs) {
        console.warn(`[ingest][${timeframeMin}m] Skipping: startTs >= endTs (${ingestStartTs} >= ${ingestEndTs})`);
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
      
      // Rate limiting: small delay between timeframes
      if (timeframeMin !== TIMEFRAMES[TIMEFRAMES.length - 1]) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`[ingest][${timeframeMin}m] Error:`, error.message);
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
  
  console.log(`[ingest] Ingest complete:`, {
    symbol,
    backfill,
    dryRun,
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
    backfill,
    dryRun,
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
  const symbol = process.env.SYMBOL || 'BTC-PERPETUAL';
  const backfill = process.env.BACKFILL === 'true';
  const dryRun = process.env.DRY_RUN === 'true';
  const startTs = process.env.BACKFILL_START_TS ? normalizeISO(process.env.BACKFILL_START_TS) : null;
  const endTs = process.env.BACKFILL_END_TS ? normalizeISO(process.env.BACKFILL_END_TS) : null;
  
  console.log(`[ingest] CLI starting:`, {
    symbol,
    backfill,
    dryRun,
    startTs,
    endTs,
  });
  
  if (backfill && (!startTs || !endTs)) {
    console.error(`[ingest] Error: BACKFILL=true requires BACKFILL_START_TS and BACKFILL_END_TS`);
    process.exit(1);
  }
  
  try {
    const result = await runCandleIngest({
      symbol,
      startTs,
      endTs,
      backfill,
      dryRun,
    });
    
    // Exit with error code if any timeframes failed
    if (result.errors && Object.keys(result.errors).length > 0) {
      console.error(`[ingest] Some timeframes failed:`, result.errors);
      process.exit(1);
    }
    
    console.log(`[ingest] ✓ Ingest complete successfully`);
    process.exit(0);
  } catch (error) {
    console.error(`[ingest] ✗ Fatal error:`, error.message);
    console.error(error.stack);
    process.exit(1);
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

