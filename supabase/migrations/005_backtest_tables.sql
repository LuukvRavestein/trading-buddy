-- Migration 005: Backtest tables for strategy optimization
-- Creates tables for storing backtest runs and their trades

-- Table: strategy_runs
-- Stores backtest run metadata and results
CREATE TABLE IF NOT EXISTS public.strategy_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  start_ts timestamptz NOT NULL,
  end_ts timestamptz NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  results jsonb NULL,
  error text NULL
);

-- Indexes for strategy_runs
CREATE INDEX IF NOT EXISTS idx_strategy_runs_symbol ON public.strategy_runs(symbol);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_status ON public.strategy_runs(status);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_created_at ON public.strategy_runs(created_at DESC);

-- Table: strategy_trades
-- Stores individual trades from backtest runs
CREATE TABLE IF NOT EXISTS public.strategy_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.strategy_runs(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  entry_ts timestamptz NOT NULL,
  entry_price numeric NOT NULL,
  exit_ts timestamptz NOT NULL,
  exit_price numeric NOT NULL,
  exit_reason text NOT NULL CHECK (exit_reason IN ('tp', 'sl', 'timeout', 'flip')),
  pnl_abs numeric NOT NULL,
  pnl_pct numeric NOT NULL,
  mfe_pct numeric NULL,
  mae_pct numeric NULL
);

-- Indexes for strategy_trades
CREATE INDEX IF NOT EXISTS idx_strategy_trades_run_id ON public.strategy_trades(run_id);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_symbol ON public.strategy_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_entry_ts ON public.strategy_trades(entry_ts);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_exit_ts ON public.strategy_trades(exit_ts);

-- Comments
COMMENT ON TABLE public.strategy_runs IS 'Stores backtest run metadata and aggregated results';
COMMENT ON TABLE public.strategy_trades IS 'Stores individual trades from backtest runs';
COMMENT ON COLUMN public.strategy_runs.config IS 'JSONB storing all strategy parameters/variant toggles';
COMMENT ON COLUMN public.strategy_runs.results IS 'JSONB storing metrics: trades, winrate, pnl, drawdown, etc.';

