/**
 * Paper Engine
 * 
 * Orchestrates paper trading execution, monitoring, and stats.
 */

import { getSupabaseClient, isSupabaseConfigured } from '../db/supabaseClient.js';
import { executeProposal } from './paperExecutor.mjs';
import { evaluateExit } from './paperMonitor.mjs';
import { refreshTodayStats } from './statsCalculator.mjs';

/**
 * Run paper engine for a symbol
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol (e.g., 'BTC-PERPETUAL')
 * @returns {Promise<object>} Results summary
 */
export async function runPaperEngine({ symbol }) {
  if (!isSupabaseConfigured()) {
    return { success: false, reason: 'Supabase not configured' };
  }
  
  const results = {
    expired: 0,
    executed: 0,
    closed: 0,
    errors: 0,
  };
  
  try {
    const client = getSupabaseClient();
    
    // Step 1: Expire old proposals and execute eligible ones
    try {
      const proposalsUrl = `${client.url}/rest/v1/trade_proposals?symbol=eq.${symbol}&status=eq.proposed&order=created_at.asc&limit=50`;
      const proposalsResponse = await fetch(proposalsUrl, {
        method: 'GET',
        headers: {
          'apikey': client.key,
          'Authorization': `Bearer ${client.key}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (proposalsResponse.ok) {
        const proposals = await proposalsResponse.json();
        
        for (const proposal of proposals) {
          try {
            const result = await executeProposal(proposal);
            if (result) {
              if (result.status === 'expired') {
                results.expired++;
              } else if (result.status === 'executed') {
                results.executed++;
              }
            }
          } catch (error) {
            console.error(`[paperEngine] Error processing proposal ${proposal.id}:`, error);
            results.errors++;
          }
        }
      }
    } catch (error) {
      console.error('[paperEngine] Error fetching proposals:', error);
      results.errors++;
    }
    
    // Step 2: Monitor open executed trades
    try {
      const openTradesUrl = `${client.url}/rest/v1/trade_proposals?symbol=eq.${symbol}&status=eq.executed&order=entry_fill_ts.asc&limit=100`;
      const openTradesResponse = await fetch(openTradesUrl, {
        method: 'GET',
        headers: {
          'apikey': client.key,
          'Authorization': `Bearer ${client.key}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (openTradesResponse.ok) {
        const openTrades = await openTradesResponse.json();
        
        for (const trade of openTrades) {
          try {
            const result = await evaluateExit(trade);
            if (result && (result.status === 'closed_tp' || result.status === 'closed_sl')) {
              results.closed++;
            }
          } catch (error) {
            console.error(`[paperEngine] Error monitoring trade ${trade.id}:`, error);
            results.errors++;
          }
        }
      }
    } catch (error) {
      console.error('[paperEngine] Error fetching open trades:', error);
      results.errors++;
    }
    
    // Step 3: Refresh today's stats
    try {
      await refreshTodayStats(symbol);
    } catch (error) {
      console.error('[paperEngine] Error refreshing stats:', error);
      // Don't count stats errors as critical
    }
    
    return {
      success: true,
      ...results,
    };
  } catch (error) {
    console.error('[paperEngine] Fatal error:', error);
    return {
      success: false,
      error: error.message,
      ...results,
    };
  }
}

