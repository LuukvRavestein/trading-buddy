/**
 * Proposal Writer
 * 
 * Handles saving trade proposals to Supabase with duplicate prevention.
 */

import { getLatestTimeframeState } from '../db/supabaseClient.js';
import { getSupabaseClient, isSupabaseConfigured } from '../db/supabaseClient.js';

const DUPLICATE_WINDOW_MS = parseInt(process.env.PROPOSAL_DUPLICATE_WINDOW_MIN || '10', 10) * 60 * 1000; // 10 minutes default

/**
 * Check for duplicate proposals
 * 
 * @param {string} symbol - Symbol
 * @param {string} direction - 'long' or 'short'
 * @returns {Promise<boolean>} True if duplicate exists
 */
async function hasDuplicateProposal(symbol, direction) {
  if (!isSupabaseConfigured()) {
    return false;
  }
  
  try {
    const client = getSupabaseClient();
    const duplicateWindow = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    
    const url = `${client.url}/rest/v1/trade_proposals?symbol=eq.${symbol}&direction=eq.${direction}&status=eq.proposed&created_at=gte.${duplicateWindow}&order=created_at.desc&limit=1`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      return false; // Assume no duplicate on error
    }
    
    const data = await response.json();
    return data && data.length > 0;
  } catch (error) {
    console.error('[proposalWriter] Error checking duplicates:', error);
    return false; // Assume no duplicate on error
  }
}

/**
 * Save trade proposal to Supabase
 * 
 * @param {object} proposal - Proposal object from strategy evaluator
 * @returns {Promise<object|null>} Saved proposal or null if duplicate
 */
export async function saveProposal(proposal) {
  try {
    // Check for duplicates
    const hasDuplicate = await hasDuplicateProposal(proposal.symbol, proposal.direction);
    if (hasDuplicate) {
      console.log(`[proposalWriter] Duplicate proposal prevented: ${proposal.direction} ${proposal.symbol} (within ${DUPLICATE_WINDOW_MS / 1000 / 60} minutes)`);
      return null;
    }
    
    // Prepare proposal for database
    const dbProposal = {
      symbol: proposal.symbol,
      direction: proposal.direction,
      entry_price: proposal.entry_price.toString(),
      stop_loss: proposal.stop_loss.toString(),
      take_profit: proposal.take_profit.toString(),
      rr: proposal.rr.toString(),
      timeframe_context: proposal.timeframe_context,
      reason: proposal.reason,
      status: 'proposed',
    };
    
    // Insert proposal using Supabase REST API
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase not configured');
    }
    
    const url = `${client.url}/rest/v1/trade_proposals`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(dbProposal),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase API error: ${response.status} ${errorText.substring(0, 200)}`);
    }
    
    const saved = await response.json();
    const result = Array.isArray(saved) ? saved[0] : saved;
    
    // Log proposal summary
    console.log(`[proposalWriter] ✅ Proposal created:`, {
      id: result.id,
      direction: result.direction,
      symbol: result.symbol,
      entry: result.entry_price,
      sl: result.stop_loss,
      tp: result.take_profit,
      rr: result.rr,
      reason: result.reason,
    });
    
    return result;
  } catch (error) {
    console.error('[proposalWriter] Error saving proposal:', error);
    throw error;
  }
}

