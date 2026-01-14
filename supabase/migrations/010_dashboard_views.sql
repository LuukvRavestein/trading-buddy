-- Dashboard Views for Trading Dashboard and Trading Journal
-- 
-- This migration creates SQL views for:
-- - v_paper_journal: Detailed trade journal (one row per trade)
-- - v_strategy_performance: Performance metrics per strategy
-- - v_run_overview: High-level overview per paper run
-- - v_daily_pnl: Daily PnL aggregation
-- - v_trade_reason_stats: Aggregated win/loss reasons from paper trades
-- - v_weekly_pnl: Weekly PnL aggregation
-- - v_run_overview_all: Aggregated overview across all runs
-- - v_daily_pnl_all: Daily PnL aggregation across all runs
-- - v_weekly_pnl_all: Weekly PnL aggregation across all runs
-- - v_trade_reason_stats_all: Aggregated trade reasons across all runs
--
-- Run this in Supabase SQL Editor:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Click "New query"
-- 3. Paste this entire file
-- 4. Click "Run" (or Ctrl+Enter)

-- ============================================================================
-- A) V_PAPER_JOURNAL
-- ============================================================================
-- One row per trade with all relevant details for the trading journal
CREATE OR REPLACE VIEW public.v_paper_journal AS
SELECT 
  t.id AS trade_id,
  t.run_id,
  a.id AS account_id,
  t.paper_config_id,
  COALESCE(c.rank, -1) AS config_rank,
  r.symbol,
  r.timeframe_min,
  t.side,
  t.size AS qty,
  t.entry AS entry_px,
  t.exit AS exit_px,
  t.opened_ts AS entry_ts,
  t.closed_ts AS exit_ts,
  t.pnl_abs AS pnl,
  t.pnl_pct,
  t.fees_abs AS fees,
  CASE 
    WHEN t.closed_ts IS NOT NULL AND t.opened_ts IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (t.closed_ts - t.opened_ts))::INTEGER
    ELSE NULL
  END AS duration_seconds,
  t.result AS outcome,
  t.sl,
  t.tp,
  t.meta,
  t.created_at
FROM public.paper_trades t
INNER JOIN public.paper_accounts a ON t.paper_config_id = a.paper_config_id AND t.run_id = a.run_id
INNER JOIN public.paper_configs c ON t.paper_config_id = c.id
INNER JOIN public.paper_runs r ON t.run_id = r.id;
-- Note: Sort by COALESCE(exit_ts, entry_ts) DESC in your queries for chronological order

-- ============================================================================
-- B) V_STRATEGY_PERFORMANCE
-- ============================================================================
-- One row per (run_id, paper_config_id) with aggregated performance metrics
CREATE OR REPLACE VIEW public.v_strategy_performance AS
WITH trade_stats AS (
  SELECT 
    run_id,
    paper_config_id,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE result = 'win') AS wins,
    COUNT(*) FILTER (WHERE result = 'loss') AS losses,
    SUM(pnl_abs) AS pnl_total,
    AVG(pnl_abs) AS pnl_avg,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pnl_abs) AS pnl_median
  FROM public.paper_trades
  WHERE closed_ts IS NOT NULL  -- Only closed trades
  GROUP BY run_id, paper_config_id
)
SELECT 
  a.run_id,
  a.paper_config_id,
  COALESCE(c.rank, -1) AS config_rank,
  r.symbol,
  r.timeframe_min,
  COALESCE(ts.trades, 0) AS trades,
  COALESCE(ts.wins, 0) AS wins,
  COALESCE(ts.losses, 0) AS losses,
  CASE 
    WHEN COALESCE(ts.trades, 0) > 0 
    THEN ROUND((COALESCE(ts.wins, 0)::NUMERIC / ts.trades::NUMERIC) * 100, 2)
    ELSE 0
  END AS winrate,
  COALESCE(ts.pnl_total, 0) AS pnl_total,
  COALESCE(ts.pnl_avg, 0) AS pnl_avg,
  COALESCE(ts.pnl_median, 0) AS pnl_median,
  COALESCE(a.profit_factor, 1) AS profit_factor,
  a.max_drawdown_pct,
  a.equity AS equity_current,
  a.balance_start,
  a.balance AS balance_current,
  a.max_equity,
  (a.open_position IS NOT NULL) AS has_open_position,
  a.last_candle_ts,
  a.created_at,
  a.id AS account_id,
  c.is_active,
  c.kill_reason
FROM public.paper_accounts a
INNER JOIN public.paper_configs c ON a.paper_config_id = c.id
INNER JOIN public.paper_runs r ON a.run_id = r.id
LEFT JOIN trade_stats ts ON a.run_id = ts.run_id AND a.paper_config_id = ts.paper_config_id;
-- Note: Sort by run_id, config_rank in your queries for ordered results

-- ============================================================================
-- C) V_RUN_OVERVIEW
-- ============================================================================
-- One row per run_id with high-level run statistics
CREATE OR REPLACE VIEW public.v_run_overview AS
WITH strategy_perf AS (
  SELECT 
    run_id,
    COUNT(DISTINCT paper_config_id) AS strategies,
    SUM(trades) AS trades_total,
    SUM(pnl_total) AS pnl_total,
    SUM(wins) AS wins_total,
    MAX(max_drawdown_pct) AS max_drawdown_pct_worst,
    SUM(equity_current) AS equity_sum,
    COUNT(*) FILTER (WHERE has_open_position = true) AS accounts_with_open_position
  FROM public.v_strategy_performance
  GROUP BY run_id
),
best_strategy AS (
  SELECT DISTINCT ON (run_id)
    run_id,
    config_rank AS best_strategy_rank
  FROM public.v_strategy_performance
  ORDER BY run_id, pnl_total DESC NULLS LAST, config_rank ASC NULLS LAST
),
worst_strategy AS (
  SELECT DISTINCT ON (run_id)
    run_id,
    config_rank AS worst_strategy_rank
  FROM public.v_strategy_performance
  ORDER BY run_id, pnl_total ASC NULLS LAST, config_rank DESC NULLS LAST
)
SELECT 
  r.id AS run_id,
  r.symbol,
  r.timeframe_min,
  r.started_at,
  r.status,
  r.note,
  COALESCE(sp.strategies, 0) AS strategies,
  COALESCE(sp.trades_total, 0) AS trades_total,
  COALESCE(sp.pnl_total, 0) AS pnl_total,
  CASE 
    WHEN COALESCE(sp.trades_total, 0) > 0 
    THEN ROUND((COALESCE(sp.wins_total, 0)::NUMERIC / sp.trades_total::NUMERIC) * 100, 2)
    ELSE 0
  END AS winrate_total,
  bs.best_strategy_rank,
  ws.worst_strategy_rank,
  COALESCE(sp.accounts_with_open_position, 0) AS accounts_with_open_position,
  COALESCE(sp.max_drawdown_pct_worst, 0) AS max_drawdown_pct_worst,
  COALESCE(sp.equity_sum, 0) AS equity_sum
FROM public.paper_runs r
LEFT JOIN strategy_perf sp ON r.id = sp.run_id
LEFT JOIN best_strategy bs ON r.id = bs.run_id
LEFT JOIN worst_strategy ws ON r.id = ws.run_id;
-- Note: Sort by started_at DESC in your queries for chronological order

-- ============================================================================
-- D) V_DAILY_PNL
-- ============================================================================
-- Daily PnL aggregation per run
CREATE OR REPLACE VIEW public.v_daily_pnl AS
SELECT 
  DATE(COALESCE(t.closed_ts, t.opened_ts)) AS day,
  t.run_id,
  r.symbol,
  r.timeframe_min,
  SUM(t.pnl_abs) AS pnl_total,
  COUNT(*) AS trades,
  COUNT(*) FILTER (WHERE t.result = 'win') AS wins,
  COUNT(*) FILTER (WHERE t.result = 'loss') AS losses,
  CASE 
    WHEN COUNT(*) > 0 
    THEN ROUND((COUNT(*) FILTER (WHERE t.result = 'win')::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
    ELSE 0
  END AS winrate
FROM public.paper_trades t
INNER JOIN public.paper_runs r ON t.run_id = r.id
WHERE t.closed_ts IS NOT NULL  -- Only closed trades for daily aggregation
GROUP BY DATE(COALESCE(t.closed_ts, t.opened_ts)), t.run_id, r.symbol, r.timeframe_min;
-- Note: Sort by day DESC, run_id in your queries for chronological order

-- ============================================================================
-- E) V_TRADE_REASON_STATS
-- ============================================================================
-- Aggregated trade reasons (entry/exit/trigger) with performance metrics
CREATE OR REPLACE VIEW public.v_trade_reason_stats AS
WITH base AS (
  SELECT
    t.run_id,
    t.paper_config_id,
    t.side,
    COALESCE(t.meta->>'entry_reason', 'unknown') AS entry_reason,
    COALESCE(t.meta->>'trigger_type', 'unknown') AS trigger_type,
    COALESCE(t.meta->>'exit_reason', 'unknown') AS exit_reason,
    t.result,
    t.pnl_abs,
    t.closed_ts
  FROM public.paper_trades t
  WHERE t.closed_ts IS NOT NULL
)
SELECT
  b.run_id,
  b.paper_config_id,
  COALESCE(c.rank, -1) AS config_rank,
  r.symbol,
  r.timeframe_min,
  b.side,
  b.entry_reason,
  b.trigger_type,
  b.exit_reason,
  COUNT(*) AS trades,
  COUNT(*) FILTER (WHERE b.result = 'win') AS wins,
  COUNT(*) FILTER (WHERE b.result = 'loss') AS losses,
  COUNT(*) FILTER (WHERE b.result = 'breakeven') AS breakevens,
  CASE
    WHEN COUNT(*) > 0
    THEN ROUND((COUNT(*) FILTER (WHERE b.result = 'win')::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
    ELSE 0
  END AS winrate,
  COALESCE(SUM(b.pnl_abs), 0) AS pnl_total,
  COALESCE(AVG(b.pnl_abs), 0) AS pnl_avg,
  MIN(b.closed_ts) AS first_closed_ts,
  MAX(b.closed_ts) AS last_closed_ts
FROM base b
INNER JOIN public.paper_configs c ON b.paper_config_id = c.id
INNER JOIN public.paper_runs r ON b.run_id = r.id
GROUP BY
  b.run_id,
  b.paper_config_id,
  COALESCE(c.rank, -1),
  r.symbol,
  r.timeframe_min,
  b.side,
  b.entry_reason,
  b.trigger_type,
  b.exit_reason;

-- ============================================================================
-- F) V_WEEKLY_PNL
-- ============================================================================
-- Weekly PnL aggregation per run
CREATE OR REPLACE VIEW public.v_weekly_pnl AS
SELECT
  DATE_TRUNC('week', COALESCE(t.closed_ts, t.opened_ts))::DATE AS week_start,
  t.run_id,
  r.symbol,
  r.timeframe_min,
  SUM(t.pnl_abs) AS pnl_total,
  COUNT(*) AS trades,
  COUNT(*) FILTER (WHERE t.result = 'win') AS wins,
  COUNT(*) FILTER (WHERE t.result = 'loss') AS losses,
  CASE
    WHEN COUNT(*) > 0
    THEN ROUND((COUNT(*) FILTER (WHERE t.result = 'win')::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
    ELSE 0
  END AS winrate
FROM public.paper_trades t
INNER JOIN public.paper_runs r ON t.run_id = r.id
WHERE t.closed_ts IS NOT NULL
GROUP BY DATE_TRUNC('week', COALESCE(t.closed_ts, t.opened_ts)), t.run_id, r.symbol, r.timeframe_min;

-- ============================================================================
-- G) AGGREGATED VIEWS (ALL RUNS)
-- ============================================================================

CREATE OR REPLACE VIEW public.v_run_overview_all AS
WITH trade_stats AS (
  SELECT
    COUNT(*) AS trades_total,
    COUNT(*) FILTER (WHERE result = 'win') AS wins_total,
    SUM(pnl_abs) AS pnl_total
  FROM public.paper_trades
  WHERE closed_ts IS NOT NULL
),
open_positions AS (
  SELECT COUNT(*) AS accounts_with_open_position
  FROM public.paper_accounts
  WHERE open_position IS NOT NULL
),
drawdown AS (
  SELECT MAX(max_drawdown_pct) AS max_drawdown_pct_worst
  FROM public.paper_accounts
),
equity AS (
  SELECT SUM(equity) AS equity_sum
  FROM public.paper_accounts
),
run_start AS (
  SELECT MIN(started_at) AS started_at
  FROM public.paper_runs
)
SELECT
  'all'::TEXT AS run_id,
  'ALL'::TEXT AS symbol,
  0::INTEGER AS timeframe_min,
  rs.started_at,
  'aggregate'::TEXT AS status,
  NULL::TEXT AS note,
  COALESCE((SELECT COUNT(*) FROM public.paper_configs), 0) AS strategies,
  COALESCE(ts.trades_total, 0) AS trades_total,
  COALESCE(ts.pnl_total, 0) AS pnl_total,
  CASE
    WHEN COALESCE(ts.trades_total, 0) > 0
    THEN ROUND((COALESCE(ts.wins_total, 0)::NUMERIC / ts.trades_total::NUMERIC) * 100, 2)
    ELSE 0
  END AS winrate_total,
  NULL::INTEGER AS best_strategy_rank,
  NULL::INTEGER AS worst_strategy_rank,
  COALESCE(op.accounts_with_open_position, 0) AS accounts_with_open_position,
  COALESCE(dd.max_drawdown_pct_worst, 0) AS max_drawdown_pct_worst,
  COALESCE(eq.equity_sum, 0) AS equity_sum
FROM trade_stats ts
LEFT JOIN open_positions op ON true
LEFT JOIN drawdown dd ON true
LEFT JOIN equity eq ON true
LEFT JOIN run_start rs ON true;

CREATE OR REPLACE VIEW public.v_daily_pnl_all AS
SELECT
  DATE(COALESCE(t.closed_ts, t.opened_ts)) AS day,
  'all'::TEXT AS run_id,
  'ALL'::TEXT AS symbol,
  0::INTEGER AS timeframe_min,
  SUM(t.pnl_abs) AS pnl_total,
  COUNT(*) AS trades,
  COUNT(*) FILTER (WHERE t.result = 'win') AS wins,
  COUNT(*) FILTER (WHERE t.result = 'loss') AS losses,
  CASE
    WHEN COUNT(*) > 0
    THEN ROUND((COUNT(*) FILTER (WHERE t.result = 'win')::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
    ELSE 0
  END AS winrate
FROM public.paper_trades t
WHERE t.closed_ts IS NOT NULL
GROUP BY DATE(COALESCE(t.closed_ts, t.opened_ts));

CREATE OR REPLACE VIEW public.v_weekly_pnl_all AS
SELECT
  DATE_TRUNC('week', COALESCE(t.closed_ts, t.opened_ts))::DATE AS week_start,
  'all'::TEXT AS run_id,
  'ALL'::TEXT AS symbol,
  0::INTEGER AS timeframe_min,
  SUM(t.pnl_abs) AS pnl_total,
  COUNT(*) AS trades,
  COUNT(*) FILTER (WHERE t.result = 'win') AS wins,
  COUNT(*) FILTER (WHERE t.result = 'loss') AS losses,
  CASE
    WHEN COUNT(*) > 0
    THEN ROUND((COUNT(*) FILTER (WHERE t.result = 'win')::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
    ELSE 0
  END AS winrate
FROM public.paper_trades t
WHERE t.closed_ts IS NOT NULL
GROUP BY DATE_TRUNC('week', COALESCE(t.closed_ts, t.opened_ts));

CREATE OR REPLACE VIEW public.v_trade_reason_stats_all AS
WITH base AS (
  SELECT
    'all'::TEXT AS run_id,
    'all'::TEXT AS paper_config_id,
    -1::INTEGER AS config_rank,
    t.side,
    COALESCE(t.meta->>'entry_reason', 'unknown') AS entry_reason,
    COALESCE(t.meta->>'trigger_type', 'unknown') AS trigger_type,
    COALESCE(t.meta->>'exit_reason', 'unknown') AS exit_reason,
    t.result,
    t.pnl_abs,
    t.closed_ts
  FROM public.paper_trades t
  WHERE t.closed_ts IS NOT NULL
)
SELECT
  b.run_id,
  b.paper_config_id,
  b.config_rank,
  'ALL'::TEXT AS symbol,
  0::INTEGER AS timeframe_min,
  b.side,
  b.entry_reason,
  b.trigger_type,
  b.exit_reason,
  COUNT(*) AS trades,
  COUNT(*) FILTER (WHERE b.result = 'win') AS wins,
  COUNT(*) FILTER (WHERE b.result = 'loss') AS losses,
  COUNT(*) FILTER (WHERE b.result = 'breakeven') AS breakevens,
  CASE
    WHEN COUNT(*) > 0
    THEN ROUND((COUNT(*) FILTER (WHERE b.result = 'win')::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
    ELSE 0
  END AS winrate,
  COALESCE(SUM(b.pnl_abs), 0) AS pnl_total,
  COALESCE(AVG(b.pnl_abs), 0) AS pnl_avg,
  MIN(b.closed_ts) AS first_closed_ts,
  MAX(b.closed_ts) AS last_closed_ts
FROM base b
GROUP BY
  b.run_id,
  b.paper_config_id,
  b.config_rank,
  b.side,
  b.entry_reason,
  b.trigger_type,
  b.exit_reason;

-- ============================================================================
-- INDEX RECOMMENDATIONS (as comments)
-- ============================================================================
-- The following indexes are recommended for optimal view performance:
--
-- CREATE INDEX IF NOT EXISTS idx_paper_trades_run_config_exit 
--   ON public.paper_trades(run_id, paper_config_id, closed_ts DESC NULLS LAST);
--
-- CREATE INDEX IF NOT EXISTS idx_paper_accounts_run_config 
--   ON public.paper_accounts(run_id, paper_config_id);
--
-- CREATE INDEX IF NOT EXISTS idx_paper_configs_run_rank 
--   ON public.paper_configs(run_id, rank NULLS LAST);
--
-- Note: Some of these indexes may already exist from migration 008_paper_trading.sql

-- ============================================================================
-- EXAMPLE QUERIES FOR TESTING
-- ============================================================================

-- Example 1: Get latest run overview
-- SELECT * FROM public.v_run_overview ORDER BY started_at DESC LIMIT 1;

-- Example 2: Get strategy performance for a specific run
-- SELECT * FROM public.v_strategy_performance WHERE run_id = '<run_id>' ORDER BY config_rank;

-- Example 3: Get last 50 trades from journal
-- SELECT * FROM public.v_paper_journal ORDER BY COALESCE(exit_ts, entry_ts) DESC NULLS LAST LIMIT 50;

-- Example 4: Get daily PnL for a specific run
-- SELECT * FROM public.v_daily_pnl WHERE run_id = '<run_id>' ORDER BY day DESC;

-- Example 5: Get trades for a specific strategy
-- SELECT * FROM public.v_paper_journal WHERE paper_config_id = '<config_id>' ORDER BY COALESCE(exit_ts, entry_ts) DESC;
