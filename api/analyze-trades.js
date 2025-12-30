/**
 * Trade Analysis API Endpoint
 * 
 * Analyzes paper mode trades to determine if they would have succeeded in reality.
 * Checks:
 * - Entry price accuracy (vs market price at time of trade)
 * - Stop loss and take profit logic
 * - Risk:Reward ratio validity
 * - Trade execution feasibility
 */

import { getTrades } from '../utils/tradeStore.js';
import { getCurrentPrice } from '../utils/deribitClient.js';

/**
 * Analyze a single trade
 * 
 * @param {object} trade - Trade object
 * @param {number} currentMarketPrice - Current market price (for reference)
 * @returns {object} Analysis result
 */
function analyzeTrade(trade, currentMarketPrice = null) {
  const analysis = {
    tradeId: trade.id,
    timestamp: trade.timestamp,
    signal: trade.signal,
    instrument: trade.instrument || trade.symbol,
    entryPrice: trade.entryPrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    positionSizeUsd: trade.positionSizeUsd,
    mode: trade.mode,
    success: trade.success,
    action: trade.action,
    issues: [],
    warnings: [],
    positives: [],
    wouldHaveSucceeded: null, // null = unknown, true/false = determined
    confidence: 'low', // low, medium, high
  };

  // Skip rejected trades (they were never executed)
  if (trade.success === false || trade.action === 'rejected') {
    analysis.wouldHaveSucceeded = false;
    analysis.reason = 'Trade was rejected, never executed';
    return analysis;
  }

  // 1. Check if entry price is reasonable
  if (currentMarketPrice && trade.entryPrice) {
    const priceDiff = Math.abs(trade.entryPrice - currentMarketPrice);
    const priceDiffPercent = (priceDiff / currentMarketPrice) * 100;
    
    if (priceDiffPercent > 5) {
      analysis.warnings.push(`Entry price differs ${priceDiffPercent.toFixed(2)}% from current market price (${currentMarketPrice.toFixed(2)}). This may indicate stale data or market movement.`);
    } else if (priceDiffPercent < 0.1) {
      analysis.positives.push(`Entry price is very close to current market price (${priceDiffPercent.toFixed(2)}% difference), indicating accurate signal timing.`);
    }
  }

  // 2. Validate stop loss logic
  if (trade.entryPrice && trade.stopLoss) {
    const slDistance = Math.abs(trade.entryPrice - trade.stopLoss);
    const slDistancePercent = (slDistance / trade.entryPrice) * 100;

    if (trade.signal === 'LONG') {
      if (trade.stopLoss >= trade.entryPrice) {
        analysis.issues.push(`LONG trade: Stop loss (${trade.stopLoss}) should be BELOW entry price (${trade.entryPrice})`);
        analysis.wouldHaveSucceeded = false;
      } else if (slDistancePercent > 0.6) {
        analysis.warnings.push(`Stop loss distance is ${slDistancePercent.toFixed(2)}%, which exceeds the 0.6% maximum allowed by strategy rules.`);
      } else {
        analysis.positives.push(`Stop loss is correctly placed ${slDistancePercent.toFixed(2)}% below entry (within 0.6% limit).`);
      }
    } else if (trade.signal === 'SHORT') {
      if (trade.stopLoss <= trade.entryPrice) {
        analysis.issues.push(`SHORT trade: Stop loss (${trade.stopLoss}) should be ABOVE entry price (${trade.entryPrice})`);
        analysis.wouldHaveSucceeded = false;
      } else if (slDistancePercent > 0.6) {
        analysis.warnings.push(`Stop loss distance is ${slDistancePercent.toFixed(2)}%, which exceeds the 0.6% maximum allowed by strategy rules.`);
      } else {
        analysis.positives.push(`Stop loss is correctly placed ${slDistancePercent.toFixed(2)}% above entry (within 0.6% limit).`);
      }
    }
  }

  // 3. Validate take profit logic
  if (trade.entryPrice && trade.takeProfit) {
    const tpDistance = Math.abs(trade.takeProfit - trade.entryPrice);
    const tpDistancePercent = (tpDistance / trade.entryPrice) * 100;

    if (trade.signal === 'LONG') {
      if (trade.takeProfit <= trade.entryPrice) {
        analysis.issues.push(`LONG trade: Take profit (${trade.takeProfit}) should be ABOVE entry price (${trade.entryPrice})`);
        analysis.wouldHaveSucceeded = false;
      } else {
        analysis.positives.push(`Take profit is correctly placed ${tpDistancePercent.toFixed(2)}% above entry.`);
      }
    } else if (trade.signal === 'SHORT') {
      if (trade.takeProfit >= trade.entryPrice) {
        analysis.issues.push(`SHORT trade: Take profit (${trade.takeProfit}) should be BELOW entry price (${trade.entryPrice})`);
        analysis.wouldHaveSucceeded = false;
      } else {
        analysis.positives.push(`Take profit is correctly placed ${tpDistancePercent.toFixed(2)}% below entry.`);
      }
    }
  }

  // 4. Check Risk:Reward ratio
  if (trade.riskCheck?.riskReward) {
    const rr = trade.riskCheck.riskReward;
    if (rr < 2.0) {
      analysis.warnings.push(`Risk:Reward ratio is ${rr.toFixed(2)}:1, which is below the minimum 2:1 required by strategy rules.`);
    } else {
      analysis.positives.push(`Risk:Reward ratio is ${rr.toFixed(2)}:1, meeting the minimum 2:1 requirement.`);
    }
  } else if (trade.entryPrice && trade.stopLoss && trade.takeProfit) {
    // Calculate R:R manually if not in riskCheck
    const risk = Math.abs(trade.entryPrice - trade.stopLoss);
    const reward = Math.abs(trade.takeProfit - trade.entryPrice);
    if (risk > 0) {
      const rr = reward / risk;
      if (rr < 2.0) {
        analysis.warnings.push(`Calculated Risk:Reward ratio is ${rr.toFixed(2)}:1, which is below the minimum 2:1 required.`);
      } else {
        analysis.positives.push(`Calculated Risk:Reward ratio is ${rr.toFixed(2)}:1, meeting the minimum 2:1 requirement.`);
      }
    }
  }

  // 5. Check position size
  if (trade.positionSizeUsd) {
    if (trade.positionSizeUsd < 1) {
      analysis.warnings.push(`Position size is very small: $${trade.positionSizeUsd.toFixed(2)}. This may be due to small account size or strict risk management.`);
    } else {
      analysis.positives.push(`Position size is $${trade.positionSizeUsd.toFixed(2)}, appropriate for risk management.`);
    }
  }

  // 6. Check AI analysis (if available)
  if (trade.aiCheck && trade.aiCheck.enabled) {
    if (trade.aiCheck.allow_trade === false) {
      analysis.warnings.push(`AI check rejected this trade: ${trade.aiCheck.reason || 'No reason provided'}`);
    } else {
      const confidence = trade.aiCheck.confidence;
      if (confidence !== null && confidence !== undefined) {
        if (confidence >= 0.7) {
          analysis.positives.push(`AI check approved with high confidence (${(confidence * 100).toFixed(0)}%)`);
          analysis.confidence = 'high';
        } else if (confidence >= 0.4) {
          analysis.positives.push(`AI check approved with medium confidence (${(confidence * 100).toFixed(0)}%)`);
          analysis.confidence = 'medium';
        } else {
          analysis.warnings.push(`AI check approved but with low confidence (${(confidence * 100).toFixed(0)}%)`);
          analysis.confidence = 'low';
        }
      }
    }
  }

  // 7. Determine overall assessment
  if (analysis.issues.length > 0) {
    analysis.wouldHaveSucceeded = false;
    analysis.reason = `Trade has ${analysis.issues.length} critical issue(s) that would prevent execution.`;
  } else if (analysis.warnings.length === 0 && analysis.positives.length > 0) {
    analysis.wouldHaveSucceeded = true;
    analysis.reason = 'All checks passed. Trade parameters are valid and would likely execute successfully.';
    analysis.confidence = 'high';
  } else if (analysis.warnings.length > 0 && analysis.positives.length > 0) {
    analysis.wouldHaveSucceeded = true;
    analysis.reason = 'Trade parameters are valid but have some warnings. Would likely execute but with caution.';
    analysis.confidence = 'medium';
  } else {
    analysis.wouldHaveSucceeded = null;
    analysis.reason = 'Insufficient data to determine if trade would have succeeded.';
  }

  return analysis;
}

/**
 * Simulate trade outcome based on historical price movement
 * Note: This is a simplified simulation. In reality, you'd need historical price data.
 * 
 * @param {object} trade - Trade object
 * @param {number} currentPrice - Current market price
 * @returns {object} Simulation result
 */
function simulateTradeOutcome(trade, currentPrice) {
  if (!trade.entryPrice || !currentPrice) {
    return { outcome: 'unknown', reason: 'Missing price data' };
  }

  const entryPrice = trade.entryPrice;
  const stopLoss = trade.stopLoss;
  const takeProfit = trade.takeProfit;

  if (trade.signal === 'LONG') {
    // Check if price hit TP or SL
    if (takeProfit && currentPrice >= takeProfit) {
      return { outcome: 'win', reason: 'Price reached take profit level', exitPrice: takeProfit };
    } else if (stopLoss && currentPrice <= stopLoss) {
      return { outcome: 'loss', reason: 'Price hit stop loss level', exitPrice: stopLoss };
    } else if (currentPrice > entryPrice) {
      return { outcome: 'open_profit', reason: 'Trade would be in profit but not yet at TP', currentPrice };
    } else if (currentPrice < entryPrice) {
      return { outcome: 'open_loss', reason: 'Trade would be in loss but not yet at SL', currentPrice };
    }
  } else if (trade.signal === 'SHORT') {
    // Check if price hit TP or SL
    if (takeProfit && currentPrice <= takeProfit) {
      return { outcome: 'win', reason: 'Price reached take profit level', exitPrice: takeProfit };
    } else if (stopLoss && currentPrice >= stopLoss) {
      return { outcome: 'loss', reason: 'Price hit stop loss level', exitPrice: stopLoss };
    } else if (currentPrice < entryPrice) {
      return { outcome: 'open_profit', reason: 'Trade would be in profit but not yet at TP', currentPrice };
    } else if (currentPrice > entryPrice) {
      return { outcome: 'open_loss', reason: 'Trade would be in loss but not yet at SL', currentPrice };
    }
  }

  return { outcome: 'unknown', reason: 'Cannot determine outcome' };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      reason: 'Method not allowed. Use GET.',
    });
  }

  try {
    const { mode = 'paper', limit } = req.query;

    // Get all paper trades
    const trades = await getTrades({
      mode,
      limit: limit ? parseInt(limit) : 100,
    });

    if (trades.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No trades found to analyze',
        trades: [],
        summary: {
          total: 0,
          analyzed: 0,
          wouldHaveSucceeded: 0,
          wouldHaveFailed: 0,
          unknown: 0,
        },
      });
    }

    // Get current market price for reference (use first trade's instrument)
    let currentMarketPrice = null;
    const instrument = trades[0]?.instrument || trades[0]?.symbol || 'BTC-PERPETUAL';
    
    try {
      const useTestnet = process.env.DERIBIT_USE_TESTNET === 'true';
      currentMarketPrice = await getCurrentPrice(instrument, useTestnet);
    } catch (error) {
      console.warn('[analyze-trades] Could not get current market price:', error.message);
      // Continue without current price
    }

    // Analyze each trade
    const analyses = trades.map(trade => {
      const analysis = analyzeTrade(trade, currentMarketPrice);
      
      // Add simulation if we have current price
      if (currentMarketPrice && trade.entryPrice) {
        analysis.simulation = simulateTradeOutcome(trade, currentMarketPrice);
      }
      
      return analysis;
    });

    // Calculate summary statistics
    const summary = {
      total: analyses.length,
      analyzed: analyses.filter(a => a.wouldHaveSucceeded !== null).length,
      wouldHaveSucceeded: analyses.filter(a => a.wouldHaveSucceeded === true).length,
      wouldHaveFailed: analyses.filter(a => a.wouldHaveSucceeded === false).length,
      unknown: analyses.filter(a => a.wouldHaveSucceeded === null).length,
      highConfidence: analyses.filter(a => a.confidence === 'high').length,
      mediumConfidence: analyses.filter(a => a.confidence === 'medium').length,
      lowConfidence: analyses.filter(a => a.confidence === 'low').length,
      totalIssues: analyses.reduce((sum, a) => sum + a.issues.length, 0),
      totalWarnings: analyses.reduce((sum, a) => sum + a.warnings.length, 0),
      totalPositives: analyses.reduce((sum, a) => sum + a.positives.length, 0),
    };

    // Add success rate
    if (summary.analyzed > 0) {
      summary.successRate = ((summary.wouldHaveSucceeded / summary.analyzed) * 100).toFixed(1);
    } else {
      summary.successRate = '0.0';
    }

    return res.status(200).json({
      status: 'ok',
      summary,
      currentMarketPrice,
      instrument,
      analyses,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[analyze-trades] Error:', error);
    return res.status(500).json({
      status: 'error',
      reason: `Server error: ${error.message}`,
    });
  }
}

