/**
 * Paper Executor
 * 
 * Executes proposed trades by simulating fills on next candle.
 */

import { getNextCandle } from '../db/supabaseClient.js';
import { updateTradeProposal } from '../db/supabaseClient.js';

const PROPOSAL_TTL_MIN = parseInt(process.env.PROPOSAL_TTL_MIN || '10', 10);
const PROPOSAL_TTL_MS = PROPOSAL_TTL_MIN * 60 * 1000;

/**
 * Fetch proposals that need to be executed
 * 
 * @param {string} symbol - Symbol
 * @returns {Promise<Array>} Array of proposals with status='proposed'
 */
export async function fetchProposalsToExecute(symbol) {
  // This will be called from paperEngine which has access to Supabase
  // For now, return empty array - actual fetching done in paperEngine
  return [];
}

/**
 * Execute a proposal (simulate fill)
 * 
 * @param {object} proposal - Proposal object
 * @returns {Promise<object|null>} Updated proposal or null if not ready/expired
 */
export async function executeProposal(proposal) {
  try {
    const proposalCreatedAt = new Date(proposal.created_at);
    const now = Date.now();
    const proposalAge = now - proposalCreatedAt.getTime();
    
    // Check if proposal expired
    if (proposalAge > PROPOSAL_TTL_MS) {
      // Expire the proposal
      await updateTradeProposal(proposal.id, {
        status: 'expired',
        exit_reason: 'expired',
        exit_ts: new Date().toISOString(),
      });
      console.log(`[paperExecutor] Proposal ${proposal.id} expired (age: ${Math.round(proposalAge / 1000)}s)`);
      return null;
    }
    
    // Find next 1m candle after proposal creation
    const nextCandle = await getNextCandle({
      symbol: proposal.symbol,
      timeframeMin: 1,
      afterTs: proposalCreatedAt,
    });
    
    if (!nextCandle) {
      // Candle not available yet, skip until next run
      return null;
    }
    
    // Execute at next candle open
    const entryFillPrice = parseFloat(nextCandle.open);
    const entryFillTs = nextCandle.ts;
    
    // Update proposal
    const updated = await updateTradeProposal(proposal.id, {
      status: 'executed',
      executed_at: new Date().toISOString(),
      entry_fill_price: entryFillPrice.toString(),
      entry_fill_ts: entryFillTs,
      entry_type: 'market',
    });
    
    if (updated) {
      console.log(`[paperExecutor] ✅ Executed proposal ${proposal.id}:`, {
        direction: proposal.direction,
        entry_fill_price: entryFillPrice,
        entry_fill_ts: entryFillTs,
      });
    }
    
    return updated;
  } catch (error) {
    console.error(`[paperExecutor] Error executing proposal ${proposal.id}:`, error);
    return null;
  }
}

