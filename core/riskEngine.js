/**
 * Risk Engine
 * 
 * Implements risk management rules for trading:
 * - Max risk per trade (default 1% of equity)
 * - Max daily loss (default 3% of equity)
 * - Max trades per day (default 5)
 * - Stop loss distance validation (max 0.6%)
 * - Risk:Reward ratio validation (min 1:2)
 * 
 * Environment variables:
 * - MAX_RISK_PERCENT (default: 1)
 * - MAX_DAILY_LOSS_PERCENT (default: 3)
 * - MAX_TRADES_PER_DAY (default: 5)
 */

/**
 * Calculate position size in USD based on risk percentage
 * 
 * Formula: position_size_usd = (equity * risk_percent) / (SL_distance_in_%)
 * 
 * @param {object} params - Calculation parameters
 * @param {number} params.equity - Account equity in USD
 * @param {number} params.riskPercent - Risk percentage (e.g., 1 for 1%)
 * @param {number} params.entryPrice - Entry price
 * @param {number} params.stopLossPrice - Stop loss price
 * @returns {number} Position size in USD
 */
export function calculatePositionSize({ equity, riskPercent, entryPrice, stopLossPrice }) {
  if (!equity || equity <= 0) {
    throw new Error('Equity must be a positive number');
  }
  if (!riskPercent || riskPercent <= 0) {
    throw new Error('Risk percentage must be positive');
  }
  if (!entryPrice || entryPrice <= 0) {
    throw new Error('Entry price must be positive');
  }
  if (!stopLossPrice || stopLossPrice <= 0) {
    throw new Error('Stop loss price must be positive');
  }

  // Calculate SL distance as percentage
  const slDistancePercent = Math.abs((entryPrice - stopLossPrice) / entryPrice) * 100;

  if (slDistancePercent === 0) {
    throw new Error('Stop loss price cannot equal entry price');
  }

  // Calculate position size: (equity * risk_percent) / (SL_distance_in_%)
  const positionSizeUsd = (equity * riskPercent) / slDistancePercent;

  return Math.max(0, positionSizeUsd); // Ensure non-negative
}

/**
 * Calculate stop loss distance as percentage
 * 
 * @param {number} entryPrice - Entry price
 * @param {number} stopLossPrice - Stop loss price
 * @returns {number} SL distance as percentage
 */
function calculateSLDistance(entryPrice, stopLossPrice) {
  return Math.abs((entryPrice - stopLossPrice) / entryPrice) * 100;
}

/**
 * Calculate risk:reward ratio
 * 
 * @param {number} entryPrice - Entry price
 * @param {number} stopLossPrice - Stop loss price
 * @param {number} takeProfitPrice - Take profit price
 * @returns {number} Risk:Reward ratio (e.g., 2.5 means 1:2.5)
 */
function calculateRiskReward(entryPrice, stopLossPrice, takeProfitPrice) {
  if (!takeProfitPrice) return null;

  const risk = Math.abs(entryPrice - stopLossPrice);
  const reward = Math.abs(takeProfitPrice - entryPrice);

  if (risk === 0) return null;

  return reward / risk;
}

/**
 * Check if a new trade can be opened
 * 
 * @param {object} context - Trade context
 * @param {number} context.equity - Current account equity in USD
 * @param {number} context.entryPrice - Proposed entry price
 * @param {number} context.stopLossPrice - Proposed stop loss price
 * @param {number} [context.takeProfitPrice] - Proposed take profit price (optional)
 * @param {number} [context.currentDailyPnL] - Current daily P&L in USD (default: 0)
 * @param {number} [context.tradesToday] - Number of trades executed today (default: 0)
 * @param {number} [context.maxRiskPercent] - Max risk per trade % (from env or default 1)
 * @param {number} [context.maxDailyLossPercent] - Max daily loss % (from env or default 3)
 * @param {number} [context.maxTradesPerDay] - Max trades per day (from env or default 5)
 * @param {number} [context.maxSLDistancePercent] - Max SL distance % (default: 0.6)
 * @param {number} [context.minRiskReward] - Min R:R ratio (default: 2.0)
 * @returns {object} { allowed: boolean, reason: string, positionSizeUsd?: number }
 */
export function canOpenNewTrade(context) {
  const {
    equity,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    currentDailyPnL = 0,
    tradesToday = 0,
    maxRiskPercent = parseFloat(process.env.MAX_RISK_PERCENT) || 1,
    maxDailyLossPercent = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT) || 3,
    maxTradesPerDay = parseInt(process.env.MAX_TRADES_PER_DAY) || 5,
    maxSLDistancePercent = 0.6, // Hardcoded as per strategy rules
    minRiskReward = 2.0, // Hardcoded as per strategy rules (1:2)
  } = context;

  // Validation: required parameters
  if (!equity || equity <= 0) {
    return { allowed: false, reason: 'Invalid equity: must be positive' };
  }
  if (!entryPrice || entryPrice <= 0) {
    return { allowed: false, reason: 'Invalid entry price: must be positive' };
  }
  if (!stopLossPrice || stopLossPrice <= 0) {
    return { allowed: false, reason: 'Invalid stop loss price: must be positive' };
  }

  // Check 1: Max trades per day
  if (tradesToday >= maxTradesPerDay) {
    return {
      allowed: false,
      reason: `Max trades per day reached (${tradesToday}/${maxTradesPerDay})`,
    };
  }

  // Check 2: Daily loss limit
  const maxDailyLoss = equity * (maxDailyLossPercent / 100);
  if (currentDailyPnL <= -maxDailyLoss) {
    return {
      allowed: false,
      reason: `Daily loss limit exceeded: ${currentDailyPnL.toFixed(2)} USD (limit: ${-maxDailyLoss.toFixed(2)} USD)`,
    };
  }

  // Check 3: Stop loss distance validation
  const slDistance = calculateSLDistance(entryPrice, stopLossPrice);
  if (slDistance > maxSLDistancePercent) {
    return {
      allowed: false,
      reason: `Stop loss distance too large: ${slDistance.toFixed(2)}% (max: ${maxSLDistancePercent}%)`,
    };
  }

  // Check 4: Risk:Reward ratio validation (if TP provided)
  if (takeProfitPrice) {
    const rr = calculateRiskReward(entryPrice, stopLossPrice, takeProfitPrice);
    if (rr && rr < minRiskReward) {
      return {
        allowed: false,
        reason: `Risk:Reward ratio too low: 1:${rr.toFixed(2)} (min: 1:${minRiskReward})`,
      };
    }
  }

  // Check 5: Calculate position size and verify it's reasonable
  try {
    const positionSizeUsd = calculatePositionSize({
      equity,
      riskPercent: maxRiskPercent,
      entryPrice,
      stopLossPrice,
    });

    // Additional check: position size should be at least $10 (minimum reasonable trade)
    if (positionSizeUsd < 10) {
      return {
        allowed: false,
        reason: `Calculated position size too small: $${positionSizeUsd.toFixed(2)} (min: $10)`,
      };
    }

    // All checks passed
    return {
      allowed: true,
      reason: 'All risk checks passed',
      positionSizeUsd: Math.round(positionSizeUsd * 100) / 100, // Round to 2 decimals
      slDistancePercent: Math.round(slDistance * 100) / 100,
      riskReward: takeProfitPrice ? calculateRiskReward(entryPrice, stopLossPrice, takeProfitPrice) : null,
    };
  } catch (error) {
    return {
      allowed: false,
      reason: `Position size calculation error: ${error.message}`,
    };
  }
}

/**
 * Validate trade signal from TradingView
 * Basic validation of required fields
 * 
 * @param {object} signal - TradingView signal
 * @param {string} signal.signal - 'LONG' or 'SHORT'
 * @param {string} signal.symbol - Instrument symbol
 * @param {number} signal.entry_price - Entry price
 * @param {number} signal.sl_price - Stop loss price
 * @param {number} [signal.tp_price] - Take profit price (optional)
 * @returns {object} { valid: boolean, reason?: string }
 */
export function validateTradeSignal(signal) {
  if (!signal) {
    return { valid: false, reason: 'No signal provided' };
  }

  if (!signal.signal || !['LONG', 'SHORT'].includes(signal.signal.toUpperCase())) {
    return { valid: false, reason: 'Invalid signal: must be LONG or SHORT' };
  }

  if (!signal.symbol) {
    return { valid: false, reason: 'Missing symbol' };
  }

  if (!signal.entry_price || signal.entry_price <= 0) {
    return { valid: false, reason: 'Invalid entry_price: must be positive' };
  }

  if (!signal.sl_price || signal.sl_price <= 0) {
    return { valid: false, reason: 'Invalid sl_price: must be positive' };
  }

  // Validate that SL is on the correct side
  const isLong = signal.signal.toUpperCase() === 'LONG';
  if (isLong && signal.sl_price >= signal.entry_price) {
    return { valid: false, reason: 'For LONG: stop loss must be below entry price' };
  }
  if (!isLong && signal.sl_price <= signal.entry_price) {
    return { valid: false, reason: 'For SHORT: stop loss must be above entry price' };
  }

  // Validate TP if provided
  if (signal.tp_price) {
    if (isLong && signal.tp_price <= signal.entry_price) {
      return { valid: false, reason: 'For LONG: take profit must be above entry price' };
    }
    if (!isLong && signal.tp_price >= signal.entry_price) {
      return { valid: false, reason: 'For SHORT: take profit must be below entry price' };
    }
  }

  return { valid: true };
}

