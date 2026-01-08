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
import { normalizeISO } from '../utils/time.mjs';

// Configuration from env
const SYMBOL = process.env.SYMBOL || 'BTC-PERPETUAL';
const PAPER_TIMEFRAME_MIN = parseInt(process.env.PAPER_TIMEFRAME_MIN || '1', 10);
const PAPER_BALANCE_START = parseFloat(process.env.PAPER_BALANCE_START || '1000', 10);
const PAPER_TOP_N = parseInt(process.env.PAPER_TOP_N || '10', 10);
const PAPER_OPTIMIZER_RUN_ID = process.env.PAPER_OPTIMIZER_RUN_ID;
const PAPER_POLL_SECONDS = parseInt(process.env.PAPER_POLL_SECONDS || '15', 10);
const PAPER_MIN_TRADES_BEFORE_KILL = parseInt(process.env.PAPER_MIN_TRADES_BEFORE_KILL || '50', 10);
const PAPER_KILL_MAX_DD_PCT = parseFloat(process.env.PAPER_KILL_MAX_DD_PCT || '12', 10);
const PAPER_KILL_MIN_PF = parseFloat(process.env.PAPER_KILL_MIN_PF || '0.8', 10);
const PAPER_KILL_MIN_PNL_PCT = parseFloat(process.env.PAPER_KILL_MIN_PNL_PCT || '-2', 10);
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

let paperRunId = null;
let running = true;

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
 * Get next candle timestamp per account
 */
function getNextCandleTs(accounts) {
  if (accounts.length === 0) {
    return null;
  }
  
  const timestamps = accounts
    .map(acc => acc.last_candle_ts ? new Date(acc.last_candle_ts).getTime() : 0)
    .filter(ts => ts > 0);
  
  if (timestamps.length === 0) {
    // No checkpoints, start from 1 day ago
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }
  
  const minTs = Math.min(...timestamps);
  // Next candle is minTs + 1 minute
  return new Date(minTs + 60 * 1000).toISOString();
}

/**
 * Process a candle for an account
 */
async function processCandleForAccount(account, candle, config, stateCache) {
  const { id: accountId, paper_config_id: configId, run_id: runId, balance, equity, max_equity, open_position } = account;
  
  // Check for exit on open position
  if (open_position) {
    const exitResult = checkExitOnCandle(open_position, candle);
    if (exitResult && exitResult.exit) {
      // Close position
      const closeResult = closePosition({
        position: open_position,
        exitPrice: exitResult.exitPrice,
        slippageBps: config.slippage_bps || 2,
        takerFeeBps: config.taker_fee_bps || 5,
      });
      
      // Update balance
      const newBalance = balance + closeResult.pnlAbs;
      
      // Update equity and DD
      const equityUpdate = updateEquityAndDD({ equity: newBalance, maxEquity: max_equity });
      
      // Update trade in DB
      const tradeId = open_position.trade_id; // Store trade_id in position
      if (tradeId) {
        await updateTradeClose(tradeId, {
          closed_ts: candle.ts,
          exit: closeResult.exitPrice,
          pnl_pct: closeResult.pnlPct,
          pnl_abs: closeResult.pnlAbs,
          fees_abs: closeResult.feesAbs,
          result: closeResult.result,
        });
      }
      
      // Update account
      const winsCount = closeResult.result === 'win' ? account.wins_count + 1 : account.wins_count;
      const lossesCount = closeResult.result === 'loss' ? account.losses_count + 1 : account.losses_count;
      
      // Calculate profit factor
      // TODO: Load all trades to calculate properly, for now use simple approximation
      const profitFactor = calculateProfitFactor(
        winsCount * 1.0, // Simplified
        lossesCount * 1.0
      );
      
      await upsertAccountCheckpoint({
        id: accountId,
        run_id: runId,
        paper_config_id: configId,
        balance: newBalance,
        equity: equityUpdate.equity,
        max_equity: equityUpdate.maxEquity,
        max_drawdown_pct: equityUpdate.maxDrawdownPct,
        open_position: null,
        trades_count: account.trades_count + 1,
        wins_count: winsCount,
        losses_count: lossesCount,
        profit_factor: profitFactor,
        last_candle_ts: candle.ts,
      });
      
      console.log(`[paperRunner] Trade closed: ${open_position.side} ${open_position.entry} -> ${closeResult.exitPrice} (${closeResult.pnlPct.toFixed(2)}%)`);
      
      await logEvent({
        runId,
        paperConfigId: configId,
        level: 'info',
        message: `Trade closed: ${open_position.side} ${open_position.entry} -> ${closeResult.exitPrice} (${closeResult.pnlPct.toFixed(2)}%)`,
        payload: { result: closeResult.result, pnlPct: closeResult.pnlPct },
      });
      
      // Return updated account
      return {
        ...account,
        balance: newBalance,
        equity: equityUpdate.equity,
        max_equity: equityUpdate.maxEquity,
        max_drawdown_pct: equityUpdate.maxDrawdownPct,
        open_position: null,
        trades_count: account.trades_count + 1,
        wins_count: winsCount,
        losses_count: lossesCount,
        profit_factor: profitFactor,
      };
    } else {
      // Update mark-to-market equity
      const markEquity = calculateMarkToMarketEquity({
        balance,
        position: open_position,
        markPrice: candle.c,
      });
      
      const equityUpdate = updateEquityAndDD({ equity: markEquity, maxEquity: max_equity });
      
      await upsertAccountCheckpoint({
        id: accountId,
        run_id: runId,
        paper_config_id: configId,
        balance,
        equity: equityUpdate.equity,
        max_equity: equityUpdate.maxEquity,
        max_drawdown_pct: equityUpdate.maxDrawdownPct,
        open_position,
        last_candle_ts: candle.ts,
      });
      
      return {
        ...account,
        equity: equityUpdate.equity,
        max_equity: equityUpdate.maxEquity,
        max_drawdown_pct: equityUpdate.maxDrawdownPct,
      };
    }
  }
  
  // Check for entry signal
  const signal = evaluateStrategy({ stateCache, candle, config });
  if (signal) {
    // Open position
    const position = openPosition({
      side: signal.direction,
      entry: signal.entry_price,
      sl: signal.stop_loss,
      tp: signal.take_profit,
      riskPct: config.min_risk_pct || 0.001,
      equity,
      price: signal.entry_price,
      takerFeeBps: config.taker_fee_bps || 5,
      slippageBps: config.slippage_bps || 2,
    });
    
    // Deduct fees from balance
    const newBalance = balance - position.fees_paid;
    
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
    });
    
    // Store trade_id in position for later
    position.trade_id = trade.id;
    
    // Update account
    await upsertAccountCheckpoint({
      id: accountId,
      run_id: runId,
      paper_config_id: configId,
      balance: newBalance,
      equity: newBalance, // Equity = balance when position just opened
      open_position: position,
      last_candle_ts: candle.ts,
    });
    
    console.log(`[paperRunner] Trade opened: ${position.side} ${position.entry} (SL: ${position.sl}, TP: ${position.tp})`);
    
    await logEvent({
      runId,
      paperConfigId: configId,
      level: 'info',
      message: `Trade opened: ${position.side} ${position.entry} (SL: ${position.sl}, TP: ${position.tp})`,
      payload: { entry: position.entry, sl: position.sl, tp: position.tp },
    });
    
    return {
      ...account,
      balance: newBalance,
      equity: newBalance,
      open_position: position,
    };
  }
  
  // No signal, just update checkpoint
  await upsertAccountCheckpoint({
    id: accountId,
    run_id: runId,
    paper_config_id: configId,
    balance,
    equity,
    max_equity,
    max_drawdown_pct: account.max_drawdown_pct,
    open_position,
    last_candle_ts: candle.ts,
  });
  
  return account;
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
 * Main runner loop
 */
async function run() {
  // Validate PAPER_OPTIMIZER_RUN_ID before any database calls
  validateOptimizerRunId(PAPER_OPTIMIZER_RUN_ID);
  
  console.log('[paperRunner] Starting paper trade runner:', {
    SYMBOL,
    PAPER_TIMEFRAME_MIN,
    PAPER_BALANCE_START,
    PAPER_TOP_N,
    PAPER_OPTIMIZER_RUN_ID: `${PAPER_OPTIMIZER_RUN_ID.substring(0, 8)}...`,
    PAPER_POLL_SECONDS,
  });
  
  try {
    // 1. Create paper run
    const paperRun = await createPaperRun({
      symbol: SYMBOL,
      timeframeMin: PAPER_TIMEFRAME_MIN,
      note: `Paper trading run for optimizer ${PAPER_OPTIMIZER_RUN_ID}`,
    });
    paperRunId = paperRun.id;
    console.log(`[paperRunner] Created paper run: ${paperRunId}`);
    
    // 2. Load configs from optimizer
    await upsertPaperConfigsFromOptimizerRun({
      paperRunId,
      optimizerRunId: PAPER_OPTIMIZER_RUN_ID,
      topN: PAPER_TOP_N,
    });
    
    // 3. Seed accounts for all configs
    const seededCount = await seedPaperAccountsForRun({
      runId: paperRunId,
      balanceStart: PAPER_BALANCE_START,
    });
    
    // 4. Get active accounts
    const accounts = await getActivePaperAccounts({ paperRunId });
    
    if (seededCount === 0 && accounts.length === 0) {
      console.warn(`[paperRunner] Warning: No accounts created for runId=${paperRunId}. Stopping.`);
      await updatePaperRun(paperRunId, { status: 'stopped', note: 'No accounts created' });
      return;
    }
    
    // 5. Main loop
    let lastLeaderboardTime = 0;
    
    while (running) {
      try {
        // Get active accounts
        const activeAccounts = await getActivePaperAccounts({ paperRunId });
        
        if (activeAccounts.length === 0) {
          console.log('[paperRunner] No active accounts, stopping');
          await updatePaperRun(paperRunId, { status: 'finished' });
          break;
        }
        
        // Determine next candle timestamp
        const nextCandleTs = getNextCandleTs(activeAccounts);
        if (!nextCandleTs) {
          console.log('[paperRunner] No next candle timestamp, waiting...');
          await sleep(PAPER_POLL_SECONDS * 1000);
          continue;
        }
        
        // Get max available candle timestamp
        const maxCandleTs = await getMaxCandleTs({ symbol: SYMBOL, timeframeMin: 1 });
        if (!maxCandleTs || new Date(maxCandleTs).getTime() < new Date(nextCandleTs).getTime()) {
          // No new candles yet
          console.log(`[paperRunner] Waiting for new candles (next: ${nextCandleTs}, max: ${maxCandleTs})`);
          await sleep(PAPER_POLL_SECONDS * 1000);
          continue;
        }
        
        // Fetch candles from nextCandleTs to maxCandleTs (limit to reasonable batch)
        const endTs = new Date(Math.min(
          new Date(nextCandleTs).getTime() + 60 * 60 * 1000, // Max 1 hour ahead
          new Date(maxCandleTs).getTime()
        )).toISOString();
        
        const candles = await getCandlesBetween({
          symbol: SYMBOL,
          timeframeMin: 1,
          startTs: nextCandleTs,
          endTs,
          limit: 1000,
        });
        
        if (candles.length === 0) {
          console.log(`[paperRunner] No candles in range ${nextCandleTs} to ${endTs}`);
          await sleep(PAPER_POLL_SECONDS * 1000);
          continue;
        }
        
        // Load candles for all timeframes
        const allCandles = await loadCandlesForTimeframes({
          symbol: SYMBOL,
          startTs: nextCandleTs,
          endTs,
        });
        
        // Process each candle chronologically
        for (const candle of candles) {
          const candleObj = {
            t: new Date(candle.ts).getTime(),
            o: parseFloat(candle.open),
            h: parseFloat(candle.high),
            l: parseFloat(candle.low),
            c: parseFloat(candle.close),
            v: parseFloat(candle.volume || 0),
            ts: candle.ts,
          };
          
          // Update state cache at this candle
          const stateCache = buildStateCache({
            candles1m: allCandles.candles1m.filter(c => c.t <= candleObj.t),
            candles5m: allCandles.candles5m.filter(c => c.t <= candleObj.t),
            candles15m: allCandles.candles15m.filter(c => c.t <= candleObj.t),
            candles60m: allCandles.candles60m.filter(c => c.t <= candleObj.t),
            symbol: SYMBOL,
          });
          
          // Process for each active account
          for (const account of activeAccounts) {
            if (!account.paper_configs || !account.paper_configs.is_active) {
              continue;
            }
            
            const config = account.paper_configs.config;
            
            // Process candle
            const updatedAccount = await processCandleForAccount(account, candleObj, config, stateCache);
            
            // Update account reference
            Object.assign(account, updatedAccount);
            
            // Check kill rules
            if (updatedAccount.trades_count >= PAPER_MIN_TRADES_BEFORE_KILL) {
              await checkKillRules(updatedAccount, account.paper_configs);
            }
            
            // Snapshot equity (every 5 candles)
            if (candles.indexOf(candle) % 5 === 0) {
              await upsertEquitySnapshot({
                run_id: paperRunId,
                paper_config_id: account.paper_configs.id,
                ts: candle.ts,
                equity: updatedAccount.equity,
                balance: updatedAccount.balance,
                dd_pct: updatedAccount.max_drawdown_pct,
              });
            }
          }
        }
        
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
        console.error('[paperRunner] Error in main loop:', error);
        await logEvent({
          runId: paperRunId,
          level: 'error',
          message: `Error in main loop: ${error.message}`,
          payload: { error: error.stack },
        });
        await sleep(PAPER_POLL_SECONDS * 1000);
      }
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

// Handle SIGTERM
process.on('SIGTERM', async () => {
  console.log('[paperRunner] SIGTERM received, stopping...');
  running = false;
  if (paperRunId) {
    await updatePaperRun(paperRunId, { status: 'stopped' });
  }
  process.exit(0);
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

