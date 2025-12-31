/**
 * Market Data Ingest
 * 
 * Fetches candles from Deribit and stores them in Supabase.
 * Handles backfill on first run and incremental updates.
 */

import { getCandles } from '../exchanges/deribitClient.js';
import { upsertCandles, getLatestCandles } from '../db/supabaseClient.js';

const SYMBOL = process.env.SYMBOL || 'BTC-PERPETUAL';
const TIMEFRAMES = (process.env.TIMEFRAMES || '1,5,15,60').split(',').map(t => parseInt(t.trim(), 10));

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
 * Get latest candle timestamp from Supabase
 * 
 * @param {string} symbol
 * @param {number} timeframeMin
 * @returns {Promise<Date|null>} Latest candle timestamp or null if no candles
 */
async function getLatestCandleTimestamp(symbol, timeframeMin) {
  const candles = await getLatestCandles({ symbol, timeframeMin, limit: 1 });
  if (candles.length === 0) {
    return null;
  }
  return new Date(candles[0].ts);
}

/**
 * Ingest candles for a specific timeframe
 * 
 * @param {number} timeframeMin - Timeframe in minutes
 * @param {boolean} backfill - Whether to backfill (fetch last 500 candles)
 * @returns {Promise<object>} Result with count of new candles
 */
export async function ingestTimeframe(timeframeMin, backfill = false) {
  try {
    // Determine time range
    let startTs;
    let endTs = Date.now();

    if (backfill) {
      // Backfill: fetch last 500 candles
      // Calculate start time based on timeframe
      const candleDurationMs = timeframeMin * 60 * 1000;
      const backfillDurationMs = 500 * candleDurationMs;
      startTs = endTs - backfillDurationMs;
    } else {
      // Incremental: fetch from last candle + 1 candle
      const latestTs = await getLatestCandleTimestamp(SYMBOL, timeframeMin);
      if (latestTs) {
        // Start from next candle after latest
        const candleDurationMs = timeframeMin * 60 * 1000;
        startTs = latestTs.getTime() + candleDurationMs;
      } else {
        // No candles yet, fetch last 100 as initial load
        const candleDurationMs = timeframeMin * 60 * 1000;
        startTs = endTs - (100 * candleDurationMs);
      }
    }

    // Don't fetch if start is in the future
    if (startTs >= endTs) {
      return {
        timeframeMin,
        newCandles: 0,
        skipped: true,
        reason: 'No new candles available',
      };
    }

    // Fetch candles from Deribit
    const candles = await getCandles({
      symbol: SYMBOL,
      timeframeMin,
      startTs,
      endTs,
    });

    if (candles.length === 0) {
      return {
        timeframeMin,
        newCandles: 0,
        skipped: false,
        reason: 'No candles returned from Deribit',
      };
    }

    // Convert to Supabase format
    const supabaseCandles = candles.map(candle =>
      convertCandleToSupabase(candle, SYMBOL, timeframeMin)
    );

    // Upsert to Supabase (handles duplicates via UNIQUE constraint)
    await upsertCandles(supabaseCandles);

    return {
      timeframeMin,
      newCandles: candles.length,
      skipped: false,
      latestTimestamp: new Date(candles[candles.length - 1].t).toISOString(),
    };
  } catch (error) {
    console.error(`[ingest] Error ingesting timeframe ${timeframeMin}:`, error);
    throw error;
  }
}

/**
 * Ingest all timeframes
 * 
 * @param {boolean} backfill - Whether to backfill
 * @returns {Promise<object>} Results for all timeframes
 */
export async function ingestAllTimeframes(backfill = false) {
  const results = {};

  for (const timeframeMin of TIMEFRAMES) {
    try {
      results[timeframeMin] = await ingestTimeframe(timeframeMin, backfill);
    } catch (error) {
      console.error(`[ingest] Failed to ingest timeframe ${timeframeMin}:`, error);
      results[timeframeMin] = {
        timeframeMin,
        error: error.message,
      };
    }
  }

  return results;
}

/**
 * Check if backfill is needed (no candles in database)
 * 
 * @returns {Promise<boolean>} True if backfill is needed
 */
export async function needsBackfill() {
  try {
    // Check if we have any candles for the first timeframe
    const candles = await getLatestCandles({
      symbol: SYMBOL,
      timeframeMin: TIMEFRAMES[0],
      limit: 1,
    });
    return candles.length === 0;
  } catch (error) {
    console.error('[ingest] Error checking backfill status:', error);
    // If error, assume we need backfill
    return true;
  }
}

