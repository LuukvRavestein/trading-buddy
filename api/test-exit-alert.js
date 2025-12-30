/**
 * Test endpoint to manually trigger an exit alert
 * 
 * This helps test if the exit alert processing works correctly
 * 
 * Usage: POST to /api/test-exit-alert with body:
 * {
 *   "tradeId": "trade-id-here",
 *   "exitType": "TAKE_PROFIT" or "STOP_LOSS",
 *   "exitPrice": 50000
 * }
 */

import { getTrades } from '../utils/tradeStore.js';
import { updateTradeExit } from '../utils/tradeStore.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      reason: 'Method not allowed. Use POST.',
    });
  }

  try {
    const { tradeId, exitType, exitPrice } = req.body;

    if (!tradeId || !exitType || !exitPrice) {
      return res.status(400).json({
        status: 'error',
        reason: 'Missing required fields: tradeId, exitType, exitPrice',
      });
    }

    if (!['TAKE_PROFIT', 'STOP_LOSS'].includes(exitType)) {
      return res.status(400).json({
        status: 'error',
        reason: 'exitType must be TAKE_PROFIT or STOP_LOSS',
      });
    }

    // Get the trade
    const allTrades = await getTrades({ limit: 200 });
    const trade = allTrades.find(t => t.id === tradeId);

    if (!trade) {
      return res.status(404).json({
        status: 'error',
        reason: `Trade with ID ${tradeId} not found`,
        availableTrades: allTrades.slice(0, 5).map(t => ({
          id: t.id,
          signal: t.signal,
          entryPrice: t.entryPrice,
          timestamp: t.timestamp,
        })),
      });
    }

    // Update the trade with exit data
    const updated = await updateTradeExit(tradeId, {
      exitType,
      exitPrice: parseFloat(exitPrice),
      exitTime: new Date().toISOString(),
      validated: true,
      validatedBy: 'manual_test',
    });

    if (updated) {
      return res.status(200).json({
        status: 'ok',
        message: 'Trade exit updated successfully',
        trade: {
          id: updated.id,
          signal: updated.signal,
          entryPrice: updated.entryPrice,
          exitPrice: updated.exitPrice,
          exitType: updated.exitType,
          validated: updated.validated,
        },
      });
    } else {
      return res.status(500).json({
        status: 'error',
        reason: 'Failed to update trade',
      });
    }
  } catch (error) {
    console.error('[test-exit-alert] Error:', error);
    return res.status(500).json({
      status: 'error',
      reason: `Server error: ${error.message}`,
    });
  }
}

