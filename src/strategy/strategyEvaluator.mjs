/**
 * Strategy Evaluator
 * 
 * Evaluates deterministic trading strategy based on timeframe_state.
 * Returns trade proposal if setup is valid, null otherwise.
 */

import { getLatestTimeframeState } from '../db/supabaseClient.js';
import { getLatestCandles } from '../db/supabaseClient.js';

const MIN_RISK_PCT = parseFloat(process.env.MIN_RISK_PCT || '0.1', 10) / 100; // 0.1% minimum
const TARGET_RR = parseFloat(process.env.TARGET_RR || '2.0', 10); // 2.0 risk/reward
const ATR_SL_MULTIPLIER = parseFloat(process.env.ATR_SL_MULTIPLIER || '0.2', 10); // 0.2 × ATR for SL buffer
const STRATEGY_DEBUG = process.env.STRATEGY_DEBUG === '1';

/**
 * Evaluate strategy and return proposal if valid setup
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol (e.g., 'BTC-PERPETUAL')
 * @param {number} options.nowMs - Current timestamp in milliseconds (required)
 * @param {string} options.nowIso - Current timestamp as ISO string (optional, for debug)
 * @returns {Promise<object|null>} Proposal object or null
 */
export async function evaluateStrategy({ symbol, nowMs, nowIso }) {
  try {
    // Validate required parameters
    if (!nowMs || isNaN(nowMs)) {
      console.error('[strategy] Invalid nowMs parameter');
      return null;
    }
    
    // Fetch latest timeframe_state for 1m, 5m, 15m
    const [state1m, state5m, state15m] = await Promise.all([
      getLatestTimeframeState({ symbol, timeframeMin: 1 }),
      getLatestTimeframeState({ symbol, timeframeMin: 5 }),
      getLatestTimeframeState({ symbol, timeframeMin: 15 }),
    ]);
    
    // Validate data freshness using consistent nowMs
    const states = [
      { tf: '1m', timeframeMin: 1, state: state1m },
      { tf: '5m', timeframeMin: 5, state: state5m },
      { tf: '15m', timeframeMin: 15, state: state15m },
    ];
    
    for (const { tf, timeframeMin, state } of states) {
      if (!state || !state.ts) {
        console.log(`[strategy] Missing ${tf} state`);
        return null;
      }
      
      // Use Date.parse() to convert ISO string to milliseconds
      const tsMs = Date.parse(state.ts);
      
      // Handle NaN from Date.parse
      if (isNaN(tsMs)) {
        console.error(`[strategy] Invalid timestamp in ${tf} state: ${state.ts}`);
        return null;
      }
      
      // Dynamic threshold: 3 candles + 90s buffer (more tolerant)
      const thresholdMs = (timeframeMin * 60_000 * 3) + 90_000;
      const ageMs = nowMs - tsMs;
      
      // Debug logging
      if (STRATEGY_DEBUG) {
        console.log(`[strategy] 🔍 DEBUG ${tf} freshness:`, {
          nowIso: nowIso || new Date(nowMs).toISOString(),
          nowMs,
          stateTs: state.ts,
          tsMs,
          ageMs,
          thresholdMs,
          isFresh: ageMs <= thresholdMs,
        });
      }
      
      if (ageMs > thresholdMs) {
        console.log(`[strategy] ${tf} state too old: ${ageMs}ms (threshold: ${thresholdMs}ms)`);
        return null;
      }
    }
    
    // Step 1: Direction filter (HTF context)
    // Long only if: 15m trend == "up" AND 5m trend == "up"
    // Short only if: 15m trend == "down" AND 5m trend == "down"
    const direction = determineDirection(state5m, state15m);
    if (!direction) {
      console.log('[strategy] No valid direction: HTF trends do not align');
      return null;
    }
    
    // Step 2: Entry trigger (LTF - 1m)
    const entryTrigger = checkEntryTrigger(state1m, direction);
    if (!entryTrigger) {
      console.log(`[strategy] No entry trigger for ${direction} on 1m`);
      return null;
    }
    
    // Step 3: Get latest 1m candle for entry price
    const candles1m = await getLatestCandles({ symbol, timeframeMin: 1, limit: 1 });
    if (candles1m.length === 0) {
      console.log('[strategy] No 1m candles available');
      return null;
    }
    
    const latestCandle = candles1m[0];
    const entryPrice = parseFloat(latestCandle.close);
    
    // Step 4: Calculate Stop Loss
    // Long: last 1m swing low - (0.2 × ATR(1m))
    // Short: last 1m swing high + (0.2 × ATR(1m))
    const atr1m = state1m.atr ? parseFloat(state1m.atr) : null;
    if (!atr1m || atr1m <= 0) {
      console.log('[strategy] ATR(1m) is null or invalid');
      return null;
    }
    
    const swingHigh1m = state1m.last_swing_high ? parseFloat(state1m.last_swing_high) : null;
    const swingLow1m = state1m.last_swing_low ? parseFloat(state1m.last_swing_low) : null;
    
    if (!swingHigh1m || !swingLow1m) {
      console.log('[strategy] Missing swing points on 1m');
      return null;
    }
    
    let stopLoss;
    if (direction === 'long') {
      stopLoss = swingLow1m - (ATR_SL_MULTIPLIER * atr1m);
    } else {
      stopLoss = swingHigh1m + (ATR_SL_MULTIPLIER * atr1m);
    }
    
    // Step 5: Validate SL distance
    const slDistance = Math.abs(entryPrice - stopLoss);
    const slDistancePct = (slDistance / entryPrice) * 100;
    
    if (slDistancePct < MIN_RISK_PCT * 100) {
      console.log(`[strategy] SL distance too small: ${slDistancePct.toFixed(4)}% < ${MIN_RISK_PCT * 100}%`);
      return null;
    }
    
    // Step 6: Calculate Take Profit (fixed RR = 2.0)
    let takeProfit;
    if (direction === 'long') {
      takeProfit = entryPrice + (TARGET_RR * slDistance);
    } else {
      takeProfit = entryPrice - (TARGET_RR * slDistance);
    }
    
    // Step 7: Calculate actual RR
    const reward = Math.abs(takeProfit - entryPrice);
    const risk = slDistance;
    const rr = reward / risk;
    
    // Build proposal
    const proposal = {
      symbol,
      direction,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      rr: rr,
      timeframe_context: {
        t1m: {
          trend: state1m.trend,
          atr: state1m.atr,
          last_swing_high: state1m.last_swing_high,
          last_swing_low: state1m.last_swing_low,
          bos_direction: state1m.bos_direction,
          choch_direction: state1m.choch_direction,
          ts: state1m.ts,
        },
        t5m: {
          trend: state5m.trend,
          atr: state5m.atr,
          last_swing_high: state5m.last_swing_high,
          last_swing_low: state5m.last_swing_low,
          ts: state5m.ts,
        },
        t15m: {
          trend: state15m.trend,
          atr: state15m.atr,
          last_swing_high: state15m.last_swing_high,
          last_swing_low: state15m.last_swing_low,
          ts: state15m.ts,
        },
      },
      reason: buildReason(direction, entryTrigger, state1m, state5m, state15m),
    };
    
    return proposal;
  } catch (error) {
    console.error('[strategy] Error evaluating strategy:', error);
    return null;
  }
}

/**
 * Determine direction based on HTF trends
 * 
 * @param {object} state5m - 5m timeframe state
 * @param {object} state15m - 15m timeframe state
 * @returns {string|null} 'long', 'short', or null
 */
function determineDirection(state5m, state15m) {
  // Long only if: 15m trend == "up" AND 5m trend == "up"
  if (state15m.trend === 'up' && state5m.trend === 'up') {
    return 'long';
  }
  
  // Short only if: 15m trend == "down" AND 5m trend == "down"
  if (state15m.trend === 'down' && state5m.trend === 'down') {
    return 'short';
  }
  
  return null;
}

/**
 * Check entry trigger on 1m timeframe
 * 
 * @param {object} state1m - 1m timeframe state
 * @param {string} direction - 'long' or 'short'
 * @returns {boolean} True if trigger is valid
 */
function checkEntryTrigger(state1m, direction) {
  // Long setup:
  // - Last 1m CHoCH direction == "up"
  // - OR last BOS direction == "up"
  if (direction === 'long') {
    return state1m.choch_direction === 'up' || state1m.bos_direction === 'up';
  }
  
  // Short setup:
  // - Last 1m CHoCH direction == "down"
  // - OR last BOS direction == "down"
  if (direction === 'short') {
    return state1m.choch_direction === 'down' || state1m.bos_direction === 'down';
  }
  
  return false;
}

/**
 * Build human-readable reason for proposal
 * 
 * @param {string} direction - 'long' or 'short'
 * @param {string} entryTrigger - Trigger type
 * @param {object} state1m - 1m state
 * @param {object} state5m - 5m state
 * @param {object} state15m - 15m state
 * @returns {string} Reason string
 */
function buildReason(direction, entryTrigger, state1m, state5m, state15m) {
  const parts = [];
  
  // HTF context
  parts.push(`${state15m.trend.toUpperCase()} 15m + ${state5m.trend.toUpperCase()} 5m`);
  
  // Entry trigger
  if (state1m.choch_direction === direction) {
    parts.push(`1m CHoCH ${direction}`);
  } else if (state1m.bos_direction === direction) {
    parts.push(`1m BOS ${direction}`);
  }
  
  return parts.join(' + ');
}

