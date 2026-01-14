/**
 * Learning Report Job
 *
 * Generates a summary of win/loss reasons and (optionally) applies small
 * auto-tuning adjustments to strategy configs based on performance.
 *
 * Usage:
 *   node src/jobs/learningReport.mjs
 *
 * Environment variables:
 *   REPORT_RUN_ID - Optional run id; defaults to latest run
 *   REPORT_LOOKBACK_DAYS - Days of closed trades to include (default: 7)
 *   REPORT_MIN_TRADES - Minimum trades per reason to include (default: 10)
 *   REPORT_TOP_N - Top reasons to include in report (default: 5)
 *   REPORT_WEEKS - Number of weekly buckets (default: 4)
 *
 * Auto-tune (optional):
 *   REPORT_ENABLE_AUTO_TUNE - true|false (default: false)
 *   REPORT_AUTOTUNE_MIN_TRADES - Min trades per config (default: 30)
 *   REPORT_TARGET_WINRATE - Target winrate % (default: 55)
 *   REPORT_RR_STEP - RR step adjustment (default: 0.25)
 *   REPORT_RR_MIN - Minimum rr_target (default: 1.5)
 *   REPORT_RR_MAX - Maximum rr_target (default: 4.0)
 */

import { getSupabaseClient } from '../db/supabaseClient.js'
import { logEvent, updatePaperConfig } from '../db/paperTradingRepo.mjs'

const REPORT_RUN_ID = process.env.REPORT_RUN_ID || null
const REPORT_LOOKBACK_DAYS = parseInt(process.env.REPORT_LOOKBACK_DAYS || '7', 10)
const REPORT_MIN_TRADES = parseInt(process.env.REPORT_MIN_TRADES || '10', 10)
const REPORT_TOP_N = parseInt(process.env.REPORT_TOP_N || '5', 10)
const REPORT_WEEKS = parseInt(process.env.REPORT_WEEKS || '4', 10)

const REPORT_ENABLE_AUTO_TUNE = ['true', '1', 'yes'].includes((process.env.REPORT_ENABLE_AUTO_TUNE || '').toLowerCase())
const REPORT_AUTOTUNE_MIN_TRADES = parseInt(process.env.REPORT_AUTOTUNE_MIN_TRADES || '30', 10)
const REPORT_TARGET_WINRATE = parseFloat(process.env.REPORT_TARGET_WINRATE || '55')
const REPORT_RR_STEP = parseFloat(process.env.REPORT_RR_STEP || '0.25')
const REPORT_RR_MIN = parseFloat(process.env.REPORT_RR_MIN || '1.5')
const REPORT_RR_MAX = parseFloat(process.env.REPORT_RR_MAX || '4.0')

function daysAgoIso(days) {
  const ms = Date.now() - (days * 24 * 60 * 60 * 1000)
  return new Date(ms).toISOString()
}

async function fetchLatestRunId(client) {
  const url = `${client.url}/rest/v1/paper_runs?select=id,started_at&order=started_at.desc&limit=1`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': client.key,
      'Authorization': `Bearer ${client.key}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch latest run: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return data?.[0]?.id || null
}

async function fetchReasonStats(client, runId, minTrades, sinceIso) {
  const url = `${client.url}/rest/v1/v_trade_reason_stats?run_id=eq.${runId}&trades=gte.${minTrades}&last_closed_ts=gte.${sinceIso}&order=pnl_total.desc`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': client.key,
      'Authorization': `Bearer ${client.key}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch reason stats: ${response.status} ${errorText}`)
  }

  return response.json()
}

async function fetchWeeklyPnL(client, runId, weeks) {
  const url = `${client.url}/rest/v1/v_weekly_pnl?run_id=eq.${runId}&order=week_start.desc&limit=${weeks}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': client.key,
      'Authorization': `Bearer ${client.key}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch weekly pnl: ${response.status} ${errorText}`)
  }

  return response.json()
}

async function fetchStrategyPerformance(client, runId, minTrades) {
  const url = `${client.url}/rest/v1/v_strategy_performance?run_id=eq.${runId}&trades=gte.${minTrades}&select=paper_config_id,trades,winrate,pnl_total`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': client.key,
      'Authorization': `Bearer ${client.key}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch strategy performance: ${response.status} ${errorText}`)
  }

  return response.json()
}

async function fetchPaperConfigs(client, runId) {
  const url = `${client.url}/rest/v1/paper_configs?run_id=eq.${runId}&select=id,config,rank`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': client.key,
      'Authorization': `Bearer ${client.key}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch paper configs: ${response.status} ${errorText}`)
  }

  return response.json()
}

function buildSummary(reasonStats) {
  const winners = [...reasonStats].sort((a, b) => b.pnl_total - a.pnl_total).slice(0, REPORT_TOP_N)
  const losers = [...reasonStats].sort((a, b) => a.pnl_total - b.pnl_total).slice(0, REPORT_TOP_N)

  return {
    winners,
    losers,
    totalReasons: reasonStats.length,
  }
}

async function autoTuneIfEnabled(client, runId) {
  if (!REPORT_ENABLE_AUTO_TUNE) {
    return { tuned: 0, changes: [] }
  }

  const [perfRows, configs] = await Promise.all([
    fetchStrategyPerformance(client, runId, REPORT_AUTOTUNE_MIN_TRADES),
    fetchPaperConfigs(client, runId),
  ])

  const configMap = new Map(configs.map(cfg => [cfg.id, cfg]))
  const changes = []

  for (const perf of perfRows) {
    const cfg = configMap.get(perf.paper_config_id)
    if (!cfg || !cfg.config) {
      continue
    }

    const currentRr = typeof cfg.config.rr_target === 'number' ? cfg.config.rr_target : 2.0
    let nextRr = currentRr

    if (perf.winrate < (REPORT_TARGET_WINRATE - 10) && perf.pnl_total < 0) {
      nextRr = Math.max(REPORT_RR_MIN, currentRr - REPORT_RR_STEP)
    } else if (perf.winrate > (REPORT_TARGET_WINRATE + 10) && perf.pnl_total > 0) {
      nextRr = Math.min(REPORT_RR_MAX, currentRr + REPORT_RR_STEP)
    }

    if (nextRr !== currentRr) {
      const newConfig = { ...cfg.config, rr_target: nextRr }
      await updatePaperConfig(cfg.id, { config: newConfig })
      changes.push({
        paper_config_id: cfg.id,
        rank: cfg.rank ?? null,
        rr_from: currentRr,
        rr_to: nextRr,
        winrate: perf.winrate,
        pnl_total: perf.pnl_total,
      })
    }
  }

  return { tuned: changes.length, changes }
}

async function main() {
  const client = getSupabaseClient()
  if (!client) {
    throw new Error('[learningReport] Supabase not configured')
  }

  const runId = REPORT_RUN_ID || await fetchLatestRunId(client)
  if (!runId) {
    throw new Error('[learningReport] No paper run found')
  }

  const sinceIso = daysAgoIso(REPORT_LOOKBACK_DAYS)
  const reasonStats = await fetchReasonStats(client, runId, REPORT_MIN_TRADES, sinceIso)
  let weeklySummary = []
  try {
    weeklySummary = await fetchWeeklyPnL(client, runId, REPORT_WEEKS)
  } catch (error) {
    console.warn('[learningReport] Weekly summary unavailable (view not run yet):', error.message)
  }
  const summary = buildSummary(reasonStats)
  const autoTuneResult = await autoTuneIfEnabled(client, runId)

  await logEvent({
    runId,
    level: 'info',
    message: 'Learning report generated',
    payload: {
      lookback_days: REPORT_LOOKBACK_DAYS,
      min_trades: REPORT_MIN_TRADES,
      top_n: REPORT_TOP_N,
      summary,
      weekly_summary: weeklySummary,
      auto_tune: {
        enabled: REPORT_ENABLE_AUTO_TUNE,
        tuned: autoTuneResult.tuned,
        changes: autoTuneResult.changes,
      },
    },
  })

  console.log('[learningReport] ✅ Report generated', {
    runId,
    reasons: summary.totalReasons,
    tuned: autoTuneResult.tuned,
  })
}

main().catch(error => {
  console.error('[learningReport] ❌ Error:', error.message)
  console.error(error.stack)
  process.exit(1)
})
