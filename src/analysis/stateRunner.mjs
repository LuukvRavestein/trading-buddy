/**
 * State Runner
 * 
 * Orchestrates fetching candles and computing timeframe state.
 * Only processes new candles since last state.
 */

import { getLatestCandles, getLatestTimeframeState, upsertTimeframeState, getSupabaseClient, isSupabaseConfigured } from '../db/supabaseClient.js';
import { buildTimeframeState } from './stateBuilder.mjs';

const STATE_LOOKBACK = parseInt(process.env.STATE_LOOKBACK || '500', 10);
const STATE_DEBUG = process.env.STATE_DEBUG === '1' || process.env.STRATEGY_DEBUG === '1';

/**
 * Run state update for a single timeframe
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol (e.g., 'BTC-PERPETUAL')
 * @param {number} options.timeframeMin - Timeframe in minutes
 * @returns {Promise<object>} Result object
 */
export async function runStateUpdateForTimeframe({ symbol, timeframeMin }) {
  console.log(`[stateRunner] State update start: ${timeframeMin}m, symbol: ${symbol}`);
  
  try {
    // Debug: Query max candle ts for this timeframe
    if (STATE_DEBUG && isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        const url = `${client.url}/rest/v1/candles?symbol=eq.${symbol}&timeframe_min=eq.${timeframeMin}&order=ts.desc&limit=1&select=ts`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'apikey': client.key,
            'Authorization': `Bearer ${client.key}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            console.log(`[stateRunner] 🔍 DEBUG ${timeframeMin}m: Max candle ts in DB: ${data[0].ts}`);
          } else {
            console.log(`[stateRunner] 🔍 DEBUG ${timeframeMin}m: No candles found in DB`);
          }
        }
      } catch (debugError) {
        console.error(`[stateRunner] Debug query error:`, debugError);
      }
    }
    
    // Get last state timestamp
    const lastState = await getLatestTimeframeState({ symbol, timeframeMin });
    let lastStateTs = null;
    
    if (lastState && lastState.ts) {
      lastStateTs = new Date(lastState.ts);
      console.log(`[stateRunner] ${timeframeMin}m: Last state ts: ${lastState.ts}`);
    } else {
      console.log(`[stateRunner] ${timeframeMin}m: No previous state found`);
    }
    
    // Determine lookback window
    // If we have last state, fetch from (lastStateTs - lookback) to now
    // Otherwise, fetch last STATE_LOOKBACK candles
    let startTs = null;
    if (lastStateTs) {
      // Fetch from last state minus lookback window
      startTs = lastStateTs.getTime() - (STATE_LOOKBACK * timeframeMin * 60 * 1000);
    }
    
    // Fetch candles (ordered desc - newest first)
    const allCandles = await getLatestCandles({
      symbol,
      timeframeMin,
      limit: STATE_LOOKBACK,
    });
    
    console.log(`[stateRunner] ${timeframeMin}m: Fetched ${allCandles.length} candles from DB`);
    
    if (allCandles.length === 0) {
      console.log(`[stateRunner] State skipped ${timeframeMin}m: No candles available`);
      return {
        timeframeMin,
        success: false,
        reason: 'No candles available',
      };
    }
    
    // Verify ordering: first candle should be newest (desc order)
    const firstTs = allCandles[0]?.ts; // Newest (first in desc order)
    const lastTs = allCandles[allCandles.length - 1]?.ts; // Oldest (last in desc order)
    
    if (firstTs) {
      console.log(`[stateRunner] ${timeframeMin}m: Latest candle ts in fetched set: ${firstTs} (newest)`);
    }
    
    // Debug logging
    if (STATE_DEBUG) {
      console.log(`[stateRunner] 🔍 DEBUG ${timeframeMin}m candle fetch:`, {
        fetchedCount: allCandles.length,
        firstTs: firstTs || 'null',
        lastTs: lastTs || 'null',
        firstTsDate: firstTs ? new Date(firstTs).toISOString() : null,
        lastTsDate: lastTs ? new Date(lastTs).toISOString() : null,
        // Verify firstTs matches max ts from DB (should be close)
        maxTsFromDB: latestCandleTs || 'not queried',
      });
    }
    
    // Filter to only new candles if we have last state
    let candlesToProcess = allCandles;
    if (lastStateTs) {
      const newCandles = allCandles.filter(c => {
        const candleTs = new Date(c.ts);
        return candleTs > lastStateTs;
      });
      
      console.log(`[stateRunner] ${timeframeMin}m: Found ${newCandles.length} new candles since last state`);
      
      // If no new candles, check if we should still update (in case of gaps)
      if (newCandles.length === 0) {
        // Use all candles for state computation (might have gaps to fill)
        candlesToProcess = allCandles;
        console.log(`[stateRunner] ${timeframeMin}m: No new candles, using all ${allCandles.length} candles for state computation`);
      } else {
        // Include some overlap for proper swing detection
        // Include last STATE_LOOKBACK candles total
        candlesToProcess = allCandles.slice(-STATE_LOOKBACK);
        console.log(`[stateRunner] ${timeframeMin}m: Using ${candlesToProcess.length} candles (with overlap) for state computation`);
      }
    } else {
      console.log(`[stateRunner] ${timeframeMin}m: No previous state, using all ${allCandles.length} candles for initial state`);
    }
    
    // Convert Supabase candles to stateBuilder format
    const candles = candlesToProcess.map(c => ({
      t: new Date(c.ts).getTime(), // Convert ISO string to milliseconds
      o: parseFloat(c.open),
      h: parseFloat(c.high),
      l: parseFloat(c.low),
      c: parseFloat(c.close),
      v: parseFloat(c.volume || 0),
    }));
    
    // Sort by timestamp (ascending)
    candles.sort((a, b) => a.t - b.t);
    
    if (candles.length === 0) {
      console.log(`[stateRunner] State skipped ${timeframeMin}m: No candles to process after filtering`);
      return {
        timeframeMin,
        success: false,
        reason: 'No candles to process after filtering',
      };
    }
    
    // Build state
    const state = buildTimeframeState({
      symbol,
      timeframeMin,
      candles,
    });
    
    console.log(`[stateRunner] ${timeframeMin}m: Built state with ts: ${state.ts}`);
    
    // Check if state has advanced (new candle processed)
    if (lastStateTs) {
      const stateTsDate = new Date(state.ts);
      if (stateTsDate <= lastStateTs) {
        console.log(`[stateRunner] State skipped ${timeframeMin}m: No new candles to process (state ts ${state.ts} <= last state ts ${lastStateTs.toISOString()})`);
        return {
          timeframeMin,
          success: false,
          reason: 'No new candles to process',
          lastStateTs: lastStateTs.toISOString(),
          currentStateTs: state.ts,
        };
      }
    }
    
    // Upsert state
    console.log(`[stateRunner] ${timeframeMin}m: Upserting state with ts: ${state.ts}, timeframe_min: ${timeframeMin}`);
    await upsertTimeframeState(state);
    
    console.log(`[stateRunner] State updated ${timeframeMin}m: ts=${state.ts}, trend=${state.trend}, candlesProcessed=${candles.length}`);
    
    return {
      timeframeMin,
      success: true,
      state: {
        ts: state.ts,
        trend: state.trend,
        atr: state.atr,
        last_swing_high: state.last_swing_high,
        last_swing_low: state.last_swing_low,
        bos_direction: state.bos_direction,
        choch_direction: state.choch_direction,
      },
      candlesProcessed: candles.length,
    };
  } catch (error) {
    console.error(`[stateRunner] Error updating state for timeframe ${timeframeMin}:`, error);
    return {
      timeframeMin,
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run state update for all timeframes
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol (e.g., 'BTC-PERPETUAL')
 * @param {Array<number>} options.timeframes - Array of timeframe minutes
 * @returns {Promise<object>} Results for all timeframes
 */
export async function runStateUpdate({ symbol, timeframes }) {
  console.log(`[stateRunner] Starting state update for ${timeframes.length} timeframes: [${timeframes.join(', ')}]m, symbol: ${symbol}`);
  const results = {};
  
  for (const timeframeMin of timeframes) {
    try {
      results[timeframeMin] = await runStateUpdateForTimeframe({
        symbol,
        timeframeMin,
      });
    } catch (error) {
      console.error(`[stateRunner] Failed to update state for timeframe ${timeframeMin}:`, error);
      results[timeframeMin] = {
        timeframeMin,
        success: false,
        error: error.message,
      };
    }
  }
  
  // Summary log
  const successful = Object.values(results).filter(r => r.success).length;
  const failed = Object.values(results).filter(r => !r.success).length;
  console.log(`[stateRunner] State update complete: ${successful} successful, ${failed} failed`);
  
  return results;
}

