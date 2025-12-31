/**
 * Timeframe State Builder
 * 
 * Computes technical analysis state for a timeframe:
 * - ATR(14)
 * - Swing highs/lows (pivot-based)
 * - Trend regime (up/down/chop)
 * - BOS/CHoCH direction flags
 * 
 * Deterministic, no external dependencies.
 */

/**
 * Build timeframe state from candles
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol (e.g., 'BTC-PERPETUAL')
 * @param {number} options.timeframeMin - Timeframe in minutes
 * @param {Array} options.candles - Array of candle objects {t, o, h, l, c, v}
 * @returns {object} State object
 */
export function buildTimeframeState({ symbol, timeframeMin, candles }) {
  if (!candles || candles.length === 0) {
    throw new Error('No candles provided');
  }

  // Sort candles by timestamp (ascending)
  const sortedCandles = [...candles].sort((a, b) => a.t - b.t);
  const latestCandle = sortedCandles[sortedCandles.length - 1];
  
  // Configuration
  const pivotLen = 2; // Pivot length for swing detection
  const atrPeriod = 14; // ATR period
  
  // Compute ATR(14)
  const atr = computeATR(sortedCandles, atrPeriod);
  
  // Compute swing highs and lows
  const swings = computeSwings(sortedCandles, pivotLen);
  
  // Determine trend regime
  const trend = determineTrend(swings);
  
  // Detect BOS/CHoCH on latest candle
  const { bosDirection, chochDirection } = detectBOSCHoCH(
    sortedCandles,
    swings,
    trend
  );
  
  // Build state object
  const state = {
    symbol,
    timeframe_min: timeframeMin,
    ts: new Date(latestCandle.t).toISOString(),
    trend,
    atr: atr !== null ? atr.toString() : null,
    last_swing_high: swings.lastSwingHigh !== null ? swings.lastSwingHigh.toString() : null,
    last_swing_low: swings.lastSwingLow !== null ? swings.lastSwingLow.toString() : null,
    bos_direction: bosDirection,
    choch_direction: chochDirection,
    last_candle_ts: new Date(latestCandle.t).toISOString(),
    metadata: {
      pivotLen,
      atrPeriod,
      swingHighCount: swings.swingHighs.length,
      swingLowCount: swings.swingLows.length,
      candlesProcessed: sortedCandles.length,
    },
  };
  
  return state;
}

/**
 * Compute ATR(14) - Average True Range
 * 
 * @param {Array} candles - Sorted candles
 * @param {number} period - ATR period (default 14)
 * @returns {number|null} ATR value or null if insufficient data
 */
function computeATR(candles, period = 14) {
  if (candles.length < period + 1) {
    return null; // Need at least period+1 candles
  }
  
  const trueRanges = [];
  
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    
    // True Range = max(high-low, abs(high-prevClose), abs(low-prevClose))
    const tr1 = current.h - current.l;
    const tr2 = Math.abs(current.h - previous.c);
    const tr3 = Math.abs(current.l - previous.c);
    const tr = Math.max(tr1, tr2, tr3);
    
    trueRanges.push(tr);
  }
  
  // ATR = Simple Moving Average of True Ranges
  if (trueRanges.length < period) {
    return null;
  }
  
  // Use last 'period' true ranges
  const recentTRs = trueRanges.slice(-period);
  const sum = recentTRs.reduce((acc, tr) => acc + tr, 0);
  const atr = sum / period;
  
  return atr;
}

/**
 * Compute swing highs and lows using pivot method
 * 
 * @param {Array} candles - Sorted candles
 * @param {number} pivotLen - Pivot length (default 2)
 * @returns {object} { swingHighs, swingLows, lastSwingHigh, lastSwingLow }
 */
function computeSwings(candles, pivotLen = 2) {
  const swingHighs = [];
  const swingLows = [];
  
  // Need at least 2*pivotLen + 1 candles to detect a pivot
  const minCandles = 2 * pivotLen + 1;
  if (candles.length < minCandles) {
    return {
      swingHighs: [],
      swingLows: [],
      lastSwingHigh: null,
      lastSwingLow: null,
    };
  }
  
  // Check for pivots (only up to candles.length - pivotLen - 1 to ensure confirmation)
  for (let i = pivotLen; i < candles.length - pivotLen; i++) {
    const current = candles[i];
    
    // Check for pivot high
    let isPivotHigh = true;
    for (let j = 1; j <= pivotLen; j++) {
      if (current.h <= candles[i - j].h || current.h <= candles[i + j].h) {
        isPivotHigh = false;
        break;
      }
    }
    
    if (isPivotHigh) {
      swingHighs.push({
        index: i,
        price: current.h,
        ts: current.t,
      });
    }
    
    // Check for pivot low
    let isPivotLow = true;
    for (let j = 1; j <= pivotLen; j++) {
      if (current.l >= candles[i - j].l || current.l >= candles[i + j].l) {
        isPivotLow = false;
        break;
      }
    }
    
    if (isPivotLow) {
      swingLows.push({
        index: i,
        price: current.l,
        ts: current.t,
      });
    }
  }
  
  // Get last confirmed swing high and low
  const lastSwingHigh = swingHighs.length > 0 
    ? swingHighs[swingHighs.length - 1].price 
    : null;
  const lastSwingLow = swingLows.length > 0 
    ? swingLows[swingLows.length - 1].price 
    : null;
  
  return {
    swingHighs,
    swingLows,
    lastSwingHigh,
    lastSwingLow,
  };
}

/**
 * Determine trend regime from swing points
 * 
 * @param {object} swings - Swings object from computeSwings
 * @returns {string} 'up', 'down', or 'chop'
 */
function determineTrend(swings) {
  const { swingHighs, swingLows, lastSwingHigh, lastSwingLow } = swings;
  
  // Need at least 2 swing highs and 2 swing lows to determine trend
  if (swingHighs.length < 2 || swingLows.length < 2) {
    return 'chop';
  }
  
  // Get last two swing highs and lows
  const lastHigh = swingHighs[swingHighs.length - 1];
  const prevHigh = swingHighs[swingHighs.length - 2];
  const lastLow = swingLows[swingLows.length - 1];
  const prevLow = swingLows[swingLows.length - 2];
  
  // Uptrend: higher highs and higher lows
  const isHigherHigh = lastHigh.price > prevHigh.price;
  const isHigherLow = lastLow.price > prevLow.price;
  
  // Downtrend: lower highs and lower lows
  const isLowerHigh = lastHigh.price < prevHigh.price;
  const isLowerLow = lastLow.price < prevLow.price;
  
  if (isHigherHigh && isHigherLow) {
    return 'up';
  } else if (isLowerHigh && isLowerLow) {
    return 'down';
  } else {
    return 'chop';
  }
}

/**
 * Detect BOS (Break of Structure) and CHoCH (Change of Character)
 * 
 * @param {Array} candles - Sorted candles
 * @param {object} swings - Swings object
 * @param {string} trend - Current trend ('up', 'down', 'chop')
 * @returns {object} { bosDirection, chochDirection }
 */
function detectBOSCHoCH(candles, swings, trend) {
  const { lastSwingHigh, lastSwingLow } = swings;
  const latestCandle = candles[candles.length - 1];
  
  let bosDirection = null;
  let chochDirection = null;
  
  // Need swing points to detect BOS/CHoCH
  if (lastSwingHigh === null || lastSwingLow === null) {
    return { bosDirection: null, chochDirection: null };
  }
  
  // Check latest candle close against swing points
  const close = latestCandle.c;
  
  if (trend === 'up') {
    // Uptrend BOS: close breaks above last swing high
    if (close > lastSwingHigh) {
      bosDirection = 'up';
    }
    // Uptrend CHoCH: close breaks below last swing low
    if (close < lastSwingLow) {
      chochDirection = 'down';
    }
  } else if (trend === 'down') {
    // Downtrend BOS: close breaks below last swing low
    if (close < lastSwingLow) {
      bosDirection = 'down';
    }
    // Downtrend CHoCH: close breaks above last swing high
    if (close > lastSwingHigh) {
      chochDirection = 'up';
    }
  }
  // For 'chop' trend, don't detect BOS/CHoCH
  
  return { bosDirection, chochDirection };
}

