-- Update trade_proposals table to match strategy evaluator requirements
-- Run this after 001_initial_schema.sql

-- Add missing columns if they don't exist
DO $$
BEGIN
  -- Add direction column (alias for side, but using 'direction' as per requirements)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'direction') THEN
    ALTER TABLE trade_proposals ADD COLUMN direction TEXT CHECK (direction IN ('long', 'short'));
    -- Copy from side if it exists
    UPDATE trade_proposals SET direction = side WHERE direction IS NULL;
  END IF;
  
  -- Add stop_loss column (alias for sl_price)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'stop_loss') THEN
    ALTER TABLE trade_proposals ADD COLUMN stop_loss NUMERIC(20, 8);
    -- Copy from sl_price if it exists
    UPDATE trade_proposals SET stop_loss = sl_price WHERE stop_loss IS NULL;
  END IF;
  
  -- Add take_profit column (alias for tp_price)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'take_profit') THEN
    ALTER TABLE trade_proposals ADD COLUMN take_profit NUMERIC(20, 8);
    -- Copy from tp_price if it exists
    UPDATE trade_proposals SET take_profit = tp_price WHERE take_profit IS NULL;
  END IF;
  
  -- Add timeframe_context JSONB column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'trade_proposals' AND column_name = 'timeframe_context') THEN
    ALTER TABLE trade_proposals ADD COLUMN timeframe_context JSONB;
  END IF;
  
  -- Ensure reason is NOT NULL (add default if needed)
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'trade_proposals' AND column_name = 'reason' AND is_nullable = 'YES') THEN
    ALTER TABLE trade_proposals ALTER COLUMN reason SET DEFAULT '';
    UPDATE trade_proposals SET reason = '' WHERE reason IS NULL;
    ALTER TABLE trade_proposals ALTER COLUMN reason SET NOT NULL;
  END IF;
  
  -- Ensure direction is NOT NULL
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'trade_proposals' AND column_name = 'direction' AND is_nullable = 'YES') THEN
    ALTER TABLE trade_proposals ALTER COLUMN direction SET NOT NULL;
  END IF;
  
  -- Ensure stop_loss is NOT NULL
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'trade_proposals' AND column_name = 'stop_loss' AND is_nullable = 'YES') THEN
    ALTER TABLE trade_proposals ALTER COLUMN stop_loss SET NOT NULL;
  END IF;
  
  -- Ensure take_profit is NOT NULL
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'trade_proposals' AND column_name = 'take_profit' AND is_nullable = 'YES') THEN
    ALTER TABLE trade_proposals ALTER COLUMN take_profit SET NOT NULL;
  END IF;
  
  -- Ensure timeframe_context is NOT NULL
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'trade_proposals' AND column_name = 'timeframe_context' AND is_nullable = 'YES') THEN
    ALTER TABLE trade_proposals ALTER COLUMN timeframe_context SET NOT NULL;
    ALTER TABLE trade_proposals ALTER COLUMN timeframe_context SET DEFAULT '{}'::jsonb;
    UPDATE trade_proposals SET timeframe_context = '{}'::jsonb WHERE timeframe_context IS NULL;
  END IF;
END $$;

-- Update status check constraint to include 'expired'
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trade_proposals_status_check') THEN
    ALTER TABLE trade_proposals DROP CONSTRAINT trade_proposals_status_check;
  END IF;
  
  -- Add new constraint with 'expired'
  ALTER TABLE trade_proposals ADD CONSTRAINT trade_proposals_status_check 
    CHECK (status IN ('proposed', 'expired', 'executed', 'rejected'));
END $$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_trade_proposals_symbol_created 
  ON trade_proposals(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_status 
  ON trade_proposals(status);

