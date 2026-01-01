/**
 * Strategy Evaluator
 * 
 * Evaluates deterministic trading strategy based on timeframe_state.
 * Returns trade proposal if setup is valid, null otherwise.
 */

import { getLatestTimeframeState, getLatestCandle } from '../db/supabaseClient.js';

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
    // Always orders by ts descending to get most recent state
    const [state1m, state5m, state15m] = await Promise.all([
      getLatestTimeframeState({ symbol, timeframeMin: 1 }),
      getLatestTimeframeState({ symbol, timeframeMin: 5 }),
      getLatestTimeframeState({ symbol, timeframeMin: 15 }),
    ]);
    
    // Debug logging: log fetched state timestamps
    if (STRATEGY_DEBUG) {
      console.log('[strategy] 🔍 DEBUG: Fetched state timestamps:', {
        '1m': state1m?.ts || 'null',
        '5m': state5m?.ts || 'null',
        '15m': state15m?.ts || 'null',
        nowIso: nowIso || new Date(nowMs).toISOString(),
      });
    }
    
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
    // Use 15m as primary trend, allow if 5m is same/chop/null, block only if 5m is opposite
    const directionResult = determineDirection(state5m, state15m);
    if (!directionResult.direction) {
      console.log(`[strategy] No valid direction: ${directionResult.reason}`);
      if (STRATEGY_DEBUG) {
        console.log(`[strategy] 🔍 DEBUG HTF direction:`, {
          trend15m: state15m.trend,
          trend5m: state5m.trend,
          chosenDirection: directionResult.direction,
          blockedReason: directionResult.reason,
        });
      }
      return null;
    }
    
    const direction = directionResult.direction;
    
    if (STRATEGY_DEBUG) {
      console.log(`[strategy] 🔍 DEBUG HTF direction:`, {
        trend15m: state15m.trend,
        trend5m: state5m.trend,
        chosenDirection: direction,
        blockedReason: null,
      });
    }
    
    // Step 2: Get latest 1m candle for entry price and trigger check
    const latestCandle = await getLatestCandle({ symbol, timeframeMin: 1 });
    if (!latestCandle) {
      console.log('[strategy] No 1m candles available');
      return null;
    }
    
    const entryPrice = parseFloat(latestCandle.close);
    const latestCandleHigh = parseFloat(latestCandle.high);
    const latestCandleLow = parseFloat(latestCandle.low);
    
    // Step 3: Entry trigger (LTF - 1m) with primary and fallback
    const entryTrigger = checkEntryTrigger(state1m, direction, latestCandle);
    if (!entryTrigger.triggered) {
      console.log(`[strategy] No entry trigger for ${direction} on 1m`);
      return null;
    }
    
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
 * Determine direction based on HTF trends (tolerant logic)
 * 
 * Rules:
 * - Use 15m trend as primaryTrend
 * - If primaryTrend is 'up' or 'down':
 *   - Allow that direction if 5m is same OR 'chop' OR null/undefined
 *   - Block ONLY if 5m is the opposite direction
 * - If primaryTrend is 'chop' or null => no trade
 * 
 * @param {object} state5m - 5m timeframe state
 * @param {object} state15m - 15m timeframe state
 * @returns {object} { direction: 'long'|'short'|null, reason: string }
 */
function determineDirection(state5m, state15m) {
  const primaryTrend = state15m?.trend;
  const trend5m = state5m?.trend;
  
  // If primary trend is not clear (chop/null), no trade
  if (!primaryTrend || primaryTrend === 'chop') {
    return {
      direction: null,
      reason: `15m trend is ${primaryTrend || 'null'} (not clear)`,
    };
  }
  
  // If primary trend is 'up', allow long unless 5m is explicitly 'down'
  if (primaryTrend === 'up') {
    if (trend5m === 'down') {
      return {
        direction: null,
        reason: '15m is up but 5m is down (opposite)',
      };
    }
    // Allow if 5m is 'up', 'chop', null, or undefined
    return {
      direction: 'long',
      reason: `15m is up, 5m is ${trend5m || 'null'} (allowed)`,
    };
  }
  
  // If primary trend is 'down', allow short unless 5m is explicitly 'up'
  if (primaryTrend === 'down') {
    if (trend5m === 'up') {
      return {
        direction: null,
        reason: '15m is down but 5m is up (opposite)',
      };
    }
    // Allow if 5m is 'down', 'chop', null, or undefined
    return {
      direction: 'short',
      reason: `15m is down, 5m is ${trend5m || 'null'} (allowed)`,
    };
  }
  
  // Fallback (should not reach here)
  return {
    direction: null,
    reason: `Unknown primary trend: ${primaryTrend}`,
  };
}

/**
 * Check entry trigger on 1m timeframe with primary and fallback
 * 
 * @param {object} state1m - 1m timeframe state
 * @param {string} direction - 'long' or 'short'
 * @param {object} latestCandle - Latest 1m candle from DB
 * @returns {object} { triggered: boolean, triggerType: 'primary'|'fallback'|null }
 */
function checkEntryTrigger(state1m, direction, latestCandle) {
  const latestClose = parseFloat(latestCandle.close);
  const latestHigh = parseFloat(latestCandle.high);
  const latestLow = parseFloat(latestCandle.low);
  
  const swingHigh = state1m.last_swing_high ? parseFloat(state1m.last_swing_high) : null;
  const swingLow = state1m.last_swing_low ? parseFloat(state1m.last_swing_low) : null;
  
  // Primary trigger: BOS/CHoCH direction
  let primaryTrigger = false;
  if (direction === 'long') {
    primaryTrigger = state1m.choch_direction === 'up' || state1m.bos_direction === 'up';
  } else {
    primaryTrigger = state1m.choch_direction === 'down' || state1m.bos_direction === 'down';
  }
  
  // Fallback trigger: Swing level breaks
  let fallbackTrigger = false;
  if (swingHigh !== null && swingLow !== null) {
    if (direction === 'long') {
      // Long: close or high breaks above swing high
      fallbackTrigger = latestClose >= swingHigh || latestHigh >= swingHigh;
    } else {
      // Short: close or low breaks below swing low
      fallbackTrigger = latestClose <= swingLow || latestLow <= swingLow;
    }
  }
  
  // Debug logging
  if (STRATEGY_DEBUG) {
    console.log(`[strategy] 🔍 DEBUG entry trigger for ${direction}:`, {
      primaryTrigger,
      primaryValues: {
        choch_direction: state1m.choch_direction,
        bos_direction: state1m.bos_direction,
      },
      fallbackTrigger,
      fallbackValues: {
        swingHigh,
        swingLow,
        latestClose,
        latestHigh,
        latestLow,
      },
      triggered: primaryTrigger || fallbackTrigger,
      triggerType: primaryTrigger ? 'primary' : (fallbackTrigger ? 'fallback' : null),
    });
  }
  
  const triggered = primaryTrigger || fallbackTrigger;
  const triggerType = primaryTrigger ? 'primary' : (fallbackTrigger ? 'fallback' : null);
  
  return {
    triggered,
    triggerType,
    primaryTrigger,
    fallbackTrigger,
  };
}

/**
 * Build human-readable reason for proposal
 * 
 * @param {string} direction - 'long' or 'short'
 * @param {object} entryTrigger - Trigger object with triggerType
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
  if (entryTrigger.triggerType === 'primary') {
    if (state1m.choch_direction === direction) {
      parts.push(`1m CHoCH ${direction} (primary)`);
    } else if (state1m.bos_direction === direction) {
      parts.push(`1m BOS ${direction} (primary)`);
    }
  } else if (entryTrigger.triggerType === 'fallback') {
    parts.push(`1m swing break ${direction} (fallback)`);
  }
  
  return parts.join(' + ');
}

