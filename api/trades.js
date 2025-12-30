/**
 * Trades API Endpoint
 * 
 * Returns all stored trades and statistics
 */

import { getTrades, getStats } from '../utils/tradeStore.js';

/**
 * Calculate P&L for a trade
 * For paper trades, we calculate based on entry vs TP (if successful)
 * Rejected trades have P&L = 0 (they were never executed)
 * In a real scenario, you'd use current market price or actual exit price
 * 
 * @param {object} trade - Trade object
 * @returns {number} P&L in USD
 */
function calculatePnL(trade) {
  // Rejected trades don't count towards P&L (they were never executed)
  if (trade.success === false || trade.action === 'rejected') {
    return 0;
  }

  if (!trade.entryPrice || !trade.positionSizeUsd) {
    return 0;
  }

  const entryPrice = parseFloat(trade.entryPrice);
  const positionSize = parseFloat(trade.positionSizeUsd);
  
  if (!entryPrice || !positionSize || entryPrice <= 0) {
    return 0;
  }

  // Use validated exit price if available (from TradingView alerts)
  let exitPrice = null;
  
  if (trade.exitPrice && trade.validated) {
    // Use validated exit price from TradingView
    exitPrice = parseFloat(trade.exitPrice);
  } else if (trade.takeProfit) {
    // Fallback: assume closed at TP (profit) for paper trades
    exitPrice = parseFloat(trade.takeProfit);
  } else if (trade.stopLoss) {
    // If no TP, assume it hit SL (loss)
    exitPrice = parseFloat(trade.stopLoss);
  }

  if (!exitPrice || exitPrice <= 0 || isNaN(exitPrice)) {
    return 0; // No exit price available
  }

  // Calculate P&L based on signal direction
  let pnl = 0;
  if (trade.signal === 'LONG') {
    // LONG: profit if exit > entry, loss if exit < entry
    pnl = ((exitPrice - entryPrice) / entryPrice) * positionSize;
  } else if (trade.signal === 'SHORT') {
    // SHORT: profit if exit < entry, loss if exit > entry
    pnl = ((entryPrice - exitPrice) / entryPrice) * positionSize;
  }

  return Math.round(pnl * 100) / 100; // Round to 2 decimals
}

export default async function handler(req, res) {
  // Allow GET requests only
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      reason: 'Method not allowed. Use GET.',
    });
  }

  try {
    const { mode, signal, limit } = req.query;

    // Get trades with filters
    let trades;
    try {
      trades = await getTrades({
        mode: mode || undefined,
        signal: signal || undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
    } catch (tradesError) {
      console.error('[trades] Error getting trades:', tradesError);
      // Return empty array instead of failing completely
      trades = [];
    }
    
    if (!Array.isArray(trades)) {
      console.error('[trades] getTrades returned non-array:', typeof trades);
      trades = [];
    }

    // Calculate P&L for each trade
    const tradesWithPnL = trades.map(trade => ({
      ...trade,
      pnl: calculatePnL(trade),
    }));

    // Calculate total P&L (only from successful trades, rejected trades have P&L = 0)
    const totalPnL = tradesWithPnL.reduce((sum, trade) => {
      // Only count P&L from trades that were actually executed (not rejected)
      if (trade.success !== false && trade.action !== 'rejected') {
        return sum + (trade.pnl || 0);
      }
      return sum;
    }, 0);

    // Get statistics
    let stats;
    try {
      stats = await getStats();
    } catch (statsError) {
      console.error('[trades] Error getting stats:', statsError);
      // Return minimal stats instead of failing
      stats = {
        total: trades.length,
        paper: trades.filter(t => t.mode === 'paper').length,
        live: trades.filter(t => t.mode === 'live').length,
        long: trades.filter(t => t.signal === 'LONG').length,
        short: trades.filter(t => t.signal === 'SHORT').length,
        successful: trades.filter(t => t.success !== false).length,
        rejected: trades.filter(t => t.success === false).length,
        successRate: trades.length > 0 ? ((trades.filter(t => t.success !== false).length / trades.length) * 100).toFixed(1) : '0.0',
      };
    }
    
    // Add total P&L to stats
    if (stats) {
      stats.totalPnL = Math.round(totalPnL * 100) / 100;
    } else {
      stats = {
        total: 0,
        paper: 0,
        live: 0,
        long: 0,
        short: 0,
        successful: 0,
        rejected: 0,
        successRate: '0.0',
        totalPnL: 0,
      };
    }

    return res.status(200).json({
      status: 'ok',
      stats,
      trades: tradesWithPnL,
      count: tradesWithPnL.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[trades] Error:', error);
    console.error('[trades] Error stack:', error.stack);
    return res.status(500).json({
      status: 'error',
      reason: `Server error: ${error.message}`,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

