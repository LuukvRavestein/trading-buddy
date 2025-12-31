/**
 * State Runner
 * 
 * Orchestrates fetching candles and computing timeframe state.
 * Only processes new candles since last state.
 */

import { getLatestCandles, getLatestTimeframeState, upsertTimeframeState } from '../db/supabaseClient.js';
import { buildTimeframeState } from './stateBuilder.mjs';

const STATE_LOOKBACK = parseInt(process.env.STATE_LOOKBACK || '500', 10);

/**
 * Run state update for a single timeframe
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol (e.g., 'BTC-PERPETUAL')
 * @param {number} options.timeframeMin - Timeframe in minutes
 * @returns {Promise<object>} Result object
 */
export async function runStateUpdateForTimeframe({ symbol, timeframeMin }) {
  try {
    // Get last state timestamp
    const lastState = await getLatestTimeframeState({ symbol, timeframeMin });
    let lastStateTs = null;
    
    if (lastState && lastState.ts) {
      lastStateTs = new Date(lastState.ts);
    }
    
    // Determine lookback window
    // If we have last state, fetch from (lastStateTs - lookback) to now
    // Otherwise, fetch last STATE_LOOKBACK candles
    let startTs = null;
    if (lastStateTs) {
      // Fetch from last state minus lookback window
      startTs = lastStateTs.getTime() - (STATE_LOOKBACK * timeframeMin * 60 * 1000);
    }
    
    // Fetch candles
    const allCandles = await getLatestCandles({
      symbol,
      timeframeMin,
      limit: STATE_LOOKBACK,
    });
    
    if (allCandles.length === 0) {
      return {
        timeframeMin,
        success: false,
        reason: 'No candles available',
      };
    }
    
    // Filter to only new candles if we have last state
    let candlesToProcess = allCandles;
    if (lastStateTs) {
      candlesToProcess = allCandles.filter(c => {
        const candleTs = new Date(c.ts);
        return candleTs > lastStateTs;
      });
      
      // If no new candles, check if we should still update (in case of gaps)
      if (candlesToProcess.length === 0) {
        // Use all candles for state computation (might have gaps to fill)
        candlesToProcess = allCandles;
      } else {
        // Include some overlap for proper swing detection
        // Include last STATE_LOOKBACK candles total
        candlesToProcess = allCandles.slice(-STATE_LOOKBACK);
      }
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
    
    // Sort by timestamp
    candles.sort((a, b) => a.t - b.t);
    
    // Build state
    const state = buildTimeframeState({
      symbol,
      timeframeMin,
      candles,
    });
    
    // Check if state has advanced (new candle processed)
    if (lastStateTs && new Date(state.ts) <= lastStateTs) {
      return {
        timeframeMin,
        success: false,
        reason: 'No new candles to process',
        lastStateTs: lastStateTs.toISOString(),
        currentStateTs: state.ts,
      };
    }
    
    // Upsert state
    await upsertTimeframeState(state);
    
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
  
  return results;
}

