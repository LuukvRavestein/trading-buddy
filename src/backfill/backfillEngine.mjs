/**
 * Backfill Engine
 * 
 * One-time historical backfill of candles from Deribit to Supabase.
 * Fetches candles in batches and upserts them efficiently.
 */

import { getCandles } from '../exchanges/deribitClient.mjs';
import { upsertCandles } from '../db/supabaseClient.js';

/**
 * Convert candle from Deribit format to Supabase format
 */
function convertCandleToSupabase(candle, symbol, timeframeMin) {
  return {
    symbol,
    timeframe_min: timeframeMin,
    ts: new Date(candle.t).toISOString(), // Convert milliseconds to ISO string
    open: candle.o.toString(),
    high: candle.h.toString(),
    low: candle.l.toString(),
    close: candle.c.toString(),
    volume: candle.v ? candle.v.toString() : null,
    source: 'deribit',
  };
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run backfill for a single timeframe
 * 
 * @param {object} options
 * @param {string} options.symbol
 * @param {number} options.timeframeMin
 * @param {string} options.startTs - ISO timestamp
 * @param {string} options.endTs - ISO timestamp
 * @param {number} options.batchLimit - Max candles per batch
 * @param {number} options.overlapMinutes - Overlap in minutes
 * @returns {Promise<object>} Result with totals
 */
async function backfillTimeframe({ symbol, timeframeMin, startTs, endTs, batchLimit, overlapMinutes }) {
  const startMs = new Date(startTs).getTime();
  const endMs = new Date(endTs).getTime();
  
  // Calculate window size: min(batchLimit * timeframe, 7 days)
  const maxWindowMinutes = 60 * 24 * 7; // 7 days max
  const windowMinutes = Math.min(batchLimit * timeframeMin, maxWindowMinutes);
  const windowMs = windowMinutes * 60 * 1000;
  
  let cursor = startMs;
  let totalFetched = 0;
  let totalUpserted = 0;
  let batchCount = 0;
  let lastCandleTs = null;
  
  console.log(`[backfill] Starting ${timeframeMin}m backfill:`, {
    symbol,
    timeframeMin,
    range: `${startTs} to ${endTs}`,
    windowMinutes,
    batchLimit,
    overlapMinutes,
  });
  
  while (cursor < endMs) {
    batchCount++;
    
    // Calculate window end
    const windowEnd = Math.min(cursor + windowMs, endMs);
    const windowStartIso = new Date(cursor).toISOString();
    const windowEndIso = new Date(windowEnd).toISOString();
    
    try {
      // Fetch candles from Deribit
      const candles = await getCandles({
        symbol,
        timeframeMin,
        startTs: cursor,
        endTs: windowEnd,
      });
      
      if (candles && candles.length > 0) {
        // Convert to Supabase format
        const supabaseCandles = candles.map(c => convertCandleToSupabase(c, symbol, timeframeMin));
        
        // Upsert to Supabase
        const upserted = await upsertCandles(supabaseCandles);
        const upsertedCount = upserted ? upserted.length : supabaseCandles.length;
        
        totalFetched += candles.length;
        totalUpserted += upsertedCount;
        
        // Update cursor to last candle + timeframe (with overlap)
        const lastCandle = candles[candles.length - 1];
        lastCandleTs = new Date(lastCandle.t).toISOString();
        const lastCandleMs = lastCandle.t;
        cursor = lastCandleMs + (timeframeMin * 60 * 1000) - (overlapMinutes * 60 * 1000);
        
        console.log(`[backfill] ${timeframeMin}m batch ${batchCount}:`, {
          range: `${windowStartIso} to ${windowEndIso}`,
          fetched: candles.length,
          upserted: upsertedCount,
          lastTs: lastCandleTs,
          cursor: new Date(cursor).toISOString(),
          cumulative: { fetched: totalFetched, upserted: totalUpserted },
        });
      } else {
        // No candles returned - move cursor forward by window size
        console.log(`[backfill] ${timeframeMin}m batch ${batchCount}: No candles in range ${windowStartIso} to ${windowEndIso}, moving forward`);
        cursor = windowEnd + (timeframeMin * 60 * 1000);
      }
      
      // Rate limiting: small delay between calls
      await sleep(200);
      
    } catch (error) {
      console.error(`[backfill] Error in ${timeframeMin}m batch ${batchCount}:`, error.message);
      
      // On error, move cursor forward to avoid infinite loop
      cursor = windowEnd + (timeframeMin * 60 * 1000);
      
      // Continue with next batch
      continue;
    }
    
    // Safety: prevent infinite loops
    if (batchCount > 10000) {
      console.warn(`[backfill] Stopped ${timeframeMin}m backfill after 10000 batches (safety limit)`);
      break;
    }
  }
  
  console.log(`[backfill] Completed ${timeframeMin}m backfill:`, {
    symbol,
    timeframeMin,
    batches: batchCount,
    totalFetched,
    totalUpserted,
    lastCandleTs,
  });
  
  return {
    timeframeMin,
    batches: batchCount,
    totalFetched,
    totalUpserted,
    lastCandleTs,
  };
}

/**
 * Run backfill for all timeframes
 * 
 * @param {object} options
 * @param {string} options.symbol
 * @param {string} options.startTs - ISO timestamp
 * @param {string} options.endTs - ISO timestamp
 * @param {Array<number>} options.timeframes - Array of timeframe minutes
 * @param {number} options.batchLimit - Max candles per batch
 * @param {number} options.overlapMinutes - Overlap in minutes (default: timeframe * 2)
 * @returns {Promise<object>} Results for all timeframes
 */
export async function runBackfill({ symbol, startTs, endTs, timeframes, batchLimit, overlapMinutes }) {
  console.log(`[backfill] Starting backfill:`, {
    symbol,
    startTs,
    endTs,
    timeframes,
    batchLimit,
    overlapMinutes,
  });
  
  const results = {};
  
  for (const timeframeMin of timeframes) {
    // Calculate overlap: default to timeframe * 2, or use provided value
    const tfOverlap = overlapMinutes || (timeframeMin * 2);
    
    const result = await backfillTimeframe({
      symbol,
      timeframeMin,
      startTs,
      endTs,
      batchLimit,
      overlapMinutes: tfOverlap,
    });
    
    results[timeframeMin] = result;
  }
  
  // Summary
  console.log(`[backfill] Backfill complete - totals:`, {
    symbol,
    timeframes: Object.keys(results).map(tf => {
      const r = results[tf];
      return `${tf}m: fetched=${r.totalFetched}, upserted=${r.totalUpserted}`;
    }).join(', '),
  });
  
  return results;
}

