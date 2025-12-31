-- Trading Buddy Initial Schema
-- 
-- This migration creates all tables needed for the autonomous trading bot:
-- - candles: Market data (OHLCV)
-- - timeframe_state: Computed state per timeframe (trend, ATR, swing points, BOS/CHoCH)
-- - trade_proposals: Generated trade signals
-- - paper_trades: Simulated trades
-- - live_orders: Live order tracking (for future use)
--
-- Run this in Supabase SQL Editor:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Click "New query"
-- 3. Paste this entire file
-- 4. Click "Run" (or Ctrl+Enter)

-- ============================================================================
-- 1. CANDLES TABLE
-- ============================================================================
-- Stores OHLCV candle data from Deribit
CREATE TABLE IF NOT EXISTS candles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe_min INTEGER NOT NULL,  -- 1, 5, 15, 60 (minutes)
  ts TIMESTAMPTZ NOT NULL,  -- Candle open time (start of candle)
  open NUMERIC(20, 8) NOT NULL,
  high NUMERIC(20, 8) NOT NULL,
  low NUMERIC(20, 8) NOT NULL,
  close NUMERIC(20, 8) NOT NULL,
  volume NUMERIC(20, 8),
  source TEXT DEFAULT 'deribit',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one candle per symbol/timeframe/timestamp
  UNIQUE(symbol, timeframe_min, ts)
);

-- Indexes for candles
CREATE INDEX IF NOT EXISTS idx_candles_symbol_timeframe_ts 
  ON candles(symbol, timeframe_min, ts DESC);
CREATE INDEX IF NOT EXISTS idx_candles_ts 
  ON candles(ts DESC);

-- ============================================================================
-- 2. TIMEFRAME_STATE TABLE
-- ============================================================================
-- Stores computed state per timeframe (trend, ATR, swing points, BOS/CHoCH events)
CREATE TABLE IF NOT EXISTS timeframe_state (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe_min INTEGER NOT NULL,
  ts TIMESTAMPTZ NOT NULL,  -- State computed at this timestamp
  trend TEXT CHECK (trend IN ('up', 'down', 'chop')),
  atr NUMERIC(20, 8),
  last_swing_high NUMERIC(20, 8),
  last_swing_low NUMERIC(20, 8),
  last_swing_high_ts TIMESTAMPTZ,
  last_swing_low_ts TIMESTAMPTZ,
  bos_direction TEXT CHECK (bos_direction IN ('up', 'down')),
  bos_ts TIMESTAMPTZ,
  choch_direction TEXT CHECK (choch_direction IN ('up', 'down')),
  choch_ts TIMESTAMPTZ,
  metadata JSONB,  -- Additional computed fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one state per symbol/timeframe/timestamp
  UNIQUE(symbol, timeframe_min, ts)
);

-- Indexes for timeframe_state
CREATE INDEX IF NOT EXISTS idx_timeframe_state_symbol_timeframe_ts 
  ON timeframe_state(symbol, timeframe_min, ts DESC);
CREATE INDEX IF NOT EXISTS idx_timeframe_state_trend 
  ON timeframe_state(symbol, timeframe_min, trend, ts DESC);

-- ============================================================================
-- 3. TRADE_PROPOSALS TABLE
-- ============================================================================
-- Stores generated trade signals from the strategy engine
CREATE TABLE IF NOT EXISTS trade_proposals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  timeframe_entry INTEGER NOT NULL,  -- Entry timeframe (e.g., 5 minutes)
  timeframe_bias INTEGER NOT NULL,    -- Bias timeframe (e.g., 15 or 60 minutes)
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('limit', 'market')),
  entry_price NUMERIC(20, 8) NOT NULL,
  sl_price NUMERIC(20, 8) NOT NULL,
  tp_price NUMERIC(20, 8) NOT NULL,
  rr NUMERIC(10, 4) NOT NULL,  -- Risk/Reward ratio
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'rejected', 'executed', 'expired')),
  reason TEXT,  -- Rejection reason or execution notes
  metadata JSONB,  -- Additional data (zone info, setup details, etc.)
  
  -- Indexes
  created_at_idx TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for trade_proposals
CREATE INDEX IF NOT EXISTS idx_trade_proposals_status 
  ON trade_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_symbol_created 
  ON trade_proposals(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_side 
  ON trade_proposals(side, created_at DESC);

-- ============================================================================
-- 4. PAPER_TRADES TABLE
-- ============================================================================
-- Stores simulated paper trades (for validation)
CREATE TABLE IF NOT EXISTS paper_trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID REFERENCES trade_proposals(id),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  entry_price NUMERIC(20, 8),
  sl_price NUMERIC(20, 8),
  tp_price NUMERIC(20, 8),
  filled BOOLEAN DEFAULT FALSE,
  filled_ts TIMESTAMPTZ,
  exit_reason TEXT CHECK (exit_reason IN ('tp', 'sl', 'timeout', 'none', 'ambiguous')),
  exit_ts TIMESTAMPTZ,
  exit_price NUMERIC(20, 8),
  pnl_r NUMERIC(10, 4),  -- P&L in R (risk units)
  position_size_usd NUMERIC(20, 8),
  metadata JSONB,  -- Additional trade data
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for paper_trades
CREATE INDEX IF NOT EXISTS idx_paper_trades_proposal_id 
  ON paper_trades(proposal_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_filled 
  ON paper_trades(filled, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trades_exit_reason 
  ON paper_trades(exit_reason, created_at DESC);

-- ============================================================================
-- 5. LIVE_ORDERS TABLE
-- ============================================================================
-- Stores live order tracking (for future use in FASE 7)
CREATE TABLE IF NOT EXISTS live_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID REFERENCES trade_proposals(id),
  symbol TEXT NOT NULL,
  deribit_order_id TEXT,  -- Deribit order ID
  order_type TEXT CHECK (order_type IN ('entry', 'sl', 'tp')),
  status TEXT,  -- 'pending', 'filled', 'cancelled', 'rejected'
  side TEXT CHECK (side IN ('buy', 'sell')),
  amount NUMERIC(20, 8),
  price NUMERIC(20, 8),
  filled_amount NUMERIC(20, 8),
  filled_price NUMERIC(20, 8),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for live_orders
CREATE INDEX IF NOT EXISTS idx_live_orders_proposal_id 
  ON live_orders(proposal_id);
CREATE INDEX IF NOT EXISTS idx_live_orders_deribit_order_id 
  ON live_orders(deribit_order_id);
CREATE INDEX IF NOT EXISTS idx_live_orders_status 
  ON live_orders(status, created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- Enable RLS on all tables
ALTER TABLE candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeframe_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_orders ENABLE ROW LEVEL SECURITY;

-- Create policies to allow all operations for service role
-- (Since we use service_role key, these policies allow full access)
CREATE POLICY "Allow all operations for service role" ON candles
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations for service role" ON timeframe_state
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations for service role" ON trade_proposals
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations for service role" ON paper_trades
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations for service role" ON live_orders
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- DONE
-- ============================================================================
-- Migration complete!
-- You can now use these tables in your worker.

