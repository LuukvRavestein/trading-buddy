-- Migration 007: Optimizer tables for strategy optimization runs and OOS results
-- Creates tables for storing optimizer runs, top configs, all configs, and out-of-sample results

-- ============================================================================
-- 1. TABLE: optimizer_runs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.optimizer_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  train_start_ts timestamptz NOT NULL,
  train_end_ts timestamptz NOT NULL,
  dd_limit numeric NOT NULL,
  total_configs int NOT NULL,
  valid_configs int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for optimizer_runs
CREATE INDEX IF NOT EXISTS idx_optimizer_runs_symbol_created_at ON public.optimizer_runs(symbol, created_at DESC);

-- Comments
COMMENT ON TABLE public.optimizer_runs IS 'Stores optimizer run metadata';
COMMENT ON COLUMN public.optimizer_runs.dd_limit IS 'Maximum drawdown limit used for filtering configs';

-- ============================================================================
-- 2. TABLE: optimizer_run_top_configs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.optimizer_run_top_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.optimizer_runs(id) ON DELETE CASCADE,
  rank int NOT NULL CHECK (rank >= 1 AND rank <= 10),
  score numeric NOT NULL,
  trades int NOT NULL,
  winrate numeric NOT NULL,
  pnl numeric NOT NULL,
  dd numeric NOT NULL,
  pf numeric NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, rank)
);

-- Indexes for optimizer_run_top_configs
CREATE INDEX IF NOT EXISTS idx_optimizer_run_top_configs_run_id ON public.optimizer_run_top_configs(run_id);
CREATE INDEX IF NOT EXISTS idx_optimizer_run_top_configs_score ON public.optimizer_run_top_configs(score DESC);

-- Comments
COMMENT ON TABLE public.optimizer_run_top_configs IS 'Stores top 10 configs per optimizer run';
COMMENT ON COLUMN public.optimizer_run_top_configs.score IS 'Primary score used for ranking';
COMMENT ON COLUMN public.optimizer_run_top_configs.pnl IS 'Total PnL percentage';
COMMENT ON COLUMN public.optimizer_run_top_configs.dd IS 'Maximum drawdown percentage';
COMMENT ON COLUMN public.optimizer_run_top_configs.pf IS 'Profit factor';

-- ============================================================================
-- 3. TABLE: optimizer_run_configs (optional - all configs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.optimizer_run_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.optimizer_runs(id) ON DELETE CASCADE,
  score numeric NOT NULL,
  trades int NOT NULL,
  winrate numeric NOT NULL,
  pnl numeric NOT NULL,
  dd numeric NOT NULL,
  pf numeric NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for optimizer_run_configs
CREATE INDEX IF NOT EXISTS idx_optimizer_run_configs_run_id ON public.optimizer_run_configs(run_id);
CREATE INDEX IF NOT EXISTS idx_optimizer_run_configs_score ON public.optimizer_run_configs(score DESC);

-- Comments
COMMENT ON TABLE public.optimizer_run_configs IS 'Stores all valid configs per optimizer run (optional, enabled via SAVE_ALL_CONFIGS)';

-- ============================================================================
-- 4. TABLE: optimizer_oos_results
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.optimizer_oos_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.optimizer_runs(id) ON DELETE CASCADE,
  rank int NOT NULL CHECK (rank >= 1),
  symbol text NOT NULL,
  test_start_ts timestamptz NOT NULL,
  test_end_ts timestamptz NOT NULL,
  score numeric NOT NULL,
  trades int NOT NULL,
  winrate numeric NOT NULL,
  pnl numeric NOT NULL,
  dd numeric NOT NULL,
  pf numeric NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, rank)
);

-- Indexes for optimizer_oos_results
CREATE INDEX IF NOT EXISTS idx_optimizer_oos_results_run_id ON public.optimizer_oos_results(run_id);
CREATE INDEX IF NOT EXISTS idx_optimizer_oos_results_symbol_created_at ON public.optimizer_oos_results(symbol, created_at DESC);

-- Comments
COMMENT ON TABLE public.optimizer_oos_results IS 'Stores out-of-sample backtest results for top N configs';
COMMENT ON COLUMN public.optimizer_oos_results.rank IS 'Rank from optimizer run (1 = best)';

-- ============================================================================
-- RLS Policies (if RLS is enabled)
-- ============================================================================
-- Note: These tables use service_role key, so RLS may not be needed
-- But we add policies for safety if RLS is enabled later

DO $$ 
BEGIN
  -- Enable RLS if not already enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'optimizer_runs' AND policyname = 'service_role_full_access_optimizer_runs'
  ) THEN
    ALTER TABLE public.optimizer_runs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_role_full_access_optimizer_runs" ON public.optimizer_runs
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'optimizer_run_top_configs' AND policyname = 'service_role_full_access_optimizer_run_top_configs'
  ) THEN
    ALTER TABLE public.optimizer_run_top_configs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_role_full_access_optimizer_run_top_configs" ON public.optimizer_run_top_configs
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'optimizer_run_configs' AND policyname = 'service_role_full_access_optimizer_run_configs'
  ) THEN
    ALTER TABLE public.optimizer_run_configs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_role_full_access_optimizer_run_configs" ON public.optimizer_run_configs
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'optimizer_oos_results' AND policyname = 'service_role_full_access_optimizer_oos_results'
  ) THEN
    ALTER TABLE public.optimizer_oos_results ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "service_role_full_access_optimizer_oos_results" ON public.optimizer_oos_results
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

