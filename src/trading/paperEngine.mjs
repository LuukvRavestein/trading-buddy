/**
 * Paper Engine
 * 
 * Pure trading simulator functions for paper trading.
 * Handles position opening/closing, P&L calculation, fees, slippage, and equity tracking.
 */

/**
 * Calculate fees for a trade
 * 
 * @param {object} options
 * @param {number} options.notional - Notional value (size * price)
 * @param {number} options.takerFeeBps - Taker fee in basis points (default: 5 = 0.05%)
 * @returns {number} Fees in absolute terms
 */
export function calcFees({ notional, takerFeeBps = 5 }) {
  return (notional * takerFeeBps) / 10000;
}

/**
 * Apply slippage to price
 * 
 * @param {object} options
 * @param {number} options.price - Base price
 * @param {string} options.side - 'long' or 'short'
 * @param {number} options.slippageBps - Slippage in basis points (default: 2 = 0.02%)
 * @returns {number} Price with slippage applied
 */
export function applySlippage({ price, side, slippageBps = 2 }) {
  const slippageMultiplier = slippageBps / 10000;
  if (side === 'long') {
    // Long: pay more (buy at higher price)
    return price * (1 + slippageMultiplier);
  } else {
    // Short: receive less (sell at lower price)
    return price * (1 - slippageMultiplier);
  }
}

/**
 * Open a position
 * 
 * @param {object} options
 * @param {string} options.side - 'long' or 'short'
 * @param {number} options.entry - Entry price
 * @param {number} options.sl - Stop loss price
 * @param {number} options.tp - Take profit price
 * @param {number} options.riskPct - Risk percentage (e.g., 0.01 for 1%)
 * @param {number} options.equity - Current equity
 * @param {number} options.price - Actual fill price (with slippage)
 * @param {number} options.takerFeeBps - Taker fee in basis points
 * @param {number} options.slippageBps - Slippage in basis points
 * @returns {object} Position object
 */
export function openPosition({ side, entry, sl, tp, riskPct, equity, price, takerFeeBps = 5, slippageBps = 2 }) {
  // Calculate position size based on risk
  const riskAmount = equity * riskPct;
  const slDistance = Math.abs(entry - sl);
  const slDistancePct = slDistance / entry;
  
  // Position size in notional terms
  const notional = riskAmount / slDistancePct;
  const size = notional / entry; // Size in BTC (or contract units)
  
  // Apply slippage to fill price
  const fillPrice = applySlippage({ price: entry, side, slippageBps });
  
  // Calculate fees
  const fillNotional = size * fillPrice;
  const feesPaid = calcFees({ notional: fillNotional, takerFeeBps });
  
  return {
    side,
    entry: fillPrice,
    size,
    sl,
    tp,
    opened_ts: new Date().toISOString(),
    fees_paid: feesPaid,
    risk_pct: riskPct,
    notional: fillNotional,
  };
}

/**
 * Check if exit conditions are hit on a candle
 * 
 * Uses worst-case fill ordering:
 * - For long: if low <= sl -> SL first; else if high >= tp -> TP
 * - For short: if high >= sl -> SL first; else if low <= tp -> TP
 * 
 * @param {object} position - Position object
 * @param {object} candle - Candle object {o, h, l, c}
 * @returns {object|null} Exit result or null if no exit
 */
export function checkExitOnCandle(position, candle) {
  const { side, sl, tp } = position;
  const { h, l } = candle;
  
  if (side === 'long') {
    // Long: SL hit if low <= sl, TP hit if high >= tp
    if (sl && l <= sl) {
      return {
        exit: true,
        exitPrice: sl,
        reason: 'sl',
      };
    }
    if (tp && h >= tp) {
      return {
        exit: true,
        exitPrice: tp,
        reason: 'tp',
      };
    }
  } else {
    // Short: SL hit if high >= sl, TP hit if low <= tp
    if (sl && h >= sl) {
      return {
        exit: true,
        exitPrice: sl,
        reason: 'sl',
      };
    }
    if (tp && l <= tp) {
      return {
        exit: true,
        exitPrice: tp,
        reason: 'tp',
      };
    }
  }
  
  return null;
}

/**
 * Close a position
 * 
 * @param {object} options
 * @param {object} options.position - Position object
 * @param {number} options.exitPrice - Exit price
 * @param {number} options.slippageBps - Slippage in basis points
 * @param {number} options.takerFeeBps - Taker fee in basis points
 * @returns {object} Close result with P&L
 */
export function closePosition({ position, exitPrice, slippageBps = 2, takerFeeBps = 5 }) {
  const { side, entry, size } = position;
  
  // Apply slippage to exit price
  const fillExitPrice = applySlippage({ price: exitPrice, side: side === 'long' ? 'short' : 'long', slippageBps });
  
  // Calculate exit notional
  const exitNotional = size * fillExitPrice;
  
  // Calculate fees
  const exitFees = calcFees({ notional: exitNotional, takerFeeBps });
  const totalFees = (position.fees_paid || 0) + exitFees;
  
  // Calculate P&L
  let pnlAbs;
  if (side === 'long') {
    pnlAbs = exitNotional - (size * entry) - totalFees;
  } else {
    pnlAbs = (size * entry) - exitNotional - totalFees;
  }
  
  // P&L percentage based on entry notional
  const entryNotional = size * entry;
  const pnlPct = (pnlAbs / entryNotional) * 100;
  
  // Determine result
  let result = 'breakeven';
  if (pnlAbs > 0.01) {
    result = 'win';
  } else if (pnlAbs < -0.01) {
    result = 'loss';
  }
  
  return {
    exitPrice: fillExitPrice,
    pnlAbs,
    pnlPct,
    feesAbs: totalFees,
    result,
  };
}

/**
 * Update equity and drawdown
 * 
 * @param {object} options
 * @param {number} options.equity - Current equity
 * @param {number} options.maxEquity - Maximum equity seen
 * @returns {object} Updated equity and drawdown
 */
export function updateEquityAndDD({ equity, maxEquity }) {
  const newMaxEquity = Math.max(equity, maxEquity);
  const drawdown = newMaxEquity > 0 ? ((newMaxEquity - equity) / newMaxEquity) * 100 : 0;
  
  return {
    equity,
    maxEquity: newMaxEquity,
    maxDrawdownPct: drawdown,
  };
}

/**
 * Calculate mark-to-market equity for open position
 * 
 * @param {object} options
 * @param {number} options.balance - Account balance
 * @param {object} options.position - Open position
 * @param {number} options.markPrice - Current market price (candle close)
 * @returns {number} Mark-to-market equity
 */
export function calculateMarkToMarketEquity({ balance, position, markPrice }) {
  if (!position) {
    return balance;
  }
  
  const { side, entry, size } = position;
  
  // Calculate unrealized P&L
  let unrealizedPnl;
  if (side === 'long') {
    unrealizedPnl = (markPrice - entry) * size;
  } else {
    unrealizedPnl = (entry - markPrice) * size;
  }
  
  // Equity = balance + unrealized P&L (fees already deducted from balance on open)
  return balance + unrealizedPnl;
}

/**
 * Calculate profit factor
 * 
 * @param {number} totalWins - Total winning trades P&L
 * @param {number} totalLosses - Total losing trades P&L (absolute value)
 * @returns {number|null} Profit factor or null if no losses
 */
export function calculateProfitFactor(totalWins, totalLosses) {
  if (totalLosses === 0) {
    return totalWins > 0 ? Infinity : null;
  }
  return totalWins / totalLosses;
}

