-- Migration 005: Backtest tables for strategy optimization
-- Creates tables for storing backtest runs and their trades

-- ============================================================================
-- 1. TABLE: strategy_runs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.strategy_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  start_ts timestamptz NOT NULL,
  end_ts timestamptz NOT NULL,
  config jsonb NOT NULL,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Indexes for strategy_runs
CREATE INDEX IF NOT EXISTS idx_strategy_runs_symbol_created_at ON public.strategy_runs(symbol, created_at DESC);

-- Comments
COMMENT ON TABLE public.strategy_runs IS 'Stores backtest run metadata and aggregated results';
COMMENT ON COLUMN public.strategy_runs.config IS 'JSONB storing all strategy parameters/variant toggles';
COMMENT ON COLUMN public.strategy_runs.results IS 'JSONB storing metrics: trades, winrate, pnl, drawdown, etc.';

-- ============================================================================
-- 2. TABLE: strategy_trades
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.strategy_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.strategy_runs(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  entry_ts timestamptz NOT NULL,
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  exit_ts timestamptz,
  exit_price numeric,
  exit_reason text,
  pnl_abs numeric,
  pnl_pct numeric,
  mfe numeric,
  mae numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for strategy_trades
CREATE INDEX IF NOT EXISTS idx_strategy_trades_run_id ON public.strategy_trades(run_id);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_symbol_entry_ts ON public.strategy_trades(symbol, entry_ts);

-- Comments
COMMENT ON TABLE public.strategy_trades IS 'Stores individual trades from backtest runs';
COMMENT ON COLUMN public.strategy_trades.mfe IS 'Max Favorable Excursion (numeric)';
COMMENT ON COLUMN public.strategy_trades.mae IS 'Max Adverse Excursion (numeric)';

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on strategy_runs
ALTER TABLE public.strategy_runs ENABLE ROW LEVEL SECURITY;

-- Enable RLS on strategy_trades
ALTER TABLE public.strategy_trades ENABLE ROW LEVEL SECURITY;

-- Policy: service_role has full access to strategy_runs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'strategy_runs' 
    AND policyname = 'service_role_full_access_strategy_runs'
  ) THEN
    CREATE POLICY "service_role_full_access_strategy_runs"
      ON public.strategy_runs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Policy: authenticated users can read strategy_runs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'strategy_runs' 
    AND policyname = 'authenticated_read_strategy_runs'
  ) THEN
    CREATE POLICY "authenticated_read_strategy_runs"
      ON public.strategy_runs
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- Policy: service_role has full access to strategy_trades
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'strategy_trades' 
    AND policyname = 'service_role_full_access_strategy_trades'
  ) THEN
    CREATE POLICY "service_role_full_access_strategy_trades"
      ON public.strategy_trades
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Policy: authenticated users can read strategy_trades
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'strategy_trades' 
    AND policyname = 'authenticated_read_strategy_trades'
  ) THEN
    CREATE POLICY "authenticated_read_strategy_trades"
      ON public.strategy_trades
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
