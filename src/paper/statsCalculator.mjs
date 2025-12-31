/**
 * Stats Calculator
 * 
 * Computes daily statistics from closed trades.
 */

import { insertOrUpsertDailyStats } from '../db/supabaseClient.js';
import { getSupabaseClient, isSupabaseConfigured } from '../db/supabaseClient.js';

const STATS_ENABLED = process.env.PAPER_STATS_ENABLED !== '0';

/**
 * Calculate daily stats from closed trades
 * 
 * @param {string} symbol - Symbol
 * @param {Date} date - Date to calculate stats for (UTC)
 * @returns {Promise<object|null>} Stats object or null
 */
export async function calculateDailyStats(symbol, date) {
  if (!STATS_ENABLED || !isSupabaseConfigured()) {
    return null;
  }
  
  try {
    // Fetch closed trades for this date
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);
    
    const client = getSupabaseClient();
    const url = `${client.url}/rest/v1/trade_proposals?symbol=eq.${symbol}&exit_ts=gte.${startOfDay.toISOString()}&exit_ts=lte.${endOfDay.toISOString()}&status=in.(closed_tp,closed_sl)&select=*`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[statsCalculator] Failed to fetch trades: ${response.status} ${errorText}`);
      return null;
    }
    
    const trades = await response.json();
    
    if (!trades || trades.length === 0) {
      // No trades for this date
      return null;
    }
    
    // Calculate stats
    let wins = 0;
    let losses = 0;
    let totalPnlAbs = 0;
    let totalPnlPct = 0;
    const pnlValues = [];
    
    for (const trade of trades) {
      const pnlAbs = parseFloat(trade.pnl_abs || 0);
      const pnlPct = parseFloat(trade.pnl_pct || 0);
      
      totalPnlAbs += pnlAbs;
      totalPnlPct += pnlPct;
      pnlValues.push(pnlPct);
      
      if (pnlAbs > 0) {
        wins++;
      } else if (pnlAbs < 0) {
        losses++;
      }
    }
    
    const tradesCount = trades.length;
    const winrate = tradesCount > 0 ? (wins / tradesCount) * 100 : 0;
    const expectancy = tradesCount > 0 ? totalPnlAbs / tradesCount : 0;
    
    // Calculate max drawdown (simple equity curve)
    let maxDrawdownPct = 0;
    if (pnlValues.length > 0) {
      let peak = 0;
      let equity = 0;
      
      for (const pnl of pnlValues) {
        equity += pnl;
        if (equity > peak) {
          peak = equity;
        }
        const drawdown = peak - equity;
        if (drawdown > maxDrawdownPct) {
          maxDrawdownPct = drawdown;
        }
      }
    }
    
    const stats = {
      symbol,
      date: date.toISOString().split('T')[0], // YYYY-MM-DD format
      trades: tradesCount,
      wins,
      losses,
      winrate: winrate.toFixed(4),
      pnl_abs: totalPnlAbs.toFixed(8),
      pnl_pct: totalPnlPct.toFixed(4),
      expectancy: expectancy.toFixed(8),
      max_drawdown_pct: maxDrawdownPct > 0 ? maxDrawdownPct.toFixed(4) : null,
    };
    
    return stats;
  } catch (error) {
    console.error('[statsCalculator] Error calculating daily stats:', error);
    return null;
  }
}

/**
 * Refresh daily stats for a date range
 * 
 * @param {string} symbol - Symbol
 * @param {Date} startDate - Start date (UTC)
 * @param {Date} endDate - End date (UTC)
 * @returns {Promise<Array>} Array of stats objects
 */
export async function refreshDailyStats(symbol, startDate, endDate) {
  if (!STATS_ENABLED) {
    return [];
  }
  
  const stats = [];
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    const dailyStats = await calculateDailyStats(symbol, new Date(currentDate));
    if (dailyStats) {
      stats.push(dailyStats);
    }
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }
  
  // Upsert stats to database
  if (stats.length > 0) {
    try {
      await insertOrUpsertDailyStats(stats);
      console.log(`[statsCalculator] ✅ Updated ${stats.length} daily stats`);
    } catch (error) {
      console.error('[statsCalculator] Error upserting daily stats:', error);
    }
  }
  
  return stats;
}

/**
 * Refresh today's stats
 * 
 * @param {string} symbol - Symbol
 * @returns {Promise<object|null>} Today's stats
 */
export async function refreshTodayStats(symbol) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  const stats = await refreshDailyStats(symbol, today, today);
  return stats.length > 0 ? stats[0] : null;
}

