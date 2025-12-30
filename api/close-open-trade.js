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
    
    // Determine exit type and price if not provided
    let finalExitType = exitType;
    let finalExitPrice = exitPrice;
    
    if (!finalExitType || !finalExitPrice) {
      // Try to determine from current price vs entry
      // For LONG: if current price > entry, likely TP; if < entry, likely SL
      // For SHORT: if current price < entry, likely TP; if > entry, likely SL
      
      // Since we don't have current price here, we'll use a heuristic
      // For now, we'll mark as "UNKNOWN" and let the user specify
      if (!finalExitType) {
        // Default: assume TP if we can't determine (user should specify)
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

