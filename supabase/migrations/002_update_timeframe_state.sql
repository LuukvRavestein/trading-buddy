-- Update timeframe_state table to match exact requirements
-- Run this if you already have 001_initial_schema.sql applied

-- Drop existing table if it exists (for clean migration)
-- Note: This will delete existing data. Only run if starting fresh or after backup.
-- DROP TABLE IF EXISTS timeframe_state CASCADE;

-- Create/Update timeframe_state table with exact required columns
CREATE TABLE IF NOT EXISTS timeframe_state (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe_min INTEGER NOT NULL,
  ts TIMESTAMPTZ NOT NULL,  -- timestamp of the candle this state is computed for (use latest fully closed candle)
  trend TEXT NOT NULL CHECK (trend IN ('up', 'down', 'chop')),
  atr NUMERIC(20, 8),
  last_swing_high NUMERIC(20, 8),
  last_swing_low NUMERIC(20, 8),
  bos_direction TEXT CHECK (bos_direction IN ('up', 'down')),
  choch_direction TEXT CHECK (choch_direction IN ('up', 'down')),
  last_candle_ts TIMESTAMPTZ,  -- convenience, can equal ts
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one state per symbol/timeframe/timestamp
  UNIQUE(symbol, timeframe_min, ts)
);

-- Indexes for timeframe_state
CREATE INDEX IF NOT EXISTS idx_timeframe_state_symbol_timeframe_ts 
  ON timeframe_state(symbol, timeframe_min, ts DESC);

-- If table already exists, add missing columns (safe migration)
DO $$
BEGIN
  -- Add columns if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'timeframe_state' AND column_name = 'last_candle_ts') THEN
    ALTER TABLE timeframe_state ADD COLUMN last_candle_ts TIMESTAMPTZ;
  END IF;
  
  -- Update trend constraint if needed (make it NOT NULL if not already)
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'timeframe_state' AND column_name = 'trend' AND is_nullable = 'YES') THEN
    ALTER TABLE timeframe_state ALTER COLUMN trend SET NOT NULL;
  END IF;
END $$;

-- Enable RLS if not already enabled
ALTER TABLE timeframe_state ENABLE ROW LEVEL SECURITY;

-- Create policy if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies 
                 WHERE tablename = 'timeframe_state' AND policyname = 'Allow all operations for service role') THEN
    CREATE POLICY "Allow all operations for service role" ON timeframe_state
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

