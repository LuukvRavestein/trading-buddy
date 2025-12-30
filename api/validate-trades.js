/**
 * Validate existing trades endpoint
 * 
 * Validates existing trades that don't have exit data by checking historical price data
 * to see if TP or SL was hit.
 * 
 * Usage: GET /api/validate-trades?limit=10
 */

import { getTrades, updateTradeExit } from '../utils/tradeStore.js';
import { getHistoricalPriceData } from '../utils/priceDataClient.js';

/**
 * Validate a single trade by checking historical data
 */
async function validateTrade(trade) {
  if (!trade.entryPrice || !trade.timestamp) {
    return {
      success: false,
      reason: 'Missing entry price or timestamp',
    };
  }

  // Skip if already validated
  if (trade.exitPrice && trade.validated) {
    return {
      success: true,
      reason: 'Trade already validated',
      exitPrice: trade.exitPrice,
      exitType: trade.exitType,
    };
  }

  const entryTimestamp = new Date(trade.timestamp).getTime();
  const now = Date.now();
  
  // Only validate trades that are at least 5 minutes old
  if (now - entryTimestamp < 5 * 60 * 1000) {
    return {
      success: false,
      reason: 'Trade too recent, needs 5+ minutes',
    };
  }

  // Get historical data from entry time to now (max 24 hours)
  const endTimestamp = Math.min(entryTimestamp + (24 * 60 * 60 * 1000), now);
  const startTimestamp = Math.max(entryTimestamp - (5 * 60 * 1000), entryTimestamp - (24 * 60 * 60 * 1000));

  try {
    const instrument = trade.instrument || trade.symbol || 'BTC-PERPETUAL';
    const candles = await getHistoricalPriceData(instrument, startTimestamp, endTimestamp, '1m');

    if (!candles || candles.length === 0) {
      return {
        success: false,
        reason: 'No historical data available',
      };
    }

    const entryPrice = trade.entryPrice;
    const stopLoss = trade.stopLoss;
    const takeProfit = trade.takeProfit;

    // Check each candle to see if TP or SL was hit
    for (const candle of candles) {
      if (candle.t < entryTimestamp) {
        continue;
      }

      if (trade.signal === 'LONG') {
        // LONG: Check if high hit TP or low hit SL
        if (takeProfit && candle.h >= takeProfit) {
          // Update trade with TP exit
          await updateTradeExit(trade.id, {
            exitType: 'TAKE_PROFIT',
            exitPrice: takeProfit,
            exitTime: new Date(candle.t).toISOString(),
            validated: true,
            validatedBy: 'historical_validation',
          });
          return {
            success: true,
            exitType: 'TAKE_PROFIT',
            exitPrice: takeProfit,
            exitTime: new Date(candle.t).toISOString(),
            reason: 'Take profit hit in historical data',
          };
        }
        if (stopLoss && candle.l <= stopLoss) {
          // Update trade with SL exit
          await updateTradeExit(trade.id, {
            exitType: 'STOP_LOSS',
            exitPrice: stopLoss,
            exitTime: new Date(candle.t).toISOString(),
            validated: true,
            validatedBy: 'historical_validation',
          });
          return {
            success: true,
            exitType: 'STOP_LOSS',
            exitPrice: stopLoss,
            exitTime: new Date(candle.t).toISOString(),
            reason: 'Stop loss hit in historical data',
          };
        }
      } else if (trade.signal === 'SHORT') {
        // SHORT: Check if low hit TP or high hit SL
        if (takeProfit && candle.l <= takeProfit) {
          await updateTradeExit(trade.id, {
            exitType: 'TAKE_PROFIT',
            exitPrice: takeProfit,
            exitTime: new Date(candle.t).toISOString(),
            validated: true,
            validatedBy: 'historical_validation',
          });
          return {
            success: true,
            exitType: 'TAKE_PROFIT',
            exitPrice: takeProfit,
            exitTime: new Date(candle.t).toISOString(),
            reason: 'Take profit hit in historical data',
          };
        }
        if (stopLoss && candle.h >= stopLoss) {
          await updateTradeExit(trade.id, {
            exitType: 'STOP_LOSS',
            exitPrice: stopLoss,
            exitTime: new Date(candle.t).toISOString(),
            validated: true,
            validatedBy: 'historical_validation',
          });
          return {
            success: true,
            exitType: 'STOP_LOSS',
            exitPrice: stopLoss,
            exitTime: new Date(candle.t).toISOString(),
            reason: 'Stop loss hit in historical data',
          };
        }
      }
    }

    // Neither TP nor SL was hit - trade is still open
    return {
      success: true,
      exitType: null,
      exitPrice: null,
      reason: 'Trade still open, neither TP nor SL hit',
      currentPrice: candles[candles.length - 1]?.c,
    };
  } catch (error) {
    console.error(`[validate-trades] Error validating trade ${trade.id}:`, error);
    return {
      success: false,
      reason: `Error: ${error.message}`,
    };
  }
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
        message: 'No trades to validate',
        validated: 0,
        results: [],
      });
    }

    // Validate each trade
    const results = await Promise.all(
      tradesToValidate.map(async (trade) => {
        const validation = await validateTrade(trade);
        return {
          tradeId: trade.id,
          timestamp: trade.timestamp,
          signal: trade.signal,
          entryPrice: trade.entryPrice,
          ...validation,
        };
      })
    );

    const validated = results.filter(r => r.success && r.exitType).length;

    return res.status(200).json({
      status: 'ok',
      message: `Validated ${validated} out of ${tradesToValidate.length} trades`,
      validated,
      total: tradesToValidate.length,
      results,
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

