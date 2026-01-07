-- Paper Trading Tables
-- 
-- Tables for live paper trading runner that evaluates multiple strategy configs
-- in parallel on Deribit BTC-PERPETUAL using live candle data.
--
-- Run this in Supabase SQL Editor:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Click "New query"
-- 3. Paste this entire file
-- 4. Click "Run" (or Ctrl+Enter)

-- ============================================================================
-- A) PAPER_RUNS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.paper_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe_min INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'running',  -- running|finished|stopped
  note TEXT NULL,
  
  CONSTRAINT paper_runs_status_check CHECK (status IN ('running', 'finished', 'stopped'))
);

CREATE INDEX IF NOT EXISTS idx_paper_runs_status ON public.paper_runs(status);
CREATE INDEX IF NOT EXISTS idx_paper_runs_symbol ON public.paper_runs(symbol);

-- ============================================================================
-- B) PAPER_CONFIGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.paper_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.paper_runs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,  -- 'optimizer_run_top_configs'|'manual'
  source_run_id UUID NULL,  -- optimizer run id indien van optimizer afkomstig
  rank INTEGER NULL,
  config JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  kill_reason TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT paper_configs_source_check CHECK (source IN ('optimizer_run_top_configs', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_paper_configs_run_id ON public.paper_configs(run_id);
CREATE INDEX IF NOT EXISTS idx_paper_configs_is_active ON public.paper_configs(is_active);
CREATE INDEX IF NOT EXISTS idx_paper_configs_source_run_id ON public.paper_configs(source_run_id);

-- Unique constraint: (run_id, coalesce(rank,-1), config)
-- Note: PostgreSQL doesn't support coalesce in unique constraints directly,
-- so we use a unique index with expression
CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_configs_unique 
  ON public.paper_configs(run_id, COALESCE(rank, -1), config);

-- ============================================================================
-- C) PAPER_ACCOUNTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.paper_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.paper_runs(id) ON DELETE CASCADE,
  paper_config_id UUID NOT NULL REFERENCES public.paper_configs(id) ON DELETE CASCADE,
  balance_start NUMERIC NOT NULL DEFAULT 1000,
  balance NUMERIC NOT NULL DEFAULT 1000,
  equity NUMERIC NOT NULL DEFAULT 1000,
  max_equity NUMERIC NOT NULL DEFAULT 1000,
  max_drawdown_pct NUMERIC NOT NULL DEFAULT 0,
  open_position JSONB NULL,  -- {side, entry, size, sl, tp, opened_ts, fees_paid}
  trades_count INTEGER NOT NULL DEFAULT 0,
  wins_count INTEGER NOT NULL DEFAULT 0,
  losses_count INTEGER NOT NULL DEFAULT 0,
  profit_factor NUMERIC NULL,
  last_candle_ts TIMESTAMPTZ NULL,  -- voor idempotency checkpoint per account
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_accounts_run_id ON public.paper_accounts(run_id);
CREATE INDEX IF NOT EXISTS idx_paper_accounts_paper_config_id ON public.paper_accounts(paper_config_id);
CREATE INDEX IF NOT EXISTS idx_paper_accounts_last_candle_ts ON public.paper_accounts(last_candle_ts);

-- ============================================================================
-- D) PAPER_TRADES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.paper_trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.paper_runs(id) ON DELETE CASCADE,
  paper_config_id UUID NOT NULL REFERENCES public.paper_configs(id) ON DELETE CASCADE,
  opened_ts TIMESTAMPTZ NOT NULL,
  closed_ts TIMESTAMPTZ NULL,
  side TEXT NOT NULL,  -- long|short
  entry NUMERIC NOT NULL,
  exit NUMERIC NULL,
  size NUMERIC NOT NULL,
  pnl_pct NUMERIC NULL,
  pnl_abs NUMERIC NULL,
  fees_abs NUMERIC NULL,
  sl NUMERIC NULL,
  tp NUMERIC NULL,
  result TEXT NULL,  -- win|loss|breakeven
  meta JSONB NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT paper_trades_side_check CHECK (side IN ('long', 'short')),
  CONSTRAINT paper_trades_result_check CHECK (result IN ('win', 'loss', 'breakeven'))
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_run_id_config_opened ON public.paper_trades(run_id, paper_config_id, opened_ts);
CREATE INDEX IF NOT EXISTS idx_paper_trades_paper_config_id ON public.paper_trades(paper_config_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_opened_ts ON public.paper_trades(opened_ts);

-- Unique idempotency: (run_id, paper_config_id, opened_ts, side, entry)
CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_trades_unique 
  ON public.paper_trades(run_id, paper_config_id, opened_ts, side, entry);

-- ============================================================================
-- E) PAPER_EQUITY_SNAPSHOTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.paper_equity_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.paper_runs(id) ON DELETE CASCADE,
  paper_config_id UUID NOT NULL REFERENCES public.paper_configs(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  equity NUMERIC NOT NULL,
  balance NUMERIC NOT NULL,
  dd_pct NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_equity_snapshots_unique 
  ON public.paper_equity_snapshots(run_id, paper_config_id, ts);
CREATE INDEX IF NOT EXISTS idx_paper_equity_snapshots_run_ts ON public.paper_equity_snapshots(run_id, ts);
CREATE INDEX IF NOT EXISTS idx_paper_equity_snapshots_paper_config_id ON public.paper_equity_snapshots(paper_config_id);

-- ============================================================================
-- F) PAPER_EVENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.paper_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.paper_runs(id) ON DELETE CASCADE,
  paper_config_id UUID NULL REFERENCES public.paper_configs(id) ON DELETE SET NULL,
  ts TIMESTAMPTZ DEFAULT NOW(),
  level TEXT NOT NULL,  -- info|warn|error
  message TEXT NOT NULL,
  payload JSONB NULL,
  
  CONSTRAINT paper_events_level_check CHECK (level IN ('info', 'warn', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_paper_events_run_id ON public.paper_events(run_id);
CREATE INDEX IF NOT EXISTS idx_paper_events_paper_config_id ON public.paper_events(paper_config_id);
CREATE INDEX IF NOT EXISTS idx_paper_events_ts ON public.paper_events(ts);

-- ============================================================================
-- RLS (Optional - service_role bypasses RLS)
-- ============================================================================
-- Enable RLS on all tables
ALTER TABLE public.paper_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_equity_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_events ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (service_role bypasses RLS by default, but explicit policy for clarity)
DROP POLICY IF EXISTS "service_role_full_access_paper_runs" ON public.paper_runs;
CREATE POLICY "service_role_full_access_paper_runs" ON public.paper_runs
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access_paper_configs" ON public.paper_configs;
CREATE POLICY "service_role_full_access_paper_configs" ON public.paper_configs
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access_paper_accounts" ON public.paper_accounts;
CREATE POLICY "service_role_full_access_paper_accounts" ON public.paper_accounts
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access_paper_trades" ON public.paper_trades;
CREATE POLICY "service_role_full_access_paper_trades" ON public.paper_trades
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access_paper_equity_snapshots" ON public.paper_equity_snapshots;
CREATE POLICY "service_role_full_access_paper_equity_snapshots" ON public.paper_equity_snapshots
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access_paper_events" ON public.paper_events;
CREATE POLICY "service_role_full_access_paper_events" ON public.paper_events
  FOR ALL USING (true) WITH CHECK (true);

