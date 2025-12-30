/**
 * Trade Executor
 * 
 * Orchestrates the execution of trades by:
 * 1. Validating trade signals
 * 2. Running risk checks
 * 3. Calculating position sizes
 * 4. Placing orders (paper mode or live mode)
 * 
 * Environment variables:
 * - BOT_MODE: 'paper' or 'live' (default: 'paper')
 */

import { canOpenNewTrade, validateTradeSignal, calculatePositionSize } from './riskEngine.js';
import { getAccountSummary, placeOrder, getOpenPositions, getCurrentPrice } from '../utils/deribitClient.js';
import { evaluateTradeProposal } from './aiCheck.js';

/**
 * Convert USD position size to Deribit contracts
 * 
 * For perpetuals: 1 contract = 1 USD (for BTC-PERPETUAL)
 * For futures: depends on contract size
 * 
 * @param {number} positionSizeUsd - Position size in USD
 * @param {string} instrumentName - Instrument name (e.g., 'BTC-PERPETUAL')
 * @returns {number} Position size in contracts
 */
function convertUsdToContracts(positionSizeUsd, instrumentName) {
  // For BTC-PERPETUAL, 1 contract = 1 USD
  // For other instruments, this might need adjustment
  // For now, we assume 1:1 for perpetuals
  if (instrumentName.includes('PERPETUAL')) {
    return Math.floor(positionSizeUsd); // Round down to whole contracts
  }
  
  // For futures, might need different calculation
  // Default: assume 1 contract = 1 USD (simplified)
  return Math.floor(positionSizeUsd);
}

/**
 * Convert Deribit instrument symbol to Deribit format
 * TradingView might send 'BTCUSD' or 'BTC-PERPETUAL'
 * 
 * @param {string} symbol - Symbol from TradingView
 * @returns {string} Deribit instrument name
 */
function normalizeInstrumentName(symbol) {
  // If already in Deribit format, return as is
  if (symbol.includes('-PERPETUAL') || symbol.includes('-')) {
    return symbol;
  }
  
  // Convert common formats
  if (symbol.toUpperCase().includes('BTC')) {
    return 'BTC-PERPETUAL';
  }
  
  // Default: assume it's already correct or add -PERPETUAL
  return symbol.includes('-') ? symbol : `${symbol}-PERPETUAL`;
}

/**
 * Execute a trade based on TradingView signal
 * 
 * @param {object} signal - TradingView signal
 * @param {string} signal.signal - 'LONG' or 'SHORT'
 * @param {string} signal.symbol - Instrument symbol
 * @param {number} signal.entry_price - Entry price
 * @param {number} signal.sl_price - Stop loss price
 * @param {number} [signal.tp_price] - Take profit price (optional)
 * @param {object} [options] - Additional options
 * @param {number} [options.currentDailyPnL] - Current daily P&L (default: 0)
 * @param {number} [options.tradesToday] - Trades executed today (default: 0)
 * @param {boolean} [options.useTestnet] - Use Deribit testnet (default: false)
 * @returns {Promise<object>} Execution result
 */
export async function executeTrade(signal, options = {}) {
  const {
    currentDailyPnL = 0,
    tradesToday = 0,
    useTestnet = false,
  } = options;

  const botMode = (process.env.BOT_MODE || 'paper').toLowerCase();
  const isPaperMode = botMode === 'paper';

  try {
    // Step 1: Validate signal structure
    const signalValidation = validateTradeSignal(signal);
    if (!signalValidation.valid) {
      return {
        success: false,
        action: 'rejected',
        reason: `Signal validation failed: ${signalValidation.reason}`,
        mode: botMode,
      };
    }

    // Step 2: Get account information
    const currency = 'BTC'; // Default for BTC perpetuals
    let accountSummary;
    try {
      accountSummary = await getAccountSummary(currency, useTestnet);
    } catch (error) {
      // In paper mode, use mock account for testing without Deribit
      if (isPaperMode) {
        console.warn('[tradeExecutor] Using mock account (Deribit not available)');
        accountSummary = {
          equity: 100,
          balance: 100,
          available_funds: 100,
        };
      } else {
        return {
          success: false,
          action: 'rejected',
          reason: `Failed to get account summary: ${error.message}`,
          mode: botMode,
        };
      }
    }

    const equity = accountSummary.equity || accountSummary.balance || 0;
    if (equity <= 0) {
      return {
        success: false,
        action: 'rejected',
        reason: `Invalid equity: ${equity}`,
        mode: botMode,
      };
    }

    // Step 3: Check if there is already an open trade
    // Only allow one open position at a time (LONG or SHORT)
    const { getTrades } = await import('../utils/tradeStore.js');
    const allTrades = await getTrades({ limit: 100 });
    const hasOpenTrade = allTrades.some(t => 
      t.success !== false && 
      t.action !== 'rejected' && 
      !t.exitPrice && 
      !t.exitType
    );

    // Step 4: Run risk checks
    const riskCheck = canOpenNewTrade({
      equity,
      entryPrice: signal.entry_price,
      stopLossPrice: signal.sl_price,
      takeProfitPrice: signal.tp_price,
      currentDailyPnL,
      tradesToday,
      hasOpenTrade,
    });

    if (!riskCheck.allowed) {
      console.warn(`[tradeExecutor] Risk check REJECTED trade: ${riskCheck.reason}`, {
        equity,
        entryPrice: signal.entry_price,
        stopLoss: signal.sl_price,
        takeProfit: signal.tp_price,
        positionSizeUsd: riskCheck.positionSizeUsd,
        slDistancePercent: riskCheck.slDistancePercent,
        riskReward: riskCheck.riskReward,
      });
      return {
        success: false,
        action: 'rejected',
        reason: riskCheck.reason,
        mode: botMode,
        riskCheck: {
          slDistancePercent: riskCheck.slDistancePercent,
          riskReward: riskCheck.riskReward,
          positionSizeUsd: riskCheck.positionSizeUsd, // Include position size even when rejected
        },
      };
    }

    // Step 4: Prepare order
    const instrumentName = normalizeInstrumentName(signal.symbol);
    const positionSizeUsd = riskCheck.positionSizeUsd;
    const positionSizeContracts = convertUsdToContracts(positionSizeUsd, instrumentName);

    if (positionSizeContracts <= 0) {
      return {
        success: false,
        action: 'rejected',
        reason: `Calculated position size too small: ${positionSizeContracts} contracts`,
        mode: botMode,
      };
    }

    // Step 4.5: AI Quality Check (optional)
    let aiCheck = null;
    const enableAICheck = process.env.ENABLE_AI_CHECK === 'true';
    
    if (enableAICheck) {
      try {
        console.log(`[tradeExecutor] Running AI check for ${signal.signal} trade:`, {
          entryPrice: signal.entry_price,
          stopLoss: signal.sl_price,
          takeProfit: signal.tp_price,
          positionSizeUsd,
          equity,
          riskCheck: {
            slDistancePercent: riskCheck.slDistancePercent,
            riskReward: riskCheck.riskReward,
          },
        });
        
        // Get current trend from signal if available, or use 'NEUTRAL'
        const currentTrend = signal.trend || 'NEUTRAL';
        
        aiCheck = await evaluateTradeProposal({
          signal: signal.signal,
          symbol: signal.symbol,
          entryPrice: signal.entry_price,
          stopLoss: signal.sl_price,
          takeProfit: signal.tp_price,
          trend: currentTrend,
          positionSizeUsd,
          riskCheck: {
            slDistancePercent: riskCheck.slDistancePercent,
            riskReward: riskCheck.riskReward,
          },
          equity,
        });

        console.log(`[tradeExecutor] AI check result:`, {
          allow_trade: aiCheck.allow_trade,
          confidence: aiCheck.confidence,
          reason: aiCheck.reason,
        });

        // If AI rejects the trade, return rejection
        if (!aiCheck.allow_trade) {
          console.warn(`[tradeExecutor] AI check REJECTED trade: ${aiCheck.reason}`);
          return {
            success: false,
            action: 'rejected',
            reason: `AI check rejected: ${aiCheck.reason}`,
            mode: botMode,
            riskCheck: {
              slDistancePercent: riskCheck.slDistancePercent,
              riskReward: riskCheck.riskReward,
            },
            aiCheck: {
              enabled: true,
              confidence: aiCheck.confidence,
              reason: aiCheck.reason,
            },
          };
        }

        // If AI suggests different position size, use it (if reasonable)
        if (aiCheck.position_size_usd && 
            aiCheck.position_size_usd !== positionSizeUsd &&
            aiCheck.position_size_usd > 0 &&
            aiCheck.position_size_usd <= positionSizeUsd * 1.5) { // Max 50% increase
          console.log(`[tradeExecutor] AI suggested position size adjustment: $${positionSizeUsd} → $${aiCheck.position_size_usd}`);
          // Note: We keep the original position size for now, but log the suggestion
        }
      } catch (error) {
        console.error('[tradeExecutor] AI check error:', error);
        // Continue with trade if AI check fails (fail-open)
        aiCheck = {
          enabled: true,
          allow_trade: true,
          reason: `AI check failed: ${error.message}. Trade allowed.`,
          error: error.message,
        };
      }
    }

    const side = signal.signal.toUpperCase() === 'LONG' ? 'buy' : 'sell';

    // Step 5: Execute trade (paper or live)
    if (isPaperMode) {
      // Paper mode: log only, no actual order
      const paperTrade = {
        mode: 'paper',
        instrument: instrumentName,
        side,
        type: 'limit',
        amount: positionSizeContracts,
        price: signal.entry_price,
        stopLoss: signal.sl_price,
        takeProfit: signal.tp_price,
        positionSizeUsd,
        equity,
        riskCheck: {
          slDistancePercent: riskCheck.slDistancePercent,
          riskReward: riskCheck.riskReward,
        },
        timestamp: new Date().toISOString(),
      };

      console.log('[tradeExecutor] PAPER TRADE:', JSON.stringify(paperTrade, null, 2));

      return {
        success: true,
        action: 'paper_trade_logged',
        reason: 'Trade executed in paper mode (logged only)',
        mode: 'paper',
        trade: paperTrade,
        aiCheck: aiCheck || undefined,
      };
    } else {
      // Live mode: place actual order
      try {
        // Place main order (limit order at entry price)
        const orderResult = await placeOrder({
          instrument_name: instrumentName,
          side,
          type: 'limit',
          amount: positionSizeContracts,
          price: signal.entry_price,
          time_in_force: 'good_til_cancelled',
        }, useTestnet);

        // Note: Deribit doesn't support native stop-loss/take-profit orders
        // You would need to monitor positions and place separate stop orders
        // For now, we log the SL/TP levels for manual monitoring

        const liveTrade = {
          mode: 'live',
          instrument: instrumentName,
          side,
          orderId: orderResult.order_id,
          orderState: orderResult.order_state,
          amount: positionSizeContracts,
          price: signal.entry_price,
          stopLoss: signal.sl_price,
          takeProfit: signal.tp_price,
          positionSizeUsd,
          equity,
          riskCheck: {
            slDistancePercent: riskCheck.slDistancePercent,
            riskReward: riskCheck.riskReward,
          },
          timestamp: new Date().toISOString(),
        };

        console.log('[tradeExecutor] LIVE TRADE:', JSON.stringify(liveTrade, null, 2));

        return {
          success: true,
          action: 'trade_placed',
          reason: 'Order placed successfully on Deribit',
          mode: 'live',
          trade: liveTrade,
          deribitOrder: orderResult,
          aiCheck: aiCheck || undefined,
        };
      } catch (error) {
        return {
          success: false,
          action: 'order_failed',
          reason: `Failed to place order: ${error.message}`,
          mode: 'live',
          error: error.message,
        };
      }
    }
  } catch (error) {
    console.error('[tradeExecutor] Unexpected error:', error);
    return {
      success: false,
      action: 'error',
      reason: `Unexpected error: ${error.message}`,
      mode: botMode,
      error: error.message,
    };
  }
}

/**
 * Get current account state for risk calculations
 * 
 * @param {boolean} useTestnet - Use testnet
 * @returns {Promise<object>} Account state with equity, daily P&L, trades count
 */
export async function getAccountState(useTestnet = false) {
  try {
    const accountSummary = await getAccountSummary('BTC', useTestnet);
    const openPositions = await getOpenPositions('BTC', null, useTestnet);

    // Calculate daily P&L (simplified - Deribit API might have this directly)
    // For now, we use total P&L from account summary
    const dailyPnL = accountSummary.total_pl || 0; // This might be total, not daily
    const tradesToday = openPositions.length; // Simplified: count open positions

    return {
      equity: accountSummary.equity || accountSummary.balance || 0,
      balance: accountSummary.balance || 0,
      availableFunds: accountSummary.available_funds || 0,
      dailyPnL,
      tradesToday,
      openPositions: openPositions.length,
    };
  } catch (error) {
    console.error('[tradeExecutor] getAccountState error:', error);
    throw error;
  }
}

