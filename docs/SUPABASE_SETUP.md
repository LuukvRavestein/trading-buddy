# Supabase Database Setup

Handleiding voor het opzetten van Supabase database voor persistent trade storage.

## 📋 Stap 1: Supabase Project Aanmaken

1. Ga naar [supabase.com](https://supabase.com)
2. Maak een account aan (of log in)
3. Klik op "New Project"
4. Vul in:
   - **Name**: trading-buddy (of je eigen naam)
   - **Database Password**: Kies een sterk wachtwoord (sla dit op!)
   - **Region**: Kies dichtstbijzijnde regio
5. Klik "Create new project"
6. Wacht 1-2 minuten tot project is aangemaakt

## 📋 Stap 2: Database Schema Aanmaken

1. Ga naar je Supabase project dashboard
2. Klik op "SQL Editor" in het menu links
3. Klik op "New query"
4. Plak onderstaande SQL code:

```sql
-- Create trades table
CREATE TABLE IF NOT EXISTS trades (
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
  
  -- Order info (for live trades)
  order_id TEXT,
  
  -- AI check info (stored as JSON)
  ai_check JSONB,
  
  -- Metadata
  processing_time_ms INTEGER,
  request_id TEXT,
  
  -- Indexes for faster queries
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_mode ON trades(mode);
CREATE INDEX IF NOT EXISTS idx_trades_signal ON trades(signal);
CREATE INDEX IF NOT EXISTS idx_trades_success ON trades(success);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (for server-side use)
-- For production, you might want to restrict this
CREATE POLICY "Allow all operations for service role" ON trades
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

5. Klik "Run" (of Ctrl+Enter)
6. Je zou moeten zien: "Success. No rows returned"

## 📋 Stap 3: API Keys Ophalen

1. In Supabase dashboard, ga naar **Settings** → **API**
2. Kopieer de volgende waarden:
   - **Project URL** (bijv. `https://xxxxx.supabase.co`)
   - **anon public key** (of **service_role key** voor server-side)

## 📋 Stap 4: Environment Variables Toevoegen aan Vercel

1. Ga naar Vercel Dashboard → Je project → **Settings** → **Environment Variables**
2. Voeg toe:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Of voor server-side (aanbevolen):**

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

3. Selecteer environments:
   - ✅ Production
   - ✅ Preview
   - ✅ Development (optioneel)

4. **Redeploy** je project (belangrijk!)

## 📋 Stap 5: Testen

Na redeploy, test of Supabase werkt:

1. Test de webhook met een trade:
```bash
curl -X POST https://trading-buddy.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"signal":"LONG","symbol":"BTC-PERPETUAL","entry_price":50000,"sl_price":49750,"tp_price":50500}'
```

2. Check het dashboard:
   - Ga naar: `https://trading-buddy.vercel.app/api/dashboard`
   - Je zou de trade moeten zien

3. Check Supabase:
   - Ga naar Supabase dashboard → **Table Editor**
   - Klik op `trades` table
   - Je zou de trade moeten zien

## 🔒 Security Best Practices

### Option 1: Service Role Key (Aanbevolen voor Server-Side)
- Gebruik `SUPABASE_SERVICE_ROLE_KEY` in Vercel
- Bypass RLS policies
- Alleen voor server-side code (niet in frontend!)

### Option 2: Anon Key met RLS Policies
- Gebruik `SUPABASE_ANON_KEY`
- Configureer RLS policies voor security
- Meer secure, maar complexer

## 🐛 Troubleshooting

### "Supabase not configured" in logs
- Check of environment variables zijn ingesteld
- Check of je hebt geredeployed na het toevoegen van vars
- Check of variabelen correct zijn (geen extra spaties)

### "Failed to insert trade"
- Check Supabase logs (Dashboard → Logs)
- Check of table bestaat (SQL Editor → Run: `SELECT * FROM trades LIMIT 1;`)
- Check RLS policies

### Trades worden niet opgeslagen
- Check Vercel logs voor errors
- Verify Supabase credentials
- Test direct in Supabase SQL Editor

## 📊 Database Queries (Handig)

### Alle trades bekijken
```sql
SELECT * FROM trades ORDER BY timestamp DESC LIMIT 100;
```

### Statistieken
```sql
SELECT 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE mode = 'paper') as paper,
  COUNT(*) FILTER (WHERE mode = 'live') as live,
  COUNT(*) FILTER (WHERE signal = 'LONG') as long_signals,
  COUNT(*) FILTER (WHERE signal = 'SHORT') as short_signals,
  COUNT(*) FILTER (WHERE success = true) as successful,
  COUNT(*) FILTER (WHERE success = false) as rejected
FROM trades;
```

### Recente trades
```sql
SELECT * FROM trades 
WHERE timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;
```

## 💡 Tips

1. **Backup**: Supabase maakt automatisch backups, maar je kunt ook handmatig exporteren
2. **Monitoring**: Gebruik Supabase dashboard om queries te monitoren
3. **Performance**: Indexes zijn al aangemaakt voor snelle queries
4. **Scaling**: Supabase schaalt automatisch mee

## 🔗 Handige Links

- **Supabase Dashboard**: https://supabase.com/dashboard
- **Supabase Docs**: https://supabase.com/docs
- **SQL Editor**: In Supabase dashboard → SQL Editor

