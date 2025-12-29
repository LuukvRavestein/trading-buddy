/**
 * Trade Store
 * 
 * Stores trades in Supabase database (if configured) or falls back to in-memory storage.
 * 
 * Environment variables:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY)
 */

import { 
  isSupabaseConfigured, 
  insertTrade as insertTradeToSupabase,
  getTradesFromSupabase,
  getStatsFromSupabase,
} from './supabaseClient.js';

// In-memory store (fallback, resets on serverless function restart)
let trades = [];

/**
 * Save a trade to the store
 * 
 * @param {object} trade - Trade object
 * @returns {Promise<object>} Saved trade with ID and timestamp
 */
export async function saveTrade(trade) {
  const tradeWithId = {
    id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    ...trade,
  };

  // Try to save to Supabase first
  if (isSupabaseConfigured()) {
    try {
      // Map trade fields to database schema
      const dbTrade = {
        success: tradeWithId.success,
        action: tradeWithId.action,
        reason: tradeWithId.reason,
        mode: tradeWithId.mode,
        signal: tradeWithId.signal,
        symbol: tradeWithId.symbol,
        instrument: tradeWithId.instrument || tradeWithId.symbol,
        entry_price: tradeWithId.entryPrice,
        stop_loss: tradeWithId.stopLoss,
        take_profit: tradeWithId.takeProfit,
        side: tradeWithId.side,
        amount: tradeWithId.amount,
        position_size_usd: tradeWithId.positionSizeUsd,
        risk_check: tradeWithId.riskCheck,
        order_id: tradeWithId.orderId,
        processing_time_ms: tradeWithId.processingTimeMs,
        request_id: tradeWithId.requestId,
      };

      const saved = await insertTradeToSupabase(dbTrade);
      if (saved) {
        return { ...tradeWithId, id: saved.id || tradeWithId.id };
      }
    } catch (error) {
      console.error('[tradeStore] Failed to save to Supabase, using in-memory fallback:', error);
      // Fall through to in-memory storage
    }
  }

  // Fallback to in-memory storage
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
 * @returns {Promise<array>} Array of trades
 */
export async function getTrades(options = {}) {
  // Try to get from Supabase first
  if (isSupabaseConfigured()) {
    try {
      const dbTrades = await getTradesFromSupabase(options);
      // Map database fields back to trade format
      return dbTrades.map(t => ({
        id: t.id,
        timestamp: t.timestamp || t.created_at,
        success: t.success,
        action: t.action,
        reason: t.reason,
        mode: t.mode,
        signal: t.signal,
        symbol: t.symbol,
        instrument: t.instrument,
        entryPrice: parseFloat(t.entry_price) || t.entry_price,
        stopLoss: parseFloat(t.stop_loss) || t.stop_loss,
        takeProfit: parseFloat(t.take_profit) || t.take_profit,
        side: t.side,
        amount: t.amount,
        positionSizeUsd: parseFloat(t.position_size_usd) || t.position_size_usd,
        riskCheck: t.risk_check,
        aiCheck: t.ai_check, // Include AI check data
        orderId: t.order_id,
        processingTimeMs: t.processing_time_ms,
        requestId: t.request_id,
      }));
    } catch (error) {
      console.error('[tradeStore] Failed to get from Supabase, using in-memory fallback:', error);
      // Fall through to in-memory storage
    }
  }

  // Fallback to in-memory storage
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
 * @returns {Promise<object>} Statistics
 */
export async function getStats() {
  // Try to get from Supabase first
  if (isSupabaseConfigured()) {
    try {
      const stats = await getStatsFromSupabase();
      if (stats) {
        return stats;
      }
    } catch (error) {
      console.error('[tradeStore] Failed to get stats from Supabase, using in-memory fallback:', error);
      // Fall through to in-memory calculation
    }
  }

  // Fallback to in-memory calculation
  const allTrades = await getTrades();
  const paperTrades = await getTrades({ mode: 'paper' });
  const liveTrades = await getTrades({ mode: 'live' });
  const longTrades = await getTrades({ signal: 'LONG' });
  const shortTrades = await getTrades({ signal: 'SHORT' });

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
 * @returns {Promise<object|null>} Latest trade or null
 */
export async function getLatestTrade() {
  const latestTrades = await getTrades({ limit: 1 });
  return latestTrades.length > 0 ? latestTrades[0] : null;
}

