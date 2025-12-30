/**
 * Validate existing trades endpoint
 * 
 * NOTE: This endpoint only shows which trades are waiting for TradingView exit alerts.
 * We use TradingView exit alerts for validation, not historical data.
 * 
 * Usage: GET /api/validate-trades?limit=10
 */

import { getTrades } from '../utils/tradeStore.js';

/**
 * Check trade status (no validation - only shows which trades are waiting for TradingView alerts)
 */
function checkTradeStatus(trade) {
  if (!trade.entryPrice || !trade.timestamp) {
    return {
      success: false,
      reason: 'Missing entry price or timestamp',
    };
  }

  // Already validated by TradingView
  if (trade.exitPrice && trade.validated) {
    return {
      success: true,
      exitType: trade.exitType,
      exitPrice: trade.exitPrice,
      exitTime: trade.exitTime,
      validatedBy: trade.validatedBy,
      reason: 'Trade validated by TradingView exit alert',
    };
  }

  // Waiting for TradingView exit alert
  return {
    success: true,
    exitType: null,
    exitPrice: null,
    reason: 'Waiting for TradingView exit alert. Make sure the chart is open and alerts are active.',
    waitingForAlert: true,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      reason: 'Method not allowed. Use GET.',
    });
  }

  try {
    const { limit = 10 } = req.query;
    
    // Get trades without exit data
    const allTrades = await getTrades({ limit: parseInt(limit) * 2 }); // Get more to filter
    const tradesToValidate = allTrades
      .filter(t => 
        t.success !== false && 
        t.action !== 'rejected' && 
        !t.exitPrice && 
        !t.exitType
      )
      .slice(0, parseInt(limit));

    if (tradesToValidate.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No trades waiting for validation',
        validated: 0,
        results: [],
      });
    }

    // Check status of each trade (no validation - just show status)
    const results = tradesToValidate.map((trade) => {
      const status = checkTradeStatus(trade);
      return {
        tradeId: trade.id,
        timestamp: trade.timestamp,
        signal: trade.signal,
        entryPrice: trade.entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        ...status,
      };
    });

    const validated = results.filter(r => r.exitType && r.validatedBy).length;

    return res.status(200).json({
      status: 'ok',
      message: `Found ${validated} validated trades out of ${tradesToValidate.length} total. ${tradesToValidate.length - validated} waiting for TradingView exit alerts.`,
      validated,
      waitingForAlerts: tradesToValidate.length - validated,
      total: tradesToValidate.length,
      results,
      note: 'Trades are validated automatically via TradingView exit alerts. Make sure the chart is open and alerts are active.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[validate-trades] Error:', error);
    return res.status(500).json({
      status: 'error',
      reason: `Server error: ${error.message}`,
    });
  }
}
