/**
 * Close open trade endpoint
 * 
 * Automatically finds and closes the oldest open trade
 * Useful when exit alerts haven't been received yet
 * 
 * Usage: POST /api/close-open-trade
 * Body (optional): { "exitType": "TAKE_PROFIT" or "STOP_LOSS", "exitPrice": 50000 }
 */

import { getTrades, updateTradeExit } from '../utils/tradeStore.js';
import { getCurrentPrice } from '../utils/deribitClient.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      reason: 'Method not allowed. Use POST.',
    });
  }

  try {
    const { exitType, exitPrice } = req.body;
    
    // Find all open trades (no exit data)
    const allTrades = await getTrades({ limit: 100 });
    const openTrades = allTrades.filter(t => 
      t.success !== false && 
      t.action !== 'rejected' && 
      !t.exitPrice && 
      !t.exitType
    );

    if (openTrades.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No open trades found',
        closed: 0,
      });
    }

    // Get the oldest open trade (first in array, which is most recent, so we want the last)
    const tradeToClose = openTrades[openTrades.length - 1];
    
    // Determine exit type and price automatically if not provided
    let finalExitType = exitType;
    let finalExitPrice = exitPrice;
    
    if (!finalExitType || !finalExitPrice) {
      // Try to get current market price to determine if TP or SL was hit
      let currentPrice = null;
      try {
        const instrument = tradeToClose.instrument || tradeToClose.symbol || 'BTC-PERPETUAL';
        const useTestnet = process.env.DERIBIT_USE_TESTNET === 'true';
        currentPrice = await getCurrentPrice(instrument, useTestnet);
      } catch (error) {
        console.warn('[close-open-trade] Could not get current price:', error.message);
      }
      
      // Determine exit type based on current price vs entry price
      if (currentPrice && tradeToClose.entryPrice) {
        if (tradeToClose.signal === 'LONG') {
          // LONG: TP if current price >= TP, SL if current price <= SL
          if (tradeToClose.takeProfit && currentPrice >= tradeToClose.takeProfit) {
            finalExitType = 'TAKE_PROFIT';
            finalExitPrice = tradeToClose.takeProfit;
          } else if (tradeToClose.stopLoss && currentPrice <= tradeToClose.stopLoss) {
            finalExitType = 'STOP_LOSS';
            finalExitPrice = tradeToClose.stopLoss;
          } else if (currentPrice > tradeToClose.entryPrice) {
            // Price is above entry but below TP - assume it would have hit TP eventually
            finalExitType = 'TAKE_PROFIT';
            finalExitPrice = tradeToClose.takeProfit || currentPrice;
          } else {
            // Price is below entry but above SL - assume it would have hit SL eventually
            finalExitType = 'STOP_LOSS';
            finalExitPrice = tradeToClose.stopLoss || currentPrice;
          }
        } else if (tradeToClose.signal === 'SHORT') {
          // SHORT: TP if current price <= TP, SL if current price >= SL
          if (tradeToClose.takeProfit && currentPrice <= tradeToClose.takeProfit) {
            finalExitType = 'TAKE_PROFIT';
            finalExitPrice = tradeToClose.takeProfit;
          } else if (tradeToClose.stopLoss && currentPrice >= tradeToClose.stopLoss) {
            finalExitType = 'STOP_LOSS';
            finalExitPrice = tradeToClose.stopLoss;
          } else if (currentPrice < tradeToClose.entryPrice) {
            // Price is below entry but above TP - assume it would have hit TP eventually
            finalExitType = 'TAKE_PROFIT';
            finalExitPrice = tradeToClose.takeProfit || currentPrice;
          } else {
            // Price is above entry but below SL - assume it would have hit SL eventually
            finalExitType = 'STOP_LOSS';
            finalExitPrice = tradeToClose.stopLoss || currentPrice;
          }
        }
      }
      
      // Fallback: if we still don't have exit type/price, use defaults
      if (!finalExitType) {
        // Default: assume TP (optimistic)
        finalExitType = 'TAKE_PROFIT';
      }
      
      if (!finalExitPrice) {
        // Use take profit or stop loss from trade
        if (finalExitType === 'TAKE_PROFIT' && tradeToClose.takeProfit) {
          finalExitPrice = tradeToClose.takeProfit;
        } else if (finalExitType === 'STOP_LOSS' && tradeToClose.stopLoss) {
          finalExitPrice = tradeToClose.stopLoss;
        } else {
          return res.status(400).json({
            status: 'error',
            reason: 'Cannot determine exit price. Please provide exitType and exitPrice in request body.',
            openTrade: {
              id: tradeToClose.id,
              signal: tradeToClose.signal,
              entryPrice: tradeToClose.entryPrice,
              stopLoss: tradeToClose.stopLoss,
              takeProfit: tradeToClose.takeProfit,
              timestamp: tradeToClose.timestamp,
            },
          });
        }
      }
    }

    // Update the trade with exit data
    const updated = await updateTradeExit(tradeToClose.id, {
      exitType: finalExitType,
      exitPrice: parseFloat(finalExitPrice),
      exitTime: new Date().toISOString(),
      validated: true,
      validatedBy: 'manual_close',
    });

    if (updated) {
      return res.status(200).json({
        status: 'ok',
        message: 'Open trade closed successfully',
        closed: 1,
        trade: {
          id: updated.id,
          signal: updated.signal,
          entryPrice: updated.entryPrice,
          exitPrice: updated.exitPrice,
          exitType: updated.exitType,
          validated: updated.validated,
        },
        remainingOpenTrades: openTrades.length - 1,
      });
    } else {
      return res.status(500).json({
        status: 'error',
        reason: 'Failed to close trade',
      });
    }
  } catch (error) {
    console.error('[close-open-trade] Error:', error);
    return res.status(500).json({
      status: 'error',
      reason: `Server error: ${error.message}`,
    });
  }
}

