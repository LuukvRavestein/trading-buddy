/**
 * Paper Trade Runner
 * 
 * Live paper trading runner that evaluates multiple strategy configs in parallel
 * on Deribit BTC-PERPETUAL using live candle data.
 * 
 * Usage:
 *   node src/jobs/paperTradeRunner.mjs
 * 
 * Environment variables:
 *   SYMBOL - Symbol (default: BTC-PERPETUAL)
 *   PAPER_TIMEFRAME_MIN - Timeframe in minutes (default: 1)
 *   PAPER_BALANCE_START - Starting balance (default: 1000)
 *   PAPER_TOP_N - Number of top configs to load (default: 10)
 *   PAPER_OPTIMIZER_RUN_ID - Optimizer run ID (required)
 *   PAPER_POLL_SECONDS - Poll interval (default: 15)
 *   PAPER_MIN_TRADES_BEFORE_KILL - Min trades before kill rules apply (default: 50)
 *   PAPER_KILL_MAX_DD_PCT - Max drawdown % to kill (default: 12)
 *   PAPER_KILL_MIN_PF - Min profit factor to keep (default: 0.8)
 *   PAPER_KILL_MIN_PNL_PCT - Min P&L % to keep (default: -2)
 *   DISCORD_WEBHOOK_URL - Optional Discord webhook URL
 */

import { createPaperRun, updatePaperRun, upsertPaperConfigsFromOptimizerRun, seedPaperAccountsForRun, getActivePaperAccounts, upsertAccountCheckpoint, insertTradeOpen, updateTradeClose, upsertEquitySnapshot, killConfig, logEvent } from '../db/paperTradingRepo.mjs';
import { openPosition, checkExitOnCandle, closePosition, updateEquityAndDD, calculateMarkToMarketEquity, calculateProfitFactor } from '../trading/paperEngine.mjs';
import { buildStateCache, evaluateStrategy, loadCandlesForTimeframes } from '../trading/strategyRunner.mjs';
import { getCandlesBetween, getMaxCandleTs } from '../db/supabaseClient.js';
import { normalizeISO, addMinutesISO } from '../utils/time.mjs';

// Configuration from env
const SYMBOL = process.env.SYMBOL || 'BTC-PERPETUAL';
const REQUESTED_PAPER_TIMEFRAME_MIN = parseInt(process.env.PAPER_TIMEFRAME_MIN || '1', 10);
const PAPER_TIMEFRAME_MIN = 1;
const PAPER_BALANCE_START = parseFloat(process.env.PAPER_BALANCE_START || '1000', 10);
const PAPER_TOP_N = parseInt(process.env.PAPER_TOP_N || '10', 10);
const PAPER_OPTIMIZER_RUN_ID = process.env.PAPER_OPTIMIZER_RUN_ID;
const PAPER_POLL_SECONDS = parseInt(process.env.PAPER_POLL_SECONDS || '15', 10);
const PAPER_MIN_TRADES_BEFORE_KILL = parseInt(process.env.PAPER_MIN_TRADES_BEFORE_KILL || '50', 10);
const PAPER_KILL_MAX_DD_PCT = parseFloat(process.env.PAPER_KILL_MAX_DD_PCT || '12', 10);
const PAPER_KILL_MIN_PF = parseFloat(process.env.PAPER_KILL_MIN_PF || '0.8', 10);
const PAPER_KILL_MIN_PNL_PCT = parseFloat(process.env.PAPER_KILL_MIN_PNL_PCT || '-2', 10);
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const PAPER_RUN_ID = process.env.PAPER_RUN_ID; // Optional: resume existing run

const REQUIRED_TIMEFRAMES = [1, 5, 15];

if (REQUESTED_PAPER_TIMEFRAME_MIN !== PAPER_TIMEFRAME_MIN) {
  console.warn(`[paperRunner] PAPER_TIMEFRAME_MIN=${REQUESTED_PAPER_TIMEFRAME_MIN} ignored; using ${PAPER_TIMEFRAME_MIN}m base for live multi-timeframe trading`);
}

// Parse PAPER_SAFE_LAG_MIN with validation
function parseSafeLagMin() {
  const envValue = process.env.PAPER_SAFE_LAG_MIN;
  if (!envValue) {
    return 1; // Default
  }
  
  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed < 0) {
    console.warn(`[paperRunner] Invalid PAPER_SAFE_LAG_MIN="${envValue}", using default 1`);
    return 1;
  }
  
  // Clamp to 0-10 for safety
  return Math.min(Math.max(parsed, 0), 10);
}

const PAPER_SAFE_LAG_MIN = parseSafeLagMin();

let shouldStop = false;

/**
 * Convert timestamp to epoch milliseconds
 * 
 * @param {string|Date|null} ts - Timestamp (ISO string, Date, or null)
 * @returns {number|null} Epoch milliseconds or null
 */
function toMs(ts) {
  if (ts === null || ts === undefined) {
    return null;
  }
  if (ts instanceof Date) {
    return ts.getTime();
  }
  if (typeof ts === 'string') {
    const date = new Date(ts);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date.getTime();
  }
  return null;
}

/**
 * Convert epoch milliseconds to ISO string
 * 
 * @param {number} ms - Epoch milliseconds
 * @returns {string} ISO timestamp string
 */
function toIso(ms) {
  return new Date(ms).toISOString();
}

/**
 * Round down to nearest minute boundary
 * 
 * @param {number} ms - Epoch milliseconds
 * @returns {number} Milliseconds rounded down to minute boundary
 */
function roundDownToMinuteMs(ms) {
  return ms - (ms % 60000);
}

/**
 * Post message to Discord webhook
 */
async function postDiscord(message) {
  if (!DISCORD_WEBHOOK_URL) {
    return;
  }
  
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
  } catch (error) {
    console.error('[paperRunner] Discord webhook error:', error.message);
  }
}

/**
 * Load candles with pagination/chunking
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol
 * @param {number} options.timeframeMin - Timeframe in minutes
 * @param {string} options.startTs - Start timestamp (ISO)
 * @param {string} options.endTs - End timestamp (ISO)
 * @param {number} options.pageSize - Page size (default: 1000)
 * @returns {Promise<Array>} All candles in range
 */
async function loadCandlesPaged({ symbol, timeframeMin, startTs, endTs, pageSize = 1000 }) {
  const allCandles = [];
  let currentStartTs = startTs;
  
  while (true) {
    if (shouldStop) {
      break;
    }
    
    const candles = await getCandlesBetween({
      symbol,
      timeframeMin,
      startTs: currentStartTs,
      endTs,
      limit: pageSize,
    });
    
    if (candles.length === 0) {
      break;
    }
    
    allCandles.push(...candles);
    
    // Get last candle timestamp
    const lastCandle = candles[candles.length - 1];
    const lastTs = new Date(lastCandle.ts).getTime();
    const endTsMs = new Date(endTs).getTime();
    
    // If we've reached or passed endTs, stop
    if (lastTs >= endTsMs) {
      break;
    }
    
    // Next start is lastTs + timeframeMin minutes
    currentStartTs = addMinutesISO(normalizeISO(lastCandle.ts), timeframeMin);
    
    // Safety check: if next start >= endTs, stop
    if (new Date(currentStartTs).getTime() >= endTsMs) {
      break;
    }
  }
  
  return allCandles;
}

/**
 * Process a candle for an account
 */
function normalizeOpenPositions(openPosition) {
  if (!openPosition) {
    return { long: null, short: null };
  }
  
  if (openPosition.long || openPosition.short) {
    return {
      long: openPosition.long || null,
      short: openPosition.short || null,
    };
  }
  
  if (openPosition.side === 'long' || openPosition.side === 'short') {
    return {
      long: openPosition.side === 'long' ? openPosition : null,
      short: openPosition.side === 'short' ? openPosition : null,
    };
  }
  
  return { long: null, short: null };
}

function serializeOpenPositions(positions) {
  if (!positions?.long && !positions?.short) {
    return null;
  }
  return {
    long: positions.long || null,
    short: positions.short || null,
  };
}

function hasOpenPositions(openPosition) {
  const positions = normalizeOpenPositions(openPosition);
  return !!(positions.long || positions.short);
}

async function processCandleForAccount(account, candle, config, stateCache) {
  const { id: accountId, paper_config_id: configId, run_id: runId, balance, equity, max_equity, open_position } = account;
  
  const positions = normalizeOpenPositions(open_position);
  let newBalance = balance;
  let winsCount = account.wins_count;
  let lossesCount = account.losses_count;
  let tradesCount = account.trades_count;
  let closedAny = false;
  
  // Check for exits on open positions (long/short)
  for (const side of ['long', 'short']) {
    const position = positions[side];
    if (!position) {
      continue;
    }
    
    const exitResult = checkExitOnCandle(position, candle);
    if (exitResult && exitResult.exit) {
      const closeResult = closePosition({
        position,
        exitPrice: exitResult.exitPrice,
        slippageBps: config.slippage_bps || 2,
        takerFeeBps: config.taker_fee_bps || 5,
      });
      
      newBalance += closeResult.pnlAbs;
      tradesCount += 1;
      if (closeResult.result === 'win') {
        winsCount += 1;
      } else if (closeResult.result === 'loss') {
        lossesCount += 1;
      }
      
      const tradeId = position.trade_id;
      if (tradeId) {
        await updateTradeClose(tradeId, {
          closed_ts: candle.ts,
          exit: closeResult.exitPrice,
          pnl_pct: closeResult.pnlPct,
          pnl_abs: closeResult.pnlAbs,
          fees_abs: closeResult.feesAbs,
          result: closeResult.result,
          meta: {
            ...(position.meta || {}),
            exit_reason: exitResult.reason,
            exit_price: closeResult.exitPrice,
            result: closeResult.result,
          },
        });
      }
      
      positions[side] = null;
      closedAny = true;
      
      console.log(`[paperRunner] Trade closed: ${position.side} ${position.entry} -> ${closeResult.exitPrice} (${closeResult.pnlPct.toFixed(2)}%) [${exitResult.reason}]`);
      
      await logEvent({
        runId,
        paperConfigId: configId,
        level: 'info',
        message: `Trade closed: ${position.side} ${position.entry} -> ${closeResult.exitPrice} (${closeResult.pnlPct.toFixed(2)}%) [${exitResult.reason}]`,
        payload: { result: closeResult.result, pnlPct: closeResult.pnlPct, exit_reason: exitResult.reason },
      });
    }
  }
  
  let openPositionsToStore = serializeOpenPositions(positions);
  let markEquity = calculateMarkToMarketEquity({
    balance: newBalance,
    positions: [positions.long, positions.short].filter(Boolean),
    markPrice: candle.c,
  });
  let equityUpdate = updateEquityAndDD({ equity: markEquity, maxEquity: max_equity });
  let profitFactor = calculateProfitFactor(winsCount * 1.0, lossesCount * 1.0);
  
  const effectiveEquity = equityUpdate.equity;
  
  // Check for entry signal
  const signal = evaluateStrategy({ stateCache, candle, config });
  if (signal) {
    if (positions[signal.direction]) {
      await logEvent({
        runId,
        paperConfigId: configId,
        level: 'info',
        message: `Signal ignored: ${signal.direction} already open`,
        payload: { direction: signal.direction, reason: signal.reason || null },
      });
      
      // Fall through to checkpoint update below
    } else {
      // Open position
      const position = openPosition({
      side: signal.direction,
      entry: signal.entry_price,
      sl: signal.stop_loss,
      tp: signal.take_profit,
      riskPct: config.min_risk_pct || 0.001,
        equity: effectiveEquity,
      price: signal.entry_price,
      takerFeeBps: config.taker_fee_bps || 5,
      slippageBps: config.slippage_bps || 2,
      });
      position.meta = {
        entry_reason: signal.reason || null,
        trigger_type: signal.trigger_type || null,
      };
      
      // Deduct fees from balance
      const newBalanceAfterFees = newBalance - position.fees_paid;
      
      // Insert trade in DB
      const trade = await insertTradeOpen({
        run_id: runId,
        paper_config_id: configId,
        opened_ts: candle.ts,
        side: position.side,
        entry: position.entry,
        size: position.size,
        sl: position.sl,
        tp: position.tp,
        meta: {
          entry_reason: signal.reason || null,
          trigger_type: signal.trigger_type || null,
        },
      });
      
      // Store trade_id in position for later
      position.trade_id = trade.id;
      positions[position.side] = position;
      const updatedOpenPositions = serializeOpenPositions(positions);
      
      console.log(`[paperRunner] Trade opened: ${position.side} ${position.entry} (SL: ${position.sl}, TP: ${position.tp})`);
      
      await logEvent({
        runId,
        paperConfigId: configId,
        level: 'info',
        message: `Trade opened: ${position.side} ${position.entry} (SL: ${position.sl}, TP: ${position.tp})`,
        payload: { entry: position.entry, sl: position.sl, tp: position.tp, reason: signal.reason || null },
      });
      
      newBalance = newBalanceAfterFees;
      openPositionsToStore = updatedOpenPositions;
      markEquity = calculateMarkToMarketEquity({
        balance: newBalance,
        positions: [positions.long, positions.short].filter(Boolean),
        markPrice: candle.c,
      });
      equityUpdate = updateEquityAndDD({ equity: markEquity, maxEquity: max_equity });
    }
  }
  
  // Update checkpoint
  await upsertAccountCheckpoint({
    id: accountId,
    run_id: runId,
    paper_config_id: configId,
    balance: newBalance,
    equity: equityUpdate.equity,
    max_equity: equityUpdate.maxEquity,
    max_drawdown_pct: equityUpdate.maxDrawdownPct,
    open_position: openPositionsToStore,
    trades_count: tradesCount,
    wins_count: winsCount,
    losses_count: lossesCount,
    profit_factor: profitFactor,
    last_candle_ts: candle.ts,
  });
  
  return {
    ...account,
    balance: newBalance,
    equity: equityUpdate.equity,
    max_equity: equityUpdate.maxEquity,
    max_drawdown_pct: equityUpdate.maxDrawdownPct,
    open_position: openPositionsToStore,
    trades_count: tradesCount,
    wins_count: winsCount,
    losses_count: lossesCount,
    profit_factor: profitFactor,
  };
}

/**
 * Check kill rules for an account
 */
async function checkKillRules(account, config) {
  const { id: accountId, paper_config_id: configId, run_id: runId, trades_count, max_drawdown_pct, profit_factor, balance, balance_start } = account;
  
  if (trades_count < PAPER_MIN_TRADES_BEFORE_KILL) {
    return false; // Not enough trades yet
  }
  
  // Check max drawdown
  if (max_drawdown_pct > PAPER_KILL_MAX_DD_PCT) {
    await killConfig(configId, `Max drawdown exceeded: ${max_drawdown_pct.toFixed(2)}% > ${PAPER_KILL_MAX_DD_PCT}%`);
    await logEvent({
      runId,
      paperConfigId: configId,
      level: 'warn',
      message: `Config killed: Max drawdown ${max_drawdown_pct.toFixed(2)}%`,
    });
    await postDiscord(`🔴 Config killed: Max DD ${max_drawdown_pct.toFixed(2)}%`);
    return true;
  }
  
  // Check profit factor
  if (profit_factor !== null && profit_factor < PAPER_KILL_MIN_PF) {
    await killConfig(configId, `Profit factor too low: ${profit_factor.toFixed(2)} < ${PAPER_KILL_MIN_PF}`);
    await logEvent({
      runId,
      paperConfigId: configId,
      level: 'warn',
      message: `Config killed: Profit factor ${profit_factor.toFixed(2)}`,
    });
    await postDiscord(`🔴 Config killed: PF ${profit_factor.toFixed(2)}`);
    return true;
  }
  
  // Check P&L %
  const pnlPct = ((balance - balance_start) / balance_start) * 100;
  if (pnlPct < PAPER_KILL_MIN_PNL_PCT) {
    await killConfig(configId, `P&L too low: ${pnlPct.toFixed(2)}% < ${PAPER_KILL_MIN_PNL_PCT}%`);
    await logEvent({
      runId,
      paperConfigId: configId,
      level: 'warn',
      message: `Config killed: P&L ${pnlPct.toFixed(2)}%`,
    });
    await postDiscord(`🔴 Config killed: P&L ${pnlPct.toFixed(2)}%`);
    return true;
  }
  
  return false;
}

/**
 * Validate PAPER_OPTIMIZER_RUN_ID
 */
function validateOptimizerRunId(optimizerRunId) {
  const masked = optimizerRunId ? `${optimizerRunId.substring(0, 8)}...` : '<empty>';
  
  // Check if undefined/empty
  if (!optimizerRunId || optimizerRunId.trim() === '') {
    console.error(`[paperRunner] PAPER_OPTIMIZER_RUN_ID is required (set it to an optimizer_runs.id UUID). Current value: ${masked}`);
    throw new Error('[paperRunner] PAPER_OPTIMIZER_RUN_ID is required (set it to an optimizer_runs.id UUID)');
  }
  
  // Check if placeholder (contains <uuid> or angle brackets)
  const lowerValue = optimizerRunId.toLowerCase();
  if (lowerValue.includes('<uuid>') || lowerValue.includes('<') || lowerValue.includes('>')) {
    console.error(`[paperRunner] PAPER_OPTIMIZER_RUN_ID is still a placeholder. Set a real UUID from optimizer_runs.id. Current value: ${masked}`);
    throw new Error('[paperRunner] PAPER_OPTIMIZER_RUN_ID is still a placeholder. Set a real UUID from optimizer_runs.id');
  }
  
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(optimizerRunId.trim())) {
    console.error(`[paperRunner] PAPER_OPTIMIZER_RUN_ID is not a valid UUID: ${optimizerRunId}. Current value: ${masked}`);
    throw new Error(`[paperRunner] PAPER_OPTIMIZER_RUN_ID is not a valid UUID: ${optimizerRunId}`);
  }
}

/**
 * Initialize paper run and accounts (runs once at startup)
 */
async function initPaperRunAndAccounts() {
  // Guard: if neither PAPER_RUN_ID nor PAPER_OPTIMIZER_RUN_ID is set, throw error
  if (!PAPER_RUN_ID && !PAPER_OPTIMIZER_RUN_ID) {
    throw new Error('[paperRunner] Either PAPER_RUN_ID (to resume) or PAPER_OPTIMIZER_RUN_ID (to create new run) must be set');
  }
  
  // Log safe lag config
  const timeframeMs = PAPER_TIMEFRAME_MIN * 60_000;
  const lagMs = PAPER_SAFE_LAG_MIN * timeframeMs;
  console.log('[paperRunner] Safe lag config:', {
    PAPER_SAFE_LAG_MIN,
    timeframeMin: PAPER_TIMEFRAME_MIN,
    lagMs,
  });
  
  let paperRunId;
  
  // If PAPER_RUN_ID is provided, resume that run (ignore PAPER_OPTIMIZER_RUN_ID)
  if (PAPER_RUN_ID) {
    paperRunId = PAPER_RUN_ID;
    console.log(`[paperRunner] Resuming existing paper run: ${paperRunId} (PAPER_OPTIMIZER_RUN_ID ignored)`);
    
    // Verify run exists and get active accounts
    const accounts = await getActivePaperAccounts({ paperRunId });
    if (accounts.length === 0) {
      throw new Error(`No active accounts found for runId=${paperRunId}`);
    }
    
    console.log(`[paperRunner] Found ${accounts.length} active accounts for run ${paperRunId}`);
    return { paperRunId, symbol: SYMBOL };
  }
  
  // Otherwise, create new run (PAPER_OPTIMIZER_RUN_ID is required)
  validateOptimizerRunId(PAPER_OPTIMIZER_RUN_ID);
  
  console.log('[paperRunner] Creating new paper run:', {
    SYMBOL,
    PAPER_TIMEFRAME_MIN,
    PAPER_BALANCE_START,
    PAPER_TOP_N,
    PAPER_OPTIMIZER_RUN_ID: `${PAPER_OPTIMIZER_RUN_ID.substring(0, 8)}...`,
    PAPER_POLL_SECONDS,
  });
  
  const paperRun = await createPaperRun({
    symbol: SYMBOL,
    timeframeMin: PAPER_TIMEFRAME_MIN,
    note: `Paper trading run for optimizer ${PAPER_OPTIMIZER_RUN_ID}`,
  });
  paperRunId = paperRun.id;
  console.log(`[paperRunner] Created paper run: ${paperRunId}`);
  
  // Load configs from optimizer
  await upsertPaperConfigsFromOptimizerRun({
    paperRunId,
    optimizerRunId: PAPER_OPTIMIZER_RUN_ID,
    topN: PAPER_TOP_N,
  });
  
  // Seed accounts for all configs
  const seededCount = await seedPaperAccountsForRun({
    runId: paperRunId,
    balanceStart: PAPER_BALANCE_START,
  });
  
  // Get active accounts
  const accounts = await getActivePaperAccounts({ paperRunId });
  
  if (seededCount === 0 && accounts.length === 0) {
    throw new Error(`No accounts created for runId=${paperRunId}`);
  }
  
  console.log(`[paperRunner] Initialized: ${accounts.length} active accounts`);
  
  return { paperRunId, symbol: SYMBOL };
}

/**
 * Main poll loop
 */
async function pollLoop(ctx) {
  const { paperRunId } = ctx;
  let lastLeaderboardTime = 0;
  let lastHealthLogMs = 0;
  
  try {
    while (!shouldStop) {
      try {
        // Get active accounts
        const activeAccounts = await getActivePaperAccounts({ paperRunId });
        
        if (activeAccounts.length === 0) {
          console.log('[paperRunner] No active accounts, stopping');
          await updatePaperRun(paperRunId, { status: 'finished' });
          break;
        }
        
        // Compute maxTs and safeEndTs across required timeframes
        // maxTs always points to last CLOSED candle (ingest ensures this)
        const maxTsByTf = {};
        for (const tf of REQUIRED_TIMEFRAMES) {
          maxTsByTf[tf] = await getMaxCandleTs({ symbol: SYMBOL, timeframeMin: tf });
        }

        if (REQUIRED_TIMEFRAMES.some(tf => !maxTsByTf[tf])) {
          console.warn('[paperRunner] Missing candles for one or more timeframes, waiting...', {
            missing: REQUIRED_TIMEFRAMES.filter(tf => !maxTsByTf[tf]),
          });
          await sleep(PAPER_POLL_SECONDS * 1000);
          continue;
        }

        const maxTsMsByTf = {};
        let invalidMaxTs = false;
        for (const tf of REQUIRED_TIMEFRAMES) {
          const ms = roundDownToMinuteMs(toMs(maxTsByTf[tf]));
          if (ms === null) {
            console.error(`[paperRunner] Invalid maxTs for ${tf}m, skipping iteration`);
            invalidMaxTs = true;
            break;
          }
          maxTsMsByTf[tf] = ms;
        }
        if (invalidMaxTs) {
          await sleep(PAPER_POLL_SECONDS * 1000);
          continue;
        }

        const safeEndMsByTf = {};
        for (const tf of REQUIRED_TIMEFRAMES) {
          const tfMs = tf * 60_000;
          const safeLagMs = PAPER_SAFE_LAG_MIN * tfMs;
          safeEndMsByTf[tf] = maxTsMsByTf[tf] - safeLagMs;
        }

        const safeEndMs = Math.min(...Object.values(safeEndMsByTf));
        const safeEndTs = toIso(safeEndMs);
        const timeframeMs = PAPER_TIMEFRAME_MIN * 60_000;
        const safeLagMs = PAPER_SAFE_LAG_MIN * timeframeMs;

        // Health logging (lag per timeframe)
        const nowMs = Date.now();
        if (nowMs - lastHealthLogMs >= 60_000) {
          const lagByTf = {};
          for (const tf of REQUIRED_TIMEFRAMES) {
            lagByTf[`${tf}m`] = Math.round((nowMs - maxTsMsByTf[tf]) / 1000);
          }
          console.log('[paperRunner] Data lag (seconds):', lagByTf);
          lastHealthLogMs = nowMs;
        }
        
        // Cap last_candle_ts on load (resume safety)
        for (const account of activeAccounts) {
          if (!account.paper_configs || !account.paper_configs.is_active) {
            continue;
          }
          const storedLastMs = toMs(account.last_candle_ts);
          if (storedLastMs !== null && storedLastMs > safeEndMs) {
            const effectiveLastMs = safeEndMs - timeframeMs; // Cap to safeEndMs - 1 candle
            console.warn(`[paperRunner] Account ${account.id} has last_candle_ts (${account.last_candle_ts}) > safeEndMs (${safeEndTs}), capping to ${toIso(effectiveLastMs)}`);
            // Optionally write corrective checkpoint once on startup
            try {
              await upsertAccountCheckpoint({
                id: account.id,
                run_id: paperRunId,
                paper_config_id: account.paper_configs.id,
                balance: account.balance,
                equity: account.equity,
                max_equity: account.max_equity,
                max_drawdown_pct: account.max_drawdown_pct,
                open_position: account.open_position,
                trades_count: account.trades_count,
                wins_count: account.wins_count,
                losses_count: account.losses_count,
                profit_factor: account.profit_factor,
                last_candle_ts: toIso(effectiveLastMs),
              });
              account.last_candle_ts = toIso(effectiveLastMs);
            } catch (error) {
              console.error(`[paperRunner] Failed to cap checkpoint for account ${account.id}:`, error.message);
            }
          }
        }
        
        // Find min(last_candle_ts) across accounts for logging (in ms, after capping)
        const lastCandleTsList = activeAccounts
          .map(acc => toMs(acc.last_candle_ts))
          .filter(ms => ms !== null);
        const minLastCandleTsMs = lastCandleTsList.length > 0
          ? Math.min(...lastCandleTsList)
          : null;
        const minLastCandleTs = minLastCandleTsMs ? toIso(minLastCandleTsMs) : null;
        
        // Log loop start (debug with numeric ms + iso)
        console.log('[paperRunner] Loop start:', {
          maxTsByTf: Object.fromEntries(REQUIRED_TIMEFRAMES.map(tf => [tf, toIso(maxTsMsByTf[tf])])),
          maxTsMsByTf,
          safeEndTs,
          safeEndMs,
          safeLagMin: PAPER_SAFE_LAG_MIN,
          safeLagMs,
          minLastCandleTs,
          minLastCandleTsMs,
          activeAccounts: activeAccounts.length,
        });
        
        // Process each account independently
        let totalTradesOpened = 0;
        let totalTradesClosed = 0;
        
        for (const account of activeAccounts) {
          if (shouldStop) {
            break;
          }
          
          if (!account.paper_configs || !account.paper_configs.is_active) {
            continue;
          }
          
          const config = account.paper_configs.config;
          const accountId = account.id;
          
          // Get effective lastCandleMs (after potential capping)
          const storedLastCandleTs = account.last_candle_ts;
          const storedLastMs = toMs(storedLastCandleTs);
          const effectiveLastMs = storedLastMs !== null && storedLastMs > safeEndMs
            ? safeEndMs - timeframeMs // Already capped above, but ensure consistency
            : storedLastMs;
          
          // Compute startMs for this account (in milliseconds)
          const startMs = effectiveLastMs !== null
            ? effectiveLastMs + timeframeMs
            : safeEndMs - (24 * 60 * 60_000); // Default: 24h ago
          
          // If no last_candle_ts, log default start
          if (effectiveLastMs === null) {
            console.log(`[paperRunner] Account ${accountId} has no last_candle_ts, starting from ${toIso(startMs)}`);
          }
          
          // Skip if startMs >= safeEndMs (no new candles) - compare as numbers
          if (startMs >= safeEndMs) {
            console.log(`[paperRunner] No new candles for account ${accountId} (startMs >= safeEndMs):`, {
              accountId,
              storedLastCandleTs,
              effectiveLastMs: effectiveLastMs !== null ? toIso(effectiveLastMs) : null,
              startTs: toIso(startMs),
              startMs,
              safeEndTs,
              safeEndMs,
            });
            continue; // Do NOT update checkpoint - no candles processed
          }
          
          // Convert to ISO for DB queries
          const actualStartTs = toIso(startMs);
          
          // Log per-account processing start
          console.log(`[paperRunner] Processing account ${accountId}:`, {
            accountId,
            storedLastCandleTs,
            effectiveLastMs: effectiveLastMs !== null ? toIso(effectiveLastMs) : null,
            startTs: actualStartTs,
            startMs,
            safeEndTs,
            safeEndMs,
          });
          
          // Load candles with pagination to catch up fully
          const candles = await loadCandlesPaged({
            symbol: SYMBOL,
            timeframeMin: PAPER_TIMEFRAME_MIN,
            startTs: actualStartTs,
            endTs: safeEndTs,
            pageSize: 1000,
          });
          
          if (candles.length === 0) {
            console.log(`[paperRunner] No candles in range for account ${accountId}: ${actualStartTs} to ${safeEndTs}`);
            // Do NOT update checkpoint - no candles processed
            continue;
          }
          
          console.log(`[paperRunner] Loaded ${candles.length} candles for account ${accountId} (paginated)`);
          
          // Load candles for all timeframes (needed for state cache)
          const allCandles = await loadCandlesForTimeframes({
            symbol: SYMBOL,
            startTs: actualStartTs,
            endTs: safeEndTs,
          });
          
          // Process candles sequentially, tracking what was actually processed
          let lastProcessedMs = effectiveLastMs; // Start from effective last (or null)
          let candlesProcessed = 0; // Track how many candles were actually processed
          let accountTradesOpened = 0;
          let accountTradesClosed = 0;
          
          // Process candles in batches, updating checkpoint after each batch
          const BATCH_SIZE = 100;
          for (let i = 0; i < candles.length; i += BATCH_SIZE) {
            if (shouldStop) {
              break;
            }
            
            const batch = candles.slice(i, i + BATCH_SIZE);
            
            for (const candle of batch) {
              if (shouldStop) {
                break;
              }
              
              const candleObj = {
                t: new Date(candle.ts).getTime(),
                o: parseFloat(candle.open),
                h: parseFloat(candle.high),
                l: parseFloat(candle.low),
                c: parseFloat(candle.close),
                v: parseFloat(candle.volume || 0),
                ts: candle.ts,
              };
              
              // Cap candle timestamp to safeEndMs
              const candleMs = roundDownToMinuteMs(candleObj.t);
              if (candleMs > safeEndMs) {
                // Skip candles beyond safeEndMs
                continue;
              }
              
              // Update state cache at this candle
              const stateCache = buildStateCache({
                candles1m: allCandles.candles1m.filter(c => c.t <= candleObj.t),
                candles5m: allCandles.candles5m.filter(c => c.t <= candleObj.t),
                candles15m: allCandles.candles15m.filter(c => c.t <= candleObj.t),
                candles60m: allCandles.candles60m.filter(c => c.t <= candleObj.t),
                symbol: SYMBOL,
              });
              
              try {
                // Track if trade was opened/closed
                const hadOpenPosition = hasOpenPositions(account.open_position);
                
                // Process candle
                const updatedAccount = await processCandleForAccount(account, candleObj, config, stateCache);
                
                // Track trades
                if (!hadOpenPosition && hasOpenPositions(updatedAccount.open_position)) {
                  accountTradesOpened++;
                }
                if (hadOpenPosition && !hasOpenPositions(updatedAccount.open_position)) {
                  accountTradesClosed++;
                }
                
                // Update account reference
                Object.assign(account, updatedAccount);
                
                // Update lastProcessedMs only after successful processing (capped to safeEndMs)
                lastProcessedMs = Math.min(candleMs, safeEndMs);
                candlesProcessed++;
                
                // Check kill rules
                if (updatedAccount.trades_count >= PAPER_MIN_TRADES_BEFORE_KILL) {
                  const wasKilled = await checkKillRules(updatedAccount, account.paper_configs);
                  if (wasKilled) {
                    // Account was killed, stop processing for this account
                    break;
                  }
                }
                
                // Snapshot equity (every 10 candles to reduce DB load)
                if (candlesProcessed % 10 === 0) {
                  await upsertEquitySnapshot({
                    run_id: paperRunId,
                    paper_config_id: account.paper_configs.id,
                    ts: candle.ts,
                    equity: updatedAccount.equity,
                    balance: updatedAccount.balance,
                    dd_pct: updatedAccount.max_drawdown_pct,
                  });
                }
              } catch (error) {
                // If processing fails, don't advance lastProcessedMs (idempotency)
                console.error(`[paperRunner] Error processing candle ${candle.ts} for account ${accountId}:`, error.message);
                // Continue to next candle, but don't update lastProcessedMs
                continue;
              }
            }
            
            // Update checkpoint after each batch ONLY if candles were processed
            if (candlesProcessed > 0 && lastProcessedMs !== null && lastProcessedMs !== effectiveLastMs) {
              const lastProcessedTs = toIso(lastProcessedMs);
              try {
                await upsertAccountCheckpoint({
                  id: accountId,
                  run_id: paperRunId,
                  paper_config_id: account.paper_configs.id,
                  balance: account.balance,
                  equity: account.equity,
                  max_equity: account.max_equity,
                  max_drawdown_pct: account.max_drawdown_pct,
                  open_position: account.open_position,
                  trades_count: account.trades_count,
                  wins_count: account.wins_count,
                  losses_count: account.losses_count,
                  profit_factor: account.profit_factor,
                  last_candle_ts: lastProcessedTs,
                });
                
                // Update local reference
                account.last_candle_ts = lastProcessedTs;
              } catch (error) {
                console.error(`[paperRunner] Failed to update checkpoint for account ${accountId}:`, error.message);
                // Don't throw - we'll retry next iteration, but stop processing this batch
                break;
              }
            }
          }
          
          // Log per-account summary with explicit counts
          console.log(`[paperRunner] Account ${accountId} processed:`, {
            accountId,
            storedLastCandleTs,
            effectiveLastMs: effectiveLastMs !== null ? toIso(effectiveLastMs) : null,
            startTs: actualStartTs,
            safeEndTs,
            candlesLoaded: candles.length,
            candlesProcessed,
            lastProcessedTs: candlesProcessed > 0 ? toIso(lastProcessedMs) : null,
            lastProcessedMs: candlesProcessed > 0 ? lastProcessedMs : null,
            tradesOpened: accountTradesOpened,
            tradesClosed: accountTradesClosed,
          });
          
          totalTradesOpened += accountTradesOpened;
          totalTradesClosed += accountTradesClosed;
        }
        
        // Log iteration summary
        console.log('[paperRunner] Iteration complete:', {
          tradesOpened: totalTradesOpened,
          tradesClosed: totalTradesClosed,
        });
        
        // Leaderboard every minute
        const now = Date.now();
        if (now - lastLeaderboardTime > 60 * 1000) {
          const sortedAccounts = activeAccounts
            .filter(acc => acc.paper_configs && acc.paper_configs.is_active)
            .sort((a, b) => (b.equity || 0) - (a.equity || 0))
            .slice(0, 5);
          
          console.log('[paperRunner] Leaderboard (top 5):');
          sortedAccounts.forEach((acc, idx) => {
            console.log(`  ${idx + 1}. Config rank ${acc.paper_configs.rank}: equity=${acc.equity.toFixed(2)}, trades=${acc.trades_count}, DD=${acc.max_drawdown_pct.toFixed(2)}%`);
          });
          
          lastLeaderboardTime = now;
        }
        
        // Sleep before next poll
        await sleep(PAPER_POLL_SECONDS * 1000);
      } catch (error) {
        console.error('[paperRunner] Error in poll loop:', error);
        await logEvent({
          runId: paperRunId,
          level: 'error',
          message: `Error in poll loop: ${error.message}`,
          payload: { error: error.stack },
        });
        await sleep(PAPER_POLL_SECONDS * 1000);
      }
    }
    
    console.log('[paperRunner] Stopped gracefully');
  } catch (error) {
    console.error('[paperRunner] Fatal error in poll loop:', error);
    throw error;
  }
}

/**
 * Main entry point
 */
async function run() {
  let paperRunId = null;
  
  try {
    // Initialize once at startup
    const ctx = await initPaperRunAndAccounts();
    paperRunId = ctx.paperRunId;
    
    // Run poll loop
    await pollLoop(ctx);
    
    // Update run status on normal exit
    if (paperRunId) {
      await updatePaperRun(paperRunId, { status: shouldStop ? 'stopped' : 'finished' });
    }
  } catch (error) {
    console.error('[paperRunner] Fatal error:', error);
    if (paperRunId) {
      await updatePaperRun(paperRunId, { status: 'stopped' });
    }
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle SIGTERM gracefully
process.on('SIGTERM', async () => {
  console.log('[paperRunner] SIGTERM received, setting shouldStop flag...');
  shouldStop = true;
  // Don't exit immediately - let current batch finish
  // The poll loop will check shouldStop and exit gracefully
});

// Run if called directly
import { fileURLToPath } from 'url';
import { basename } from 'path';

const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('paperTradeRunner.mjs') ||
  basename(process.argv[1]) === basename(__filename)
);

if (isMainModule) {
  run().catch(error => {
    console.error('[paperRunner] Unhandled error:', error);
    process.exit(1);
  });
}

