# Supabase Schema Update - AI Check Column

Als je de `ai_check` kolom nog niet hebt toegevoegd aan je Supabase database, voer deze SQL query uit:

## SQL Query

Ga naar Supabase Dashboard → SQL Editor en run:

```sql
-- Add ai_check column to trades table
ALTER TABLE trades ADD COLUMN IF NOT EXISTS ai_check JSONB;
```

## Verificatie

Check of de kolom is toegevoegd:

```sql
-- Check table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'trades' 
AND column_name = 'ai_check';
```

Je zou moeten zien:
```
column_name | data_type
------------|----------
ai_check    | jsonb
```

## Volledige Schema (als je helemaal opnieuw moet beginnen)

Als je de hele table opnieuw wilt aanmaken met alle kolommen:

```sql
-- Drop existing table (LET OP: dit verwijdert alle data!)
DROP TABLE IF EXISTS trades CASCADE;

-- Create trades table with all columns
CREATE TABLE trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  
  -- Trade execution info
  success BOOLEAN NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('paper', 'live')),
  
  -- Signal info
  signal TEXT NOT NULL CHECK (signal IN ('LONG', 'SHORT')),
  symbol TEXT NOT NULL,
  instrument TEXT,
  
  -- Price info
  entry_price NUMERIC(20, 2),
  stop_loss NUMERIC(20, 2),
  take_profit NUMERIC(20, 2),
  
  -- Position info
  side TEXT CHECK (side IN ('buy', 'sell')),
  amount INTEGER,
  position_size_usd NUMERIC(20, 2),
  
  -- Risk check info (stored as JSON)
  risk_check JSONB,
  
  -- AI check info (stored as JSON)
  ai_check JSONB,
  
  -- Order info (for live trades)
  order_id TEXT,
  
  -- Metadata
  processing_time_ms INTEGER,
  request_id TEXT,
  
  -- Indexes for faster queries
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_mode ON trades(mode);
CREATE INDEX IF NOT EXISTS idx_trades_signal ON trades(signal);
CREATE INDEX IF NOT EXISTS idx_trades_success ON trades(success);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "Allow all operations for service role" ON trades
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

**⚠️ Waarschuwing:** De DROP TABLE query verwijdert alle bestaande trades! Gebruik alleen de ALTER TABLE query als je data wilt behouden.

