/**
 * Candle Builder
 * 
 * Builds OHLC candles from WebSocket trades.
 * Aggregates 1m candles to higher timeframes (5m, 15m, 1h).
 */

const DATA_SOURCE_WS = 'ws-candles';
const DATA_SOURCE_CHART = 'chart_data';

let dataSource = null;
let oneMinuteCandles = new Map(); // symbol -> Map<timestamp, candle>
let candleCallbacks = new Map(); // timeframe -> callback

/**
 * Set active data source
 */
export function setDataSource(source) {
  dataSource = source;
  console.log(`[candleBuilder] 📊 Data source: ${source}`);
}

/**
 * Get active data source
 */
export function getDataSource() {
  return dataSource || DATA_SOURCE_CHART;
}

/**
 * Process a trade and update 1-minute candles
 * 
 * @param {object} trade - Trade object from Deribit
 * @param {string} symbol - Instrument name
 */
export function processTrade(trade, symbol) {
  if (!trade || !trade.timestamp || !trade.price) {
    return;
  }

  const tradeTime = trade.timestamp;
  const tradePrice = parseFloat(trade.price);
  const tradeSize = parseFloat(trade.amount || 0);

  // Get 1-minute candle timestamp (round down to minute)
  const candleTimestamp = Math.floor(tradeTime / 60000) * 60000;

  // Initialize candles map for symbol if needed
  if (!oneMinuteCandles.has(symbol)) {
    oneMinuteCandles.set(symbol, new Map());
  }

  const symbolCandles = oneMinuteCandles.get(symbol);

  // Get or create 1-minute candle
  if (!symbolCandles.has(candleTimestamp)) {
    symbolCandles.set(candleTimestamp, {
      t: candleTimestamp,
      o: tradePrice,
      h: tradePrice,
      l: tradePrice,
      c: tradePrice,
      v: tradeSize,
      count: 1,
    });
  } else {
    // Update existing candle
    const candle = symbolCandles.get(candleTimestamp);
    candle.h = Math.max(candle.h, tradePrice);
    candle.l = Math.min(candle.l, tradePrice);
    candle.c = tradePrice;
    candle.v += tradeSize;
    candle.count += 1;
  }

  // Check if candle is complete (1 minute has passed)
  const now = Date.now();
  const oneMinuteAgo = now - 60000;

  // Emit completed 1m candles
  for (const [timestamp, candle] of symbolCandles.entries()) {
    if (timestamp < oneMinuteAgo) {
      // Candle is complete, emit it
      emitCandle(symbol, 1, candle);
      
      // Aggregate to higher timeframes
      aggregateToTimeframes(symbol, candle);
      
      // Remove from memory (keep last 100 candles for aggregation)
      symbolCandles.delete(timestamp);
      
      // Cleanup old candles (keep only last 100)
      if (symbolCandles.size > 100) {
        const sortedTimestamps = Array.from(symbolCandles.keys()).sort();
        const toRemove = sortedTimestamps.slice(0, symbolCandles.size - 100);
        for (const ts of toRemove) {
          symbolCandles.delete(ts);
        }
      }
    }
  }
}

/**
 * Aggregate 1m candle to higher timeframes
 */
function aggregateToTimeframes(symbol, oneMinuteCandle) {
  const timeframes = [5, 15, 60]; // minutes

  for (const timeframeMin of timeframes) {
    // Calculate higher timeframe timestamp
    const timeframeMs = timeframeMin * 60 * 1000;
    const higherTimeframeTimestamp = Math.floor(oneMinuteCandle.t / timeframeMs) * timeframeMs;

    // Get or create aggregated candle storage
    const storageKey = `${symbol}_${timeframeMin}`;
    if (!candleCallbacks.has(storageKey)) {
      continue; // No callback registered for this timeframe
    }

    // This is a simplified version - in production you'd want to store
    // partial candles and aggregate them properly
    // For now, we'll just pass through 1m candles as-is
    // TODO: Implement proper aggregation logic
  }
}

/**
 * Emit a completed candle
 */
function emitCandle(symbol, timeframeMin, candle) {
  const storageKey = `${symbol}_${timeframeMin}`;
  const callback = candleCallbacks.get(storageKey);
  
  if (callback) {
    callback({
      symbol,
      timeframeMin,
      candle: {
        t: candle.t,
        o: candle.o,
        h: candle.h,
        l: candle.l,
        c: candle.c,
        v: candle.v,
      },
    });
  }
}

/**
 * Register callback for completed candles
 * 
 * @param {string} symbol - Instrument name
 * @param {number} timeframeMin - Timeframe in minutes
 * @param {function} callback - Callback function(candleData)
 */
export function onCandleComplete(symbol, timeframeMin, callback) {
  const storageKey = `${symbol}_${timeframeMin}`;
  candleCallbacks.set(storageKey, callback);
}

/**
 * Get latest 1-minute candles from memory
 * 
 * @param {string} symbol - Instrument name
 * @param {number} limit - Number of candles to return
 * @returns {Array} Array of candle objects
 */
export function getLatestCandles(symbol, limit = 100) {
  if (!oneMinuteCandles.has(symbol)) {
    return [];
  }

  const symbolCandles = oneMinuteCandles.get(symbol);
  const sortedTimestamps = Array.from(symbolCandles.keys()).sort((a, b) => b - a);
  const latestTimestamps = sortedTimestamps.slice(0, limit);

  return latestTimestamps.map(ts => {
    const candle = symbolCandles.get(ts);
    return {
      t: candle.t,
      o: candle.o,
      h: candle.h,
      l: candle.l,
      c: candle.c,
      v: candle.v,
    };
  });
}

