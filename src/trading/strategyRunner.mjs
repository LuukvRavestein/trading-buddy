/**
 * Strategy Runner
 * 
 * Adapter that reuses existing strategy logic for paper trading.
 * Evaluates strategy configs on live candle data and generates entry signals.
 */

import { buildTimeframeState } from '../analysis/stateBuilder.mjs';
import { getCandlesBetween } from '../db/supabaseClient.js';

/**
 * Build state cache from candles
 * 
 * @param {object} options
 * @param {Array} options.candles1m - 1m candles
 * @param {Array} options.candles5m - 5m candles (optional, will resample from 1m if not provided)
 * @param {Array} options.candles15m - 15m candles (optional, will resample from 1m if not provided)
 * @param {Array} options.candles60m - 60m candles (optional, will resample from 1m if not provided)
 * @param {string} options.symbol - Symbol
 * @returns {object} State cache {1, 5, 15, 60}
 */
export function buildStateCache({ candles1m, candles5m = null, candles15m = null, candles60m = null, symbol }) {
  const stateCache = {};
  
  // Always build 1m state
  if (candles1m && candles1m.length > 0) {
    stateCache[1] = buildTimeframeState({ symbol, timeframeMin: 1, candles: candles1m });
  }
  
  // Build higher timeframe states (resample from 1m if not provided)
  if (candles5m && candles5m.length > 0) {
    stateCache[5] = buildTimeframeState({ symbol, timeframeMin: 5, candles: candles5m });
  } else if (candles1m && candles1m.length >= 5) {
    // Resample 1m to 5m
    const resampled5m = resampleCandles(candles1m, 5);
    if (resampled5m.length > 0) {
      stateCache[5] = buildTimeframeState({ symbol, timeframeMin: 5, candles: resampled5m });
    }
  }
  
  if (candles15m && candles15m.length > 0) {
    stateCache[15] = buildTimeframeState({ symbol, timeframeMin: 15, candles: candles15m });
  } else if (candles1m && candles1m.length >= 15) {
    const resampled15m = resampleCandles(candles1m, 15);
    if (resampled15m.length > 0) {
      stateCache[15] = buildTimeframeState({ symbol, timeframeMin: 15, candles: resampled15m });
    }
  }
  
  if (candles60m && candles60m.length > 0) {
    stateCache[60] = buildTimeframeState({ symbol, timeframeMin: 60, candles: candles60m });
  } else if (candles1m && candles1m.length >= 60) {
    const resampled60m = resampleCandles(candles1m, 60);
    if (resampled60m.length > 0) {
      stateCache[60] = buildTimeframeState({ symbol, timeframeMin: 60, candles: resampled60m });
    }
  }
  
  return stateCache;
}

/**
 * Resample candles to higher timeframe
 * 
 * @param {Array} candles1m - 1m candles
 * @param {number} timeframeMin - Target timeframe in minutes
 * @returns {Array} Resampled candles
 */
function resampleCandles(candles1m, timeframeMin) {
  if (!candles1m || candles1m.length === 0) {
    return [];
  }
  
  // Sort by timestamp
  const sorted = [...candles1m].sort((a, b) => a.t - b.t);
  
  const resampled = [];
  const tfMs = timeframeMin * 60 * 1000;
  
  let currentBucket = null;
  
  for (const candle of sorted) {
    const bucketStart = Math.floor(candle.t / tfMs) * tfMs;
    
    if (!currentBucket || currentBucket.t !== bucketStart) {
      // Start new bucket
      if (currentBucket) {
        resampled.push(currentBucket);
      }
      currentBucket = {
        t: bucketStart,
        o: candle.o,
        h: candle.h,
        l: candle.l,
        c: candle.c,
        v: candle.v || 0,
      };
    } else {
      // Update current bucket
      currentBucket.h = Math.max(currentBucket.h, candle.h);
      currentBucket.l = Math.min(currentBucket.l, candle.l);
      currentBucket.c = candle.c;
      currentBucket.v += (candle.v || 0);
    }
  }
  
  // Add last bucket
  if (currentBucket) {
    resampled.push(currentBucket);
  }
  
  return resampled;
}

/**
 * Evaluate strategy for a candle and config
 * 
 * @param {object} options
 * @param {object} options.stateCache - State cache {1, 5, 15, 60}
 * @param {object} options.candle - Current 1m candle {t, o, h, l, c, v}
 * @param {object} options.config - Strategy config
 * @returns {object|null} Entry signal or null
 */
export function evaluateStrategy({ stateCache, candle, config }) {
  const state1m = stateCache[1];
  const state5m = stateCache[5];
  const state15m = stateCache[15];
  const state60m = config.require_60m_align ? stateCache[60] : null;
  
  if (!state1m || !state5m || !state15m) {
    return null;
  }
  
  // Direction filter
  const directionResult = determineDirection(state5m, state15m, state60m, config);
  if (!directionResult.direction) {
    return null;
  }
  
  const direction = directionResult.direction;
  
  // Entry trigger
  const entryTrigger = checkEntryTrigger(state1m, direction, candle, config);
  if (!entryTrigger.triggered) {
    return null;
  }
  
  // Calculate SL/TP
  const atr1m = state1m.atr ? parseFloat(state1m.atr) : null;
  if (!atr1m || atr1m <= 0) {
    return null;
  }
  
  const swingHigh1m = state1m.last_swing_high ? parseFloat(state1m.last_swing_high) : null;
  const swingLow1m = state1m.last_swing_low ? parseFloat(state1m.last_swing_low) : null;
  
  if (!swingHigh1m || !swingLow1m) {
    return null;
  }
  
  const entryPrice = candle.c;
  let stopLoss, takeProfit;
  
  if (direction === 'long') {
    stopLoss = swingLow1m - (config.sl_atr_buffer * atr1m);
    const risk = entryPrice - stopLoss;
    takeProfit = entryPrice + (risk * config.rr_target);
  } else {
    stopLoss = swingHigh1m + (config.sl_atr_buffer * atr1m);
    const risk = stopLoss - entryPrice;
    takeProfit = entryPrice - (risk * config.rr_target);
  }
  
  // Risk check
  const riskPct = Math.abs((entryPrice - stopLoss) / entryPrice);
  if (riskPct < config.min_risk_pct) {
    return null;
  }
  
  return {
    direction,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    rr: config.rr_target,
  };
}

/**
 * Determine direction (with config options)
 */
function determineDirection(state5m, state15m, state60m, config) {
  const primaryTrend = state15m?.trend;
  const trend5m = state5m?.trend;
  const trend60m = state60m?.trend;
  
  // Check 60m alignment if required
  if (config.require_60m_align && trend60m) {
    if (primaryTrend === 'up' && trend60m !== 'up') return { direction: null };
    if (primaryTrend === 'down' && trend60m !== 'down') return { direction: null };
  }
  
  // Check 5m alignment if required
  if (config.require_5m_align && primaryTrend && trend5m !== primaryTrend) {
    return { direction: null };
  }
  
  // Default tolerant logic
  if (!primaryTrend || primaryTrend === 'chop') {
    return { direction: null };
  }
  
  if (primaryTrend === 'up') {
    if (trend5m === 'down') return { direction: null };
    return { direction: 'long' };
  }
  
  if (primaryTrend === 'down') {
    if (trend5m === 'up') return { direction: null };
    return { direction: 'short' };
  }
  
  return { direction: null };
}

/**
 * Check entry trigger (with config options)
 */
function checkEntryTrigger(state1m, direction, candle, config) {
  const latestClose = candle.c;
  const latestHigh = candle.h;
  const latestLow = candle.l;
  
  const swingHigh = state1m.last_swing_high ? parseFloat(state1m.last_swing_high) : null;
  const swingLow = state1m.last_swing_low ? parseFloat(state1m.last_swing_low) : null;
  
  // Primary trigger
  let primaryTrigger = false;
  if (config.entry_trigger === 'choch') {
    primaryTrigger = (direction === 'long' && state1m.choch_direction === 'up') ||
                     (direction === 'short' && state1m.choch_direction === 'down');
  } else if (config.entry_trigger === 'bos') {
    primaryTrigger = (direction === 'long' && state1m.bos_direction === 'up') ||
                     (direction === 'short' && state1m.bos_direction === 'down');
  } else {
    // 'either'
    primaryTrigger = (direction === 'long' && (state1m.choch_direction === 'up' || state1m.bos_direction === 'up')) ||
                     (direction === 'short' && (state1m.choch_direction === 'down' || state1m.bos_direction === 'down'));
  }
  
  // Fallback trigger
  let fallbackTrigger = false;
  if (swingHigh !== null && swingLow !== null) {
    if (direction === 'long') {
      fallbackTrigger = latestClose >= swingHigh || latestHigh >= swingHigh;
    } else {
      fallbackTrigger = latestClose <= swingLow || latestLow <= swingLow;
    }
  }
  
  return {
    triggered: primaryTrigger || fallbackTrigger,
    triggerType: primaryTrigger ? 'primary' : (fallbackTrigger ? 'fallback' : null),
  };
}

/**
 * Load candles for multiple timeframes from DB
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol
 * @param {string} options.startTs - Start timestamp (ISO)
 * @param {string} options.endTs - End timestamp (ISO)
 * @returns {Promise<object>} Candles object {candles1m, candles5m, candles15m, candles60m}
 */
export async function loadCandlesForTimeframes({ symbol, startTs, endTs }) {
  // Convert to internal format
  const convertCandles = (candles) => candles.map(c => ({
    t: new Date(c.ts).getTime(),
    o: parseFloat(c.open),
    h: parseFloat(c.high),
    l: parseFloat(c.low),
    c: parseFloat(c.close),
    v: parseFloat(c.volume || 0),
    ts: c.ts,
  })).sort((a, b) => a.t - b.t);
  
  const [candles1m, candles5m, candles15m, candles60m] = await Promise.all([
    getCandlesBetween({ symbol, timeframeMin: 1, startTs, endTs, limit: 100000 }),
    getCandlesBetween({ symbol, timeframeMin: 5, startTs, endTs, limit: 100000 }),
    getCandlesBetween({ symbol, timeframeMin: 15, startTs, endTs, limit: 100000 }),
    getCandlesBetween({ symbol, timeframeMin: 60, startTs, endTs, limit: 100000 }),
  ]);
  
  return {
    candles1m: convertCandles(candles1m),
    candles5m: convertCandles(candles5m),
    candles15m: convertCandles(candles15m),
    candles60m: convertCandles(candles60m),
  };
}

