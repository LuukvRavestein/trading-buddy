-- Paper Performance Engine Schema
-- Run this after 003_update_trade_proposals.sql

-- ============================================================================
-- 1. EXTEND trade_proposals TABLE
-- ============================================================================

-- Add lifecycle and outcome columns to trade_proposals
DO $$
BEGIN
  -- executed_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'executed_at') THEN
    ALTER TABLE trade_proposals ADD COLUMN executed_at TIMESTAMPTZ;
  END IF;
  
  -- entry_fill_price
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'entry_fill_price') THEN
    ALTER TABLE trade_proposals ADD COLUMN entry_fill_price NUMERIC(20, 8);
  END IF;
  
  -- entry_fill_ts
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'entry_fill_ts') THEN
    ALTER TABLE trade_proposals ADD COLUMN entry_fill_ts TIMESTAMPTZ;
  END IF;
  
  -- entry_type
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'entry_type') THEN
    ALTER TABLE trade_proposals ADD COLUMN entry_type TEXT CHECK (entry_type IN ('market', 'limit'));
  END IF;
  
  -- exit_price
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'exit_price') THEN
    ALTER TABLE trade_proposals ADD COLUMN exit_price NUMERIC(20, 8);
  END IF;
  
  -- exit_ts
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'exit_ts') THEN
    ALTER TABLE trade_proposals ADD COLUMN exit_ts TIMESTAMPTZ;
  END IF;
  
  -- exit_reason
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'exit_reason') THEN
    ALTER TABLE trade_proposals ADD COLUMN exit_reason TEXT CHECK (exit_reason IN ('tp', 'sl', 'expired', 'cancelled', 'unknown'));
  END IF;
  
  -- pnl_abs
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'pnl_abs') THEN
    ALTER TABLE trade_proposals ADD COLUMN pnl_abs NUMERIC(20, 8);
  END IF;
  
  -- pnl_pct
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'pnl_pct') THEN
    ALTER TABLE trade_proposals ADD COLUMN pnl_pct NUMERIC(10, 4);
  END IF;
  
  -- max_favorable_excursion
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'max_favorable_excursion') THEN
    ALTER TABLE trade_proposals ADD COLUMN max_favorable_excursion NUMERIC(20, 8);
  END IF;
  
  -- max_adverse_excursion
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'max_adverse_excursion') THEN
    ALTER TABLE trade_proposals ADD COLUMN max_adverse_excursion NUMERIC(20, 8);
  END IF;
END $$;

-- Update status constraint to include new statuses
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trade_proposals_status_check') THEN
    ALTER TABLE trade_proposals DROP CONSTRAINT trade_proposals_status_check;
  END IF;
  
  -- Add new constraint with all statuses
  ALTER TABLE trade_proposals ADD CONSTRAINT trade_proposals_status_check 
    CHECK (status IN ('proposed', 'expired', 'executed', 'closed_tp', 'closed_sl', 'cancelled'));
END $$;

-- Convert existing 'executed' status to 'executed' (no change needed, but ensure compatibility)
-- If there are old 'rejected' statuses, we can leave them or convert them
-- For now, we'll keep the constraint flexible

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_trade_proposals_symbol_status 
  ON trade_proposals(symbol, status);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_symbol_created_desc 
  ON trade_proposals(symbol, created_at DESC);

-- ============================================================================
-- 2. PAPER_STATS_DAILY TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS paper_stats_daily (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  trades INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  winrate NUMERIC(10, 4) NOT NULL DEFAULT 0,
  pnl_abs NUMERIC(20, 8) NOT NULL DEFAULT 0,
  pnl_pct NUMERIC(10, 4) NOT NULL DEFAULT 0,
  expectancy NUMERIC(20, 8) NOT NULL DEFAULT 0,
  max_drawdown_pct NUMERIC(10, 4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one stat per symbol per date
  UNIQUE(symbol, date)
);

-- Indexes for paper_stats_daily
CREATE INDEX IF NOT EXISTS idx_paper_stats_daily_symbol_date 
  ON paper_stats_daily(symbol, date DESC);
CREATE INDEX IF NOT EXISTS idx_paper_stats_daily_date 
  ON paper_stats_daily(date DESC);

-- Enable RLS
ALTER TABLE paper_stats_daily ENABLE ROW LEVEL SECURITY;

-- Create policy
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies 
                 WHERE tablename = 'paper_stats_daily' AND policyname = 'Allow all operations for service role') THEN
    CREATE POLICY "Allow all operations for service role" ON paper_stats_daily
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

