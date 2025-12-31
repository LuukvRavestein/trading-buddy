/**
 * Market Data Ingest
 * 
 * Fetches candles from Deribit and stores them in Supabase.
 * Handles backfill on first run and incremental updates.
 */

import { getCandles } from '../exchanges/deribitClient.mjs';
import { subscribeToTrades } from '../exchanges/deribitWebSocket.js';
import { processTrade, setDataSource, getDataSource, onCandleComplete, getLatestCandles as getWSCandles } from './candleBuilder.js';
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
    // Use current market time (with buffer for testnet)
    let startTs;
    let endTs = getCurrentMarketTime();

    if (backfill) {
      // Backfill: fetch last 100 candles (reduced from 500 to avoid "no_data")
      // Deribit testnet may not have extensive historical data
      const candleDurationMs = timeframeMin * 60 * 1000;
      const backfillDurationMs = 100 * candleDurationMs;
      startTs = endTs - backfillDurationMs;
    } else {
      // Incremental: fetch from last candle minus overlap
      const latestTs = await getLatestCandleTimestamp(SYMBOL, timeframeMin);
      if (latestTs) {
        // Start from last candle timestamp minus overlap
        // This ensures we have enough data for aggregation and catch any gaps
        const overlapMs = getOverlapDuration(timeframeMin);
        startTs = latestTs.getTime() - overlapMs;
        
        // Ensure start is not before a reasonable point (e.g., 7 days ago)
        const maxHistoryMs = 7 * 24 * 60 * 60 * 1000; // 7 days
        const minStartTs = endTs - maxHistoryMs;
        if (startTs < minStartTs) {
          startTs = minStartTs;
        }
        
        console.log(`[ingest] Incremental fetch for ${timeframeMin}m:`, {
          latestTs: latestTs.toISOString(),
          overlapMinutes: overlapMs / (60 * 1000),
          startTs: new Date(startTs).toISOString(),
          endTs: new Date(endTs).toISOString(),
          windowHours: (endTs - startTs) / (60 * 60 * 1000),
        });
      } else {
        // No candles yet, use backfill default (last 50 candles)
        const candleDurationMs = timeframeMin * 60 * 1000;
        startTs = endTs - (50 * candleDurationMs);
        console.log(`[ingest] Initial fetch for ${timeframeMin}m (no existing candles):`, {
          startTs: new Date(startTs).toISOString(),
          endTs: new Date(endTs).toISOString(),
          candles: 50,
        });
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

    // Try to fetch candles from Deribit API first
    let candles = [];
    let usingWebSocket = false;

    try {
      candles = await getCandles({
        symbol: SYMBOL,
        timeframeMin,
        startTs,
        endTs,
      });
      setDataSource('chart_data');
    } catch (error) {
      // If chart_data API is not available, use WebSocket fallback
      if (error.message === 'CHART_DATA_NOT_AVAILABLE') {
        console.log(`[ingest] Using WebSocket fallback for timeframe ${timeframeMin}`);
        setDataSource('ws-candles');
        usingWebSocket = true;
        
        // For WebSocket, we can only get 1m candles in real-time
        // Higher timeframes need to be aggregated
        if (timeframeMin === 1) {
          // Get latest candles from WebSocket builder
          candles = getWSCandles(SYMBOL, 100);
          
          // Filter by time range
          candles = candles.filter(c => c.t >= startTs && c.t <= endTs);
        } else {
          // For higher timeframes, we need to aggregate from 1m
          // For now, return empty - aggregation will be handled separately
          return {
            timeframeMin,
            newCandles: 0,
            skipped: false,
            reason: 'WebSocket mode: higher timeframes need aggregation (not yet implemented)',
            dataSource: 'ws-candles',
          };
        }
      } else {
        // Other errors, rethrow
        throw error;
      }
    }

    if (candles.length === 0 && !usingWebSocket) {
      // "no_data" is normal for testnet or when requesting future dates
      return {
        timeframeMin,
        newCandles: 0,
        skipped: false,
        reason: 'No candles returned from Deribit (no_data)',
        note: 'This is normal for testnet or when data is not available for the requested period',
        dataSource: getDataSource(),
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
      latestTimestamp: candles.length > 0 ? new Date(candles[candles.length - 1].t).toISOString() : null,
      dataSource: getDataSource(),
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

/**
 * Initialize WebSocket trades subscription (for fallback mode)
 */
export async function initializeWebSocketFallback() {
  try {
    // Subscribe to trades and process them into candles
    await subscribeToTrades(SYMBOL, (trade) => {
      processTrade(trade, SYMBOL);
    });

    // Register callback to save completed 1m candles to Supabase
    onCandleComplete(SYMBOL, 1, async (candleData) => {
      try {
        const supabaseCandle = {
          symbol: candleData.symbol,
          timeframe_min: candleData.timeframeMin,
          ts: new Date(candleData.candle.t).toISOString(),
          open: candleData.candle.o.toString(),
          high: candleData.candle.h.toString(),
          low: candleData.candle.l.toString(),
          close: candleData.candle.c.toString(),
          volume: candleData.candle.v.toString(),
          source: 'deribit_ws',
        };
        
        await upsertCandles([supabaseCandle]);
        console.log(`[ingest] Saved 1m candle from WebSocket: ${supabaseCandle.ts}`);
      } catch (error) {
        console.error('[ingest] Error saving WebSocket candle:', error);
      }
    });

    console.log(`[ingest] ✅ WebSocket fallback initialized for ${SYMBOL}`);
  } catch (error) {
    console.error('[ingest] Error initializing WebSocket fallback:', error);
    throw error;
  }
}

/**
 * Get current market time (Deribit server time)
 * Returns current time minus 15 seconds to avoid partial candles
 * 
 * @returns {number} Current timestamp in milliseconds
 */
function getCurrentMarketTime() {
  const now = Date.now();
  const bufferMs = 15 * 1000; // 15 seconds buffer to avoid partial candle
  return now - bufferMs;
}

/**
 * Get overlap duration for incremental ingest based on timeframe
 * Higher timeframes need more overlap because they aggregate from lower timeframes
 * 
 * @param {number} timeframeMin - Timeframe in minutes
 * @returns {number} Overlap duration in milliseconds
 */
function getOverlapDuration(timeframeMin) {
  const overlapMap = {
    1: 5 * 60 * 1000,      // 1m: 5 minutes overlap
    5: 30 * 60 * 1000,     // 5m: 30 minutes overlap
    15: 2 * 60 * 60 * 1000, // 15m: 2 hours overlap
    60: 12 * 60 * 60 * 1000, // 60m: 12 hours overlap
  };
  
  // Default to 1 hour if timeframe not in map
  return overlapMap[timeframeMin] || 60 * 60 * 1000;
}

