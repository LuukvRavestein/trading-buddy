/**
 * Paper Monitor
 * 
 * Monitors executed trades and determines TP/SL hits.
 */

import { getCandlesBetween } from '../db/supabaseClient.js';
import { updateTradeProposal } from '../db/supabaseClient.js';

const INTRABAR_TIEBREAK = process.env.INTRABAR_TIEBREAK || 'worst'; // 'worst' or 'best'
const MAX_LOOKAHEAD_CANDLES = parseInt(process.env.PAPER_MAX_LOOKAHEAD_CANDLES || '2000', 10);

/**
 * Fetch open paper trades (status='executed')
 * 
 * @param {string} symbol - Symbol
 * @returns {Promise<Array>} Array of executed trades
 */
export async function fetchOpenPaperTrades(symbol) {
  // This will be called from paperEngine which has access to Supabase
  // For now, return empty array - actual fetching done in paperEngine
  return [];
}

/**
 * Evaluate exit for a trade (check TP/SL hits)
 * 
 * @param {object} trade - Executed trade object
 * @returns {Promise<object|null>} Updated trade or null if not closed yet
 */
export async function evaluateExit(trade) {
  try {
    if (!trade.entry_fill_ts || !trade.entry_fill_price) {
      console.error(`[paperMonitor] Trade ${trade.id} missing entry data`);
      return null;
    }
    
    const entryFillTs = new Date(trade.entry_fill_ts);
    const entryFillPrice = parseFloat(trade.entry_fill_price);
    const stopLoss = parseFloat(trade.stop_loss);
    const takeProfit = parseFloat(trade.take_profit);
    const direction = trade.direction;
    
    // Fetch candles from entry to now
    const now = new Date();
    const candles = await getCandlesBetween({
      symbol: trade.symbol,
      timeframeMin: 1,
      startTs: entryFillTs,
      endTs: now,
      limit: MAX_LOOKAHEAD_CANDLES,
    });
    
    if (candles.length === 0) {
      // No candles yet, trade still open
      return null;
    }
    
    // Sort candles by timestamp (ascending)
    candles.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    
    // Track MFE/MAE
    let maxFavorable = 0;
    let maxAdverse = 0;
    
    // Scan candles for TP/SL hits
    for (const candle of candles) {
      const high = parseFloat(candle.high);
      const low = parseFloat(candle.low);
      const candleTs = new Date(candle.ts);
      
      // Update MFE/MAE
      if (direction === 'long') {
        const favorable = high - entryFillPrice;
        const adverse = entryFillPrice - low;
        maxFavorable = Math.max(maxFavorable, favorable);
        maxAdverse = Math.max(maxAdverse, adverse);
      } else {
        const favorable = entryFillPrice - low;
        const adverse = high - entryFillPrice;
        maxFavorable = Math.max(maxFavorable, favorable);
        maxAdverse = Math.max(maxAdverse, adverse);
      }
      
      // Check for TP/SL hits
      let tpHit = false;
      let slHit = false;
      
      if (direction === 'long') {
        slHit = low <= stopLoss;
        tpHit = high >= takeProfit;
      } else {
        slHit = high >= stopLoss;
        tpHit = low <= takeProfit;
      }
      
      // Handle tie-break if both hit in same candle
      if (tpHit && slHit) {
        if (INTRABAR_TIEBREAK === 'worst') {
          // Assume SL hit first (safer)
          slHit = true;
          tpHit = false;
        } else {
          // Assume TP hit first (best case)
          tpHit = true;
          slHit = false;
        }
      }
      
      // Exit if either hit
      if (tpHit || slHit) {
        const exitReason = tpHit ? 'tp' : 'sl';
        const exitPrice = tpHit ? takeProfit : stopLoss;
        const exitTs = candleTs.toISOString();
        
        // Calculate PnL
        let pnlAbs;
        let pnlPct;
        
        if (direction === 'long') {
          pnlAbs = exitPrice - entryFillPrice;
        } else {
          pnlAbs = entryFillPrice - exitPrice;
        }
        
        pnlPct = (pnlAbs / entryFillPrice) * 100;
        
        // Update trade
        const status = tpHit ? 'closed_tp' : 'closed_sl';
        const updated = await updateTradeProposal(trade.id, {
          status,
          exit_price: exitPrice.toString(),
          exit_ts: exitTs,
          exit_reason: exitReason,
          pnl_abs: pnlAbs.toString(),
          pnl_pct: pnlPct.toString(),
          max_favorable_excursion: maxFavorable.toString(),
          max_adverse_excursion: maxAdverse.toString(),
        });
        
        if (updated) {
          console.log(`[paperMonitor] ✅ Closed trade ${trade.id}:`, {
            exit_reason: exitReason,
            exit_price: exitPrice,
            pnl_pct: pnlPct.toFixed(2),
            mfe: maxFavorable.toFixed(2),
            mae: maxAdverse.toFixed(2),
          });
        }
        
        return updated;
      }
    }
    
    // No exit yet, trade still open
    return null;
  } catch (error) {
    console.error(`[paperMonitor] Error evaluating exit for trade ${trade.id}:`, error);
    return null;
  }
}

