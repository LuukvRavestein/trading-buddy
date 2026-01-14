import { supabase } from './supabaseClient'

// Types
export interface RunOverview {
  run_id: string
  symbol: string
  timeframe_min: number
  started_at: string
  status: string
  note: string | null
  strategies: number
  trades_total: number
  pnl_total: number
  winrate_total: number
  best_strategy_rank: number | null
  worst_strategy_rank: number | null
  accounts_with_open_position: number
  max_drawdown_pct_worst: number
  equity_sum: number
}

export interface StrategyPerformance {
  run_id: string
  paper_config_id: string
  config_rank: number
  symbol: string
  timeframe_min: number
  trades: number
  wins: number
  losses: number
  winrate: number
  pnl_total: number
  pnl_avg: number
  pnl_median: number
  profit_factor: number
  max_drawdown_pct: number
  equity_current: number
  balance_start: number
  balance_current: number
  max_equity: number
  has_open_position: boolean
  last_candle_ts: string | null
  created_at: string
  account_id: string
  is_active: boolean
  kill_reason: string | null
}

export interface PaperJournal {
  trade_id: string
  run_id: string
  account_id: string
  paper_config_id: string
  config_rank: number
  symbol: string
  timeframe_min: number
  side: 'long' | 'short'
  qty: number
  entry_px: number
  exit_px: number | null
  entry_ts: string
  exit_ts: string | null
  pnl: number | null
  pnl_pct: number | null
  fees: number | null
  duration_seconds: number | null
  outcome: 'win' | 'loss' | 'breakeven' | null
  sl: number | null
  tp: number | null
  meta: any
  created_at: string
}

export interface DailyPnL {
  day: string
  run_id: string
  symbol: string
  timeframe_min: number
  pnl_total: number
  trades: number
  wins: number
  losses: number
  winrate: number
}

export interface WeeklyPnL {
  week_start: string
  run_id: string
  symbol: string
  timeframe_min: number
  pnl_total: number
  trades: number
  wins: number
  losses: number
  winrate: number
}

export interface TradeReasonStat {
  run_id: string
  paper_config_id: string
  config_rank: number
  symbol: string
  timeframe_min: number
  side: 'long' | 'short'
  entry_reason: string
  trigger_type: string
  exit_reason: string
  trades: number
  wins: number
  losses: number
  breakevens: number
  winrate: number
  pnl_total: number
  pnl_avg: number
  first_closed_ts: string | null
  last_closed_ts: string | null
}

// Queries
export async function getRunOverviews(): Promise<RunOverview[]> {
  const { data, error } = await supabase
    .from('v_run_overview')
    .select('*')
    .order('started_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getRunOverview(runId: string): Promise<RunOverview | null> {
  const { data, error } = await supabase
    .from('v_run_overview')
    .select('*')
    .eq('run_id', runId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    throw error
  }
  return data
}

export async function getStrategyPerformance(runId: string): Promise<StrategyPerformance[]> {
  const { data, error } = await supabase
    .from('v_strategy_performance')
    .select('*')
    .eq('run_id', runId)
    .order('config_rank', { ascending: true })

  if (error) throw error
  return data || []
}

export async function getPaperJournal(params: {
  runId?: string
  configRank?: number
  limit?: number
  offset?: number
  startDate?: string
  endDate?: string
}): Promise<{ data: PaperJournal[]; total: number }> {
  let query = supabase
    .from('v_paper_journal')
    .select('*', { count: 'exact' })

  if (params.runId) {
    query = query.eq('run_id', params.runId)
  }

  if (params.configRank !== undefined) {
    query = query.eq('config_rank', params.configRank)
  }

  // Date filtering: use exit_ts if available, otherwise fallback to entry_ts
  // For startDate: we want trades where exit_ts >= startDate OR (exit_ts is null AND entry_ts >= startDate)
  // For endDate: we want trades where exit_ts <= endDate OR (exit_ts is null AND entry_ts <= endDate)
  // Note: Supabase PostgREST doesn't support complex OR with AND easily, so we filter in a simpler way
  if (params.startDate) {
    // Filter by entry_ts for open trades, exit_ts for closed trades
    query = query.or(`exit_ts.gte.${params.startDate},entry_ts.gte.${params.startDate}`)
  }

  if (params.endDate) {
    // Filter by entry_ts for open trades, exit_ts for closed trades
    query = query.or(`exit_ts.lte.${params.endDate},entry_ts.lte.${params.endDate}`)
  }

  query = query
    .order('exit_ts', { ascending: false, nullsFirst: false })
    .order('entry_ts', { ascending: false })

  if (params.limit) {
    query = query.limit(params.limit)
  }

  if (params.offset) {
    query = query.range(params.offset, params.offset + (params.limit || 50) - 1)
  }

  const { data, error, count } = await query

  if (error) throw error
  return { data: data || [], total: count || 0 }
}

export async function getDailyPnL(runId: string): Promise<DailyPnL[]> {
  const { data, error } = await supabase
    .from('v_daily_pnl')
    .select('*')
    .eq('run_id', runId)
    .order('day', { ascending: true })

  if (error) throw error
  return data || []
}

export async function getWeeklyPnL(runId: string): Promise<WeeklyPnL[]> {
  const { data, error } = await supabase
    .from('v_weekly_pnl')
    .select('*')
    .eq('run_id', runId)
    .order('week_start', { ascending: true })

  if (error) throw error
  return data || []
}

export async function getTradeReasonStats(runId: string, minTrades = 5): Promise<TradeReasonStat[]> {
  const { data, error } = await supabase
    .from('v_trade_reason_stats')
    .select('*')
    .eq('run_id', runId)
    .gte('trades', minTrades)
    .order('pnl_total', { ascending: false })

  if (error) throw error
  return data || []
}
