/**
 * TradingView Webhook Handler
 * 
 * Receives trading signals from TradingView alerts and executes trades
 * via the trade executor.
 * 
 * Environment variables:
 * - WEBHOOK_SECRET (optional, for security)
 * - BOT_MODE (paper or live)
 * - DERIBIT_CLIENT_ID
 * - DERIBIT_CLIENT_SECRET
 */

import { executeTrade, getAccountState } from '../core/tradeExecutor.js';

/**
 * Validate webhook secret if configured
 * 
 * @param {object} payload - Webhook payload
 * @returns {boolean} True if secret is valid or not required
 */
function validateWebhookSecret(payload) {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  
  // If no secret is configured, skip validation
  if (!webhookSecret) {
    return true;
  }
  
  // Check if payload contains secret
  const payloadSecret = payload.secret || payload.webhook_secret;
  
  if (!payloadSecret) {
    return false;
  }
  
  return payloadSecret === webhookSecret;
}

/**
 * Parse TradingView alert payload
 * TradingView can send payload as JSON string or object
 * 
 * @param {object|string} body - Request body
 * @returns {object} Parsed payload
 */
function parsePayload(body) {
  // If body is already an object, return it
  if (typeof body === 'object' && body !== null) {
    return body;
  }
  
  // If body is a string, try to parse as JSON
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (error) {
      // If JSON parsing fails, TradingView might have sent it as form data
      // Try to extract JSON from the string
      const jsonMatch = body.match(/\{.*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Invalid JSON payload');
    }
  }
  
  return {};
}

/**
 * Main webhook handler
 */
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      action: 'rejected',
      reason: 'Method not allowed. Use POST.',
    });
  }

  const startTime = Date.now();

  try {
    // Parse payload
    let payload;
    try {
      payload = parsePayload(req.body);
    } catch (error) {
      console.error('[webhook] Payload parsing error:', error);
      return res.status(400).json({
        status: 'error',
        action: 'rejected',
        reason: `Invalid payload format: ${error.message}`,
      });
    }

    // Log received payload (without secret for security)
    const logPayload = { ...payload };
    if (logPayload.secret) delete logPayload.secret;
    if (logPayload.webhook_secret) delete logPayload.webhook_secret;
    console.log('[webhook] Received payload:', JSON.stringify(logPayload));

    // Validate webhook secret
    if (!validateWebhookSecret(payload)) {
      console.warn('[webhook] Invalid webhook secret');
      return res.status(401).json({
        status: 'error',
        action: 'rejected',
        reason: 'Invalid webhook secret',
      });
    }

    // Extract signal data
    const signal = {
      signal: payload.signal, // 'LONG' or 'SHORT'
      symbol: payload.symbol || payload.ticker || 'BTC-PERPETUAL',
      entry_price: parseFloat(payload.entry_price),
      sl_price: parseFloat(payload.sl_price),
      tp_price: payload.tp_price ? parseFloat(payload.tp_price) : undefined,
    };

    // Validate required fields
    if (!signal.signal || !['LONG', 'SHORT'].includes(signal.signal.toUpperCase())) {
      return res.status(400).json({
        status: 'error',
        action: 'rejected',
        reason: 'Invalid or missing signal. Must be LONG or SHORT.',
      });
    }

    if (!signal.entry_price || isNaN(signal.entry_price) || signal.entry_price <= 0) {
      return res.status(400).json({
        status: 'error',
        action: 'rejected',
        reason: 'Invalid or missing entry_price',
      });
    }

    if (!signal.sl_price || isNaN(signal.sl_price) || signal.sl_price <= 0) {
      return res.status(400).json({
        status: 'error',
        action: 'rejected',
        reason: 'Invalid or missing sl_price',
      });
    }

    // Get account state for risk calculations
    let accountState;
    try {
      const useTestnet = process.env.DERIBIT_USE_TESTNET === 'true';
      accountState = await getAccountState(useTestnet);
    } catch (error) {
      console.error('[webhook] Failed to get account state:', error);
      return res.status(500).json({
        status: 'error',
        action: 'rejected',
        reason: `Failed to get account state: ${error.message}`,
      });
    }

    // Execute trade
    const useTestnet = process.env.DERIBIT_USE_TESTNET === 'true';
    const tradeResult = await executeTrade(signal, {
      currentDailyPnL: accountState.dailyPnL || 0,
      tradesToday: accountState.tradesToday || 0,
      useTestnet,
    });

    // Log result
    const processingTime = Date.now() - startTime;
    console.log(`[webhook] Trade execution result (${processingTime}ms):`, {
      success: tradeResult.success,
      action: tradeResult.action,
      reason: tradeResult.reason,
      mode: tradeResult.mode,
    });

    // Return response
    const response = {
      status: tradeResult.success ? 'ok' : 'error',
      action: tradeResult.action,
      reason: tradeResult.reason,
      mode: tradeResult.mode,
      timestamp: new Date().toISOString(),
      processing_time_ms: processingTime,
    };

    // Add trade details if successful
    if (tradeResult.success && tradeResult.trade) {
      response.trade = {
        instrument: tradeResult.trade.instrument,
        side: tradeResult.trade.side,
        amount: tradeResult.trade.amount,
        price: tradeResult.trade.price,
        positionSizeUsd: tradeResult.trade.positionSizeUsd,
        stopLoss: tradeResult.trade.stopLoss,
        takeProfit: tradeResult.trade.takeProfit,
      };

      // Add order ID if live trade
      if (tradeResult.deribitOrder) {
        response.order_id = tradeResult.deribitOrder.order_id;
        response.order_state = tradeResult.deribitOrder.order_state;
      }
    }

    // Add risk check info if available
    if (tradeResult.riskCheck) {
      response.risk_check = tradeResult.riskCheck;
    }

    // Add account info
    response.account = {
      equity: accountState.equity,
      dailyPnL: accountState.dailyPnL,
      tradesToday: accountState.tradesToday,
    };

    // Return appropriate status code
    const statusCode = tradeResult.success ? 200 : 400;
    return res.status(statusCode).json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('[webhook] Unexpected error:', error);
    
    return res.status(500).json({
      status: 'error',
      action: 'error',
      reason: `Unexpected server error: ${error.message}`,
      timestamp: new Date().toISOString(),
      processing_time_ms: processingTime,
    });
  }
}
