/**
 * Trade Store
 * 
 * Simple in-memory store for trades.
 * In production, you might want to use a database (Supabase, MongoDB, etc.)
 */

// In-memory store (resets on serverless function restart)
let trades = [];

/**
 * Save a trade to the store
 * 
 * @param {object} trade - Trade object
 * @returns {object} Saved trade with ID and timestamp
 */
export function saveTrade(trade) {
  const tradeWithId = {
    id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    ...trade,
  };

  trades.unshift(tradeWithId); // Add to beginning of array

  // Keep only last 1000 trades (prevent memory issues)
  if (trades.length > 1000) {
    trades = trades.slice(0, 1000);
  }

  return tradeWithId;
}

/**
 * Get all trades
 * 
 * @param {object} options - Query options
 * @param {number} [options.limit] - Maximum number of trades to return
 * @param {string} [options.mode] - Filter by mode (paper/live)
 * @param {string} [options.signal] - Filter by signal (LONG/SHORT)
 * @returns {array} Array of trades
 */
export function getTrades(options = {}) {
  let filteredTrades = [...trades];

  // Filter by mode
  if (options.mode) {
    filteredTrades = filteredTrades.filter(t => t.mode === options.mode);
  }

  // Filter by signal
  if (options.signal) {
    filteredTrades = filteredTrades.filter(t => t.signal === options.signal.toUpperCase());
  }

  // Apply limit
  if (options.limit) {
    filteredTrades = filteredTrades.slice(0, options.limit);
  }

  return filteredTrades;
}

/**
 * Get trade statistics
 * 
 * @returns {object} Statistics
 */
export function getStats() {
  const allTrades = getTrades();
  const paperTrades = getTrades({ mode: 'paper' });
  const liveTrades = getTrades({ mode: 'live' });
  const longTrades = getTrades({ signal: 'LONG' });
  const shortTrades = getTrades({ signal: 'SHORT' });

  const successful = allTrades.filter(t => t.success !== false).length;
  const rejected = allTrades.filter(t => t.success === false).length;

  return {
    total: allTrades.length,
    paper: paperTrades.length,
    live: liveTrades.length,
    long: longTrades.length,
    short: shortTrades.length,
    successful,
    rejected,
    successRate: allTrades.length > 0 ? ((successful / allTrades.length) * 100).toFixed(1) : 0,
  };
}

/**
 * Get latest trade
 * 
 * @returns {object|null} Latest trade or null
 */
export function getLatestTrade() {
  return trades.length > 0 ? trades[0] : null;
}

