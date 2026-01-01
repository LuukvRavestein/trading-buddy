/**
 * Backtest Engine
 * 
 * Runs historical backtests using Supabase candles and strategy logic.
 * Simulates trades with TP/SL monitoring and calculates performance metrics.
 */

import { getCandlesInRange, createStrategyRun, updateStrategyRun, insertStrategyTrade } from '../db/supabaseClient.js';
import { buildTimeframeState } from '../analysis/stateBuilder.mjs';

/**
 * Run backtest for a given period and config
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol (e.g., 'BTC-PERPETUAL')
 * @param {string} options.startTs - Start timestamp (ISO)
 * @param {string} options.endTs - End timestamp (ISO)
 * @param {object} options.config - Strategy configuration
 * @returns {Promise<object>} Backtest results
 */
export async function runBacktest({ symbol, startTs, endTs, config }) {
  console.log(`[backtest] Starting backtest: ${symbol} from ${startTs} to ${endTs}`);
  
  // Create run record
  const run = await createStrategyRun({
    symbol,
    start_ts: startTs,
    end_ts: endTs,
    config,
    status: 'running',
  });
  
  const runId = run.id;
  
  try {
    // Load candles with lookback window (for state computation)
    const lookbackHours = 24; // Load 24h before start for state initialization
    const lookbackStart = new Date(new Date(startTs).getTime() - lookbackHours * 60 * 60 * 1000).toISOString();
    
    console.log(`[backtest] Loading candles from ${lookbackStart} to ${endTs}`);
    
    const [candles1m, candles5m, candles15m, candles60m] = await Promise.all([
      getCandlesInRange({ symbol, timeframeMin: 1, startTs: lookbackStart, endTs }),
      getCandlesInRange({ symbol, timeframeMin: 5, startTs: lookbackStart, endTs }),
      getCandlesInRange({ symbol, timeframeMin: 15, startTs: lookbackStart, endTs }),
      getCandlesInRange({ symbol, timeframeMin: 60, startTs: lookbackStart, endTs }),
    ]);
    
    console.log(`[backtest] Loaded candles: 1m=${candles1m.length}, 5m=${candles5m.length}, 15m=${candles15m.length}, 60m=${candles60m.length}`);
    
    if (candles1m.length === 0) {
      throw new Error('No 1m candles available for backtest period');
    }
    
    // Convert candles to internal format
    const convertCandles = (candles) => candles.map(c => ({
      t: new Date(c.ts).getTime(),
      o: parseFloat(c.open),
      h: parseFloat(c.high),
      l: parseFloat(c.low),
      c: parseFloat(c.close),
      v: parseFloat(c.volume || 0),
      ts: c.ts, // Keep ISO for reference
    })).sort((a, b) => a.t - b.t);
    
    const candles1mSorted = convertCandles(candles1m);
    const candles5mSorted = convertCandles(candles5m);
    const candles15mSorted = convertCandles(candles15m);
    const candles60mSorted = convertCandles(candles60m);
    
    // Filter to backtest period (1m only)
    const startMs = new Date(startTs).getTime();
    const endMs = new Date(endTs).getTime();
    const backtestCandles = candles1mSorted.filter(c => c.t >= startMs && c.t <= endMs);
    
    console.log(`[backtest] Backtest period: ${backtestCandles.length} 1m candles`);
    
    // Initialize state caches (build from lookback data)
    const stateCache = {
      1: buildStateFromCandles(candles1mSorted, 1, symbol),
      5: buildStateFromCandles(candles5mSorted, 5, symbol),
      15: buildStateFromCandles(candles15mSorted, 15, symbol),
      60: buildStateFromCandles(candles60mSorted, 60, symbol),
    };
    
    // Track open trade
    let openTrade = null;
    const trades = [];
    
    // Iterate forward through 1m candles
    for (let i = 0; i < backtestCandles.length; i++) {
      const candle = backtestCandles[i];
      const candleTs = new Date(candle.t);
      const candleTsIso = candleTs.toISOString();
      
      // Update states at timeframe boundaries
      updateStatesAtCandle(candle, candles1mSorted, candles5mSorted, candles15mSorted, candles60mSorted, stateCache, symbol);
      
      // Check for exit on open trade
      if (openTrade) {
        const exitResult = checkTradeExit(openTrade, candle, config);
        if (exitResult.exit) {
          // Close trade
          const trade = {
            run_id: runId,
            symbol,
            direction: openTrade.direction,
            entry_ts: openTrade.entryTs,
            entry_price: openTrade.entryPrice,
            exit_ts: candleTsIso,
            exit_price: exitResult.exitPrice,
            exit_reason: exitResult.reason,
            pnl_abs: exitResult.pnlAbs,
            pnl_pct: exitResult.pnlPct,
            mfe_pct: exitResult.mfePct,
            mae_pct: exitResult.maePct,
          };
          
          trades.push(trade);
          await insertStrategyTrade(trade);
          
          console.log(`[backtest] Trade closed: ${openTrade.direction} ${openTrade.entryPrice} -> ${exitResult.exitPrice} (${exitResult.pnlPct.toFixed(2)}%)`);
          
          openTrade = null;
        } else {
          // Update MFE/MAE
          updateMFEMAE(openTrade, candle);
          
          // Check timeout
          if (config.timeout_min > 0) {
            const tradeDurationMin = (candle.t - openTrade.entryTsMs) / (60 * 1000);
            if (tradeDurationMin >= config.timeout_min) {
              // Timeout exit
              const exitPrice = candle.c; // Close at current price
              const trade = closeTrade(openTrade, candleTsIso, exitPrice, 'timeout', config);
              trades.push(trade);
              await insertStrategyTrade(trade);
              
              console.log(`[backtest] Trade timeout: ${openTrade.direction} ${openTrade.entryPrice} -> ${exitPrice}`);
              openTrade = null;
            }
          }
        }
      }
      
      // Evaluate strategy for new entry (only if no open trade)
      if (!openTrade) {
        const proposal = evaluateStrategyForBacktest(stateCache, candle, config);
        if (proposal) {
          // Open trade
          const entryPrice = applySlippage(candle.c, proposal.direction, config);
          openTrade = {
            direction: proposal.direction,
            entryPrice,
            entryTs: candleTsIso,
            entryTsMs: candle.t,
            stopLoss: proposal.stop_loss,
            takeProfit: proposal.take_profit,
            mfePct: 0,
            maePct: 0,
          };
          
          console.log(`[backtest] Trade opened: ${proposal.direction} @ ${entryPrice} (SL: ${proposal.stop_loss}, TP: ${proposal.take_profit})`);
        }
      }
    }
    
    // Close any remaining open trade at end
    if (openTrade) {
      const lastCandle = backtestCandles[backtestCandles.length - 1];
      const exitPrice = lastCandle.c;
      const trade = closeTrade(openTrade, new Date(lastCandle.t).toISOString(), exitPrice, 'timeout', config);
      trades.push(trade);
      await insertStrategyTrade(trade);
    }
    
    // Calculate metrics
    const metrics = calculateMetrics(trades, config);
    
    console.log(`[backtest] Backtest complete: ${trades.length} trades, winrate=${(metrics.winrate * 100).toFixed(1)}%, pnl=${metrics.total_pnl_pct.toFixed(2)}%`);
    
    // Update run with results
    await updateStrategyRun(runId, {
      status: 'done',
      results: metrics,
    });
    
    return {
      runId,
      trades,
      metrics,
    };
  } catch (error) {
    console.error('[backtest] Backtest failed:', error);
    await updateStrategyRun(runId, {
      status: 'failed',
      error: error.message,
    });
    throw error;
  }
}

/**
 * Build state from candles array
 */
function buildStateFromCandles(candles, timeframeMin, symbol) {
  if (candles.length === 0) return null;
  
  // Use all candles up to current point
  return buildTimeframeState({ symbol, timeframeMin, candles });
}

/**
 * Update states at current candle
 */
function updateStatesAtCandle(candle, candles1m, candles5m, candles15m, candles60m, stateCache, symbol) {
  const candleTs = candle.t;
  
  // Update 1m state (every candle)
  const candles1mUpTo = candles1m.filter(c => c.t <= candleTs);
  if (candles1mUpTo.length > 0) {
    stateCache[1] = buildStateFromCandles(candles1mUpTo, 1, symbol);
  }
  
  // Update 5m state (every 5 minutes)
  if (candleTs % (5 * 60 * 1000) < 60 * 1000) {
    const candles5mUpTo = candles5m.filter(c => c.t <= candleTs);
    if (candles5mUpTo.length > 0) {
      stateCache[5] = buildStateFromCandles(candles5mUpTo, 5, symbol);
    }
  }
  
  // Update 15m state (every 15 minutes)
  if (candleTs % (15 * 60 * 1000) < 60 * 1000) {
    const candles15mUpTo = candles15m.filter(c => c.t <= candleTs);
    if (candles15mUpTo.length > 0) {
      stateCache[15] = buildStateFromCandles(candles15mUpTo, 15, symbol);
    }
  }
  
  // Update 60m state (every 60 minutes)
  if (candleTs % (60 * 60 * 1000) < 60 * 1000) {
    const candles60mUpTo = candles60m.filter(c => c.t <= candleTs);
    if (candles60mUpTo.length > 0) {
      stateCache[60] = buildStateFromCandles(candles60mUpTo, 60, symbol);
    }
  }
}

/**
 * Evaluate strategy for backtest (simplified version of strategyEvaluator)
 */
function evaluateStrategyForBacktest(stateCache, candle, config) {
  const state1m = stateCache[1];
  const state5m = stateCache[5];
  const state15m = stateCache[15];
  const state60m = config.require_60m_align ? stateCache[60] : null;
  
  if (!state1m || !state5m || !state15m) {
    return null;
  }
  
  // Direction filter
  const directionResult = determineDirection(state5m, state15m, state60m, config);
  if (!directionResult.direction) {
    return null;
  }
  
  const direction = directionResult.direction;
  
  // Entry trigger
  const entryTrigger = checkEntryTrigger(state1m, direction, candle, config);
  if (!entryTrigger.triggered) {
    return null;
  }
  
  // Calculate SL/TP
  const atr1m = state1m.atr ? parseFloat(state1m.atr) : null;
  if (!atr1m || atr1m <= 0) {
    return null;
  }
  
  const swingHigh1m = state1m.last_swing_high ? parseFloat(state1m.last_swing_high) : null;
  const swingLow1m = state1m.last_swing_low ? parseFloat(state1m.last_swing_low) : null;
  
  if (!swingHigh1m || !swingLow1m) {
    return null;
  }
  
  const entryPrice = candle.c;
  let stopLoss, takeProfit;
  
  if (direction === 'long') {
    stopLoss = swingLow1m - (config.sl_atr_buffer * atr1m);
    const risk = entryPrice - stopLoss;
    takeProfit = entryPrice + (risk * config.rr_target);
  } else {
    stopLoss = swingHigh1m + (config.sl_atr_buffer * atr1m);
    const risk = stopLoss - entryPrice;
    takeProfit = entryPrice - (risk * config.rr_target);
  }
  
  // Risk check
  const riskPct = Math.abs((entryPrice - stopLoss) / entryPrice);
  if (riskPct < config.min_risk_pct) {
    return null;
  }
  
  return {
    direction,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    rr: config.rr_target,
  };
}

/**
 * Determine direction (with config options)
 */
function determineDirection(state5m, state15m, state60m, config) {
  const primaryTrend = state15m?.trend;
  const trend5m = state5m?.trend;
  const trend60m = state60m?.trend;
  
  // Check 60m alignment if required
  if (config.require_60m_align && trend60m) {
    if (primaryTrend === 'up' && trend60m !== 'up') return { direction: null };
    if (primaryTrend === 'down' && trend60m !== 'down') return { direction: null };
  }
  
  // Check 5m alignment if required
  if (config.require_5m_align && primaryTrend && trend5m !== primaryTrend) {
    return { direction: null };
  }
  
  // Default tolerant logic
  if (!primaryTrend || primaryTrend === 'chop') {
    return { direction: null };
  }
  
  if (primaryTrend === 'up') {
    if (trend5m === 'down') return { direction: null };
    return { direction: 'long' };
  }
  
  if (primaryTrend === 'down') {
    if (trend5m === 'up') return { direction: null };
    return { direction: 'short' };
  }
  
  return { direction: null };
}

/**
 * Check entry trigger (with config options)
 */
function checkEntryTrigger(state1m, direction, candle, config) {
  const latestClose = candle.c;
  const latestHigh = candle.h;
  const latestLow = candle.l;
  
  const swingHigh = state1m.last_swing_high ? parseFloat(state1m.last_swing_high) : null;
  const swingLow = state1m.last_swing_low ? parseFloat(state1m.last_swing_low) : null;
  
  // Primary trigger
  let primaryTrigger = false;
  if (config.entry_trigger === 'choch') {
    primaryTrigger = (direction === 'long' && state1m.choch_direction === 'up') ||
                     (direction === 'short' && state1m.choch_direction === 'down');
  } else if (config.entry_trigger === 'bos') {
    primaryTrigger = (direction === 'long' && state1m.bos_direction === 'up') ||
                     (direction === 'short' && state1m.bos_direction === 'down');
  } else {
    // 'either'
    primaryTrigger = (direction === 'long' && (state1m.choch_direction === 'up' || state1m.bos_direction === 'up')) ||
                     (direction === 'short' && (state1m.choch_direction === 'down' || state1m.bos_direction === 'down'));
  }
  
  // Fallback trigger
  let fallbackTrigger = false;
  if (swingHigh !== null && swingLow !== null) {
    if (direction === 'long') {
      fallbackTrigger = latestClose >= swingHigh || latestHigh >= swingHigh;
    } else {
      fallbackTrigger = latestClose <= swingLow || latestLow <= swingLow;
    }
  }
  
  return {
    triggered: primaryTrigger || fallbackTrigger,
    triggerType: primaryTrigger ? 'primary' : (fallbackTrigger ? 'fallback' : null),
  };
}

/**
 * Check trade exit
 */
function checkTradeExit(trade, candle, config) {
  const { direction, stopLoss, takeProfit } = trade;
  
  let exit = false;
  let exitPrice = null;
  let reason = null;
  
  if (direction === 'long') {
    // Check SL first (worst case)
    if (candle.l <= stopLoss) {
      exit = true;
      exitPrice = stopLoss;
      reason = 'sl';
    } else if (candle.h >= takeProfit) {
      exit = true;
      exitPrice = takeProfit;
      reason = 'tp';
    }
  } else {
    // Short
    if (candle.h >= stopLoss) {
      exit = true;
      exitPrice = stopLoss;
      reason = 'sl';
    } else if (candle.l <= takeProfit) {
      exit = true;
      exitPrice = takeProfit;
      reason = 'tp';
    }
  }
  
  if (!exit) {
    return { exit: false };
  }
  
  // Calculate PnL
  const pnlAbs = direction === 'long' 
    ? (exitPrice - trade.entryPrice)
    : (trade.entryPrice - exitPrice);
  const pnlPct = (pnlAbs / trade.entryPrice) * 100;
  
  // Apply fees
  const takerFeeBps = config.taker_fee_bps || 5; // Default 0.05%
  const feePct = (takerFeeBps / 10000) * 2; // Entry + exit
  const pnlPctAfterFees = pnlPct - feePct;
  const pnlAbsAfterFees = pnlAbs - (trade.entryPrice * feePct / 100);
  
  return {
    exit: true,
    exitPrice,
    reason,
    pnlAbs: pnlAbsAfterFees,
    pnlPct: pnlPctAfterFees,
    mfePct: trade.mfePct,
    maePct: trade.maePct,
  };
}

/**
 * Update MFE/MAE
 */
function updateMFEMAE(trade, candle) {
  const { direction, entryPrice } = trade;
  
  if (direction === 'long') {
    const favorable = ((candle.h - entryPrice) / entryPrice) * 100;
    const adverse = ((candle.l - entryPrice) / entryPrice) * 100;
    trade.mfePct = Math.max(trade.mfePct, favorable);
    trade.maePct = Math.min(trade.maePct, adverse);
  } else {
    const favorable = ((entryPrice - candle.l) / entryPrice) * 100;
    const adverse = ((entryPrice - candle.h) / entryPrice) * 100;
    trade.mfePct = Math.max(trade.mfePct, favorable);
    trade.maePct = Math.min(trade.maePct, adverse);
  }
}

/**
 * Close trade
 */
function closeTrade(trade, exitTs, exitPrice, reason, config) {
  const pnlAbs = trade.direction === 'long'
    ? (exitPrice - trade.entryPrice)
    : (trade.entryPrice - exitPrice);
  const pnlPct = (pnlAbs / trade.entryPrice) * 100;
  
  // Apply fees
  const takerFeeBps = config.taker_fee_bps || 5;
  const feePct = (takerFeeBps / 10000) * 2;
  const pnlPctAfterFees = pnlPct - feePct;
  const pnlAbsAfterFees = pnlAbs - (trade.entryPrice * feePct / 100);
  
  return {
    run_id: trade.run_id,
    symbol: trade.symbol,
    direction: trade.direction,
    entry_ts: trade.entryTs,
    entry_price: trade.entryPrice,
    exit_ts: exitTs,
    exit_price: exitPrice,
    exit_reason: reason,
    pnl_abs: pnlAbsAfterFees,
    pnl_pct: pnlPctAfterFees,
    mfe_pct: trade.mfePct,
    mae_pct: trade.maePct,
  };
}

/**
 * Apply slippage
 */
function applySlippage(price, direction, config) {
  const slippageBps = config.slippage_bps || 2; // Default 0.02%
  const slippagePct = slippageBps / 10000;
  
  if (direction === 'long') {
    return price * (1 + slippagePct); // Buy higher
  } else {
    return price * (1 - slippagePct); // Sell lower
  }
}

/**
 * Calculate metrics
 */
function calculateMetrics(trades, config) {
  if (trades.length === 0) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      winrate: 0,
      total_pnl_pct: 0,
      avg_pnl_pct: 0,
      expectancy_pct: 0,
      max_drawdown_pct: 0,
      profit_factor: 0,
      avg_trade_duration_min: 0,
    };
  }
  
  const wins = trades.filter(t => t.pnl_pct > 0).length;
  const losses = trades.filter(t => t.pnl_pct < 0).length;
  const winrate = wins / trades.length;
  
  const totalPnlPct = trades.reduce((sum, t) => sum + t.pnl_pct, 0);
  const avgPnlPct = totalPnlPct / trades.length;
  
  const winningTrades = trades.filter(t => t.pnl_pct > 0);
  const losingTrades = trades.filter(t => t.pnl_pct < 0);
  const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.pnl_pct, 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl_pct, 0) / losingTrades.length) : 0;
  const expectancyPct = (winrate * avgWin) - ((1 - winrate) * avgLoss);
  
  // Profit factor
  const grossProfit = winningTrades.reduce((sum, t) => sum + Math.abs(t.pnl_pct), 0);
  const grossLoss = losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl_pct), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  
  // Drawdown (equity curve)
  let equity = 100; // Start at 100%
  let peak = 100;
  let maxDrawdown = 0;
  
  for (const trade of trades) {
    equity = equity * (1 + trade.pnl_pct / 100);
    if (equity > peak) {
      peak = equity;
    }
    const drawdown = ((peak - equity) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  // Average trade duration
  const durations = trades.map(t => {
    const entryMs = new Date(t.entry_ts).getTime();
    const exitMs = new Date(t.exit_ts).getTime();
    return (exitMs - entryMs) / (60 * 1000); // minutes
  });
  const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  
  return {
    trades: trades.length,
    wins,
    losses,
    winrate,
    total_pnl_pct: totalPnlPct,
    avg_pnl_pct: avgPnlPct,
    expectancy_pct: expectancyPct,
    max_drawdown_pct: maxDrawdown,
    profit_factor: profitFactor,
    avg_trade_duration_min: avgDuration,
  };
}

