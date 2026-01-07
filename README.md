# Trading Buddy - Autonomous Bitcoin Daytrading Bot

Volledig cloud-only Bitcoin daytrading bot die autonoom draait op Render Background Worker. Geen afhankelijkheid van TradingView alerts - alles wordt gedaan via Deribit API en Supabase.

## 🏗️ Architectuur

De bot bestaat uit 5 lagen:
1. **Market Data Ingest** - Haalt candles op van Deribit
2. **Timeframe State Builder** - Berekent trend, ATR, swing points, BOS/CHoCH
3. **Strategy Engine** - Genereert trade signals
4. **Risk Engine** - Valideert en filtert trades
5. **Execution Engine** - Simuleert paper trades of plaatst live orders

## 🚀 Setup

### 1. Supabase Database Setup

1. Ga naar [supabase.com](https://supabase.com) en maak een project aan
2. Ga naar **SQL Editor** in het Supabase dashboard
3. Klik op **New query**
4. Open het bestand `supabase/migrations/001_initial_schema.sql`
5. Kopieer de volledige SQL code en plak deze in de SQL Editor
6. Klik **Run** (of Ctrl+Enter)
7. Je zou moeten zien: "Success. No rows returned"
8. **Voor State Builder**: Run ook `supabase/migrations/002_update_timeframe_state.sql` om de `timeframe_state` tabel te updaten
9. **Voor Strategy Evaluator**: Run ook `supabase/migrations/003_update_trade_proposals.sql` om de `trade_proposals` tabel te updaten
10. **Voor Paper Performance Engine**: Run ook `supabase/migrations/004_paper_performance.sql` om paper trading te activeren
11. **Voor Backtest Engine**: Run ook `supabase/migrations/005_backtest_tables.sql` om backtest tabellen aan te maken
    - Dit creëert `strategy_runs` en `strategy_trades` tabellen met RLS policies

### 2. Supabase API Keys

1. In Supabase dashboard, ga naar **Settings** → **API**
2. Kopieer:
   - **Project URL** (bijv. `https://xxxxx.supabase.co`)
   - **service_role key** (⚠️ **NIET** de anon key - we hebben service_role nodig!)

### 3. Deribit API Keys

1. Ga naar [Deribit](https://www.deribit.com) (of testnet: [test.deribit.com](https://test.deribit.com))
2. Ga naar **Account** → **API** → **Add API Key**
3. Maak een nieuwe API key aan met de volgende permissions:
   - `read` (voor market data)
   - `trade` (voor live trading - alleen nodig in live mode)
4. Kopieer:
   - **Client ID**
   - **Client Secret**

### 4. Render Background Worker Setup

1. Ga naar [render.com](https://render.com) en maak een account aan
2. Klik op **New** → **Background Worker**
3. Verbind je GitHub repository
4. Configureer:
   - **Name**: `trading-buddy-worker`
   - **Environment**: `Node`
   - **Build Command**: (leeg laten - geen build nodig)
   - **Start Command**: `npm start`
   - **Plan**: Free tier is voldoende voor testing

5. Voeg **Environment Variables** toe:

```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Deribit
DERIBIT_CLIENT_ID=your_client_id
DERIBIT_CLIENT_SECRET=your_client_secret
DERIBIT_ENV=live  # 'live' voor mainnet (aanbevolen), 'test' voor testnet

# Bot Configuration
BOT_MODE=paper  # of 'live' voor live trading
SYMBOL=BTC-PERPETUAL
TIMEFRAMES=1,5,15,60  # minuten
POLL_INTERVAL_SECONDS=60

# Risk Management
MAX_RISK_PERCENT=1
MAX_DAILY_LOSS_PERCENT=3
MAX_TRADES_PER_DAY=5
MAX_SL_PCT=0.6
MIN_RR=2

# Strategy Configuration
MIN_RISK_PCT=0.1  # Minimum risk percentage (0.1%)
TARGET_RR=2.0  # Target risk/reward ratio
ATR_SL_MULTIPLIER=0.2  # ATR multiplier for stop loss buffer
PROPOSAL_DUPLICATE_WINDOW_MIN=10  # Minutes to prevent duplicate proposals

# Paper Trading Configuration
PROPOSAL_TTL_MIN=10  # Minutes before proposal expires
INTRABAR_TIEBREAK=worst  # 'worst' or 'best' when TP/SL hit in same candle
PAPER_MAX_LOOKAHEAD_CANDLES=2000  # Max candles to scan for exits
PAPER_STATS_ENABLED=1  # Enable daily stats calculation (1 or 0)

# Logging
LOG_LEVEL=info  # debug, info, warn, error
```

6. Klik **Create Background Worker**
7. De worker start automatisch na deployment

## 📊 Monitoring

### Render Logs

1. Ga naar je Render dashboard
2. Klik op je Background Worker
3. Ga naar **Logs** tab
4. Je zou elke minuut "Worker alive" moeten zien
5. **State Builder logs**: Zoek naar "State updated for Xm" logs, bijvoorbeeld:
   ```json
   {
     "timestamp": "2025-01-01T12:00:00.000Z",
     "level": "info",
     "message": "State updated for 15m",
     "timeframe": 15,
     "ts": "2025-01-01T12:00:00.000Z",
     "trend": "up",
     "atr": "1234.5678",
     "swingHigh": "87650.5",
     "swingLow": "87420.3",
     "bos": "up",
     "choch": null,
     "candlesProcessed": 200
   }
   ```
6. **Strategy Evaluator logs**: Zoek naar "Proposal created" of "No setup found", bijvoorbeeld:
   ```json
   {
     "timestamp": "2025-01-01T12:00:00.000Z",
     "level": "info",
     "message": "Proposal created",
     "direction": "long",
     "entry": "87650.5",
     "sl": "87420.3",
     "tp": "88110.9",
     "rr": "2.0",
     "reason": "UP 15m + UP 5m + 1m CHoCH long"
   }
   ```
7. **Paper Engine logs**: Zoek naar "Paper engine results", bijvoorbeeld:
   ```json
   {
     "timestamp": "2025-01-01T12:00:00.000Z",
     "level": "info",
     "message": "Paper engine results",
     "executed": 1,
     "closed": 2,
     "expired": 0,
     "errors": 0
   }
   ```

### Supabase Tables

1. Ga naar Supabase dashboard → **Table Editor**
2. Check de volgende tabellen:
   - `candles` - Market data (zou moeten groeien elke minuut)
   - `timeframe_state` - Computed state (trend, ATR, swings, BOS/CHoCH)
   - `trade_proposals` - Generated trade signals + paper execution (✅ actief)
   - `paper_stats_daily` - Daily performance statistics (✅ actief)

#### Verifiëren dat timeframe_state wordt geüpdatet:

1. Ga naar Supabase → **Table Editor** → `timeframe_state`
2. Je zou rijen moeten zien voor elke timeframe (1, 5, 15, 60 minuten)
3. Check de `ts` kolom - deze zou recent moeten zijn (binnen laatste minuut)
4. Check de `trend` kolom - zou 'up', 'down', of 'chop' moeten zijn
5. Check de `atr` kolom - zou een numerieke waarde moeten hebben (of null als onvoldoende data)
6. Query voor laatste state per timeframe:
   ```sql
   SELECT symbol, timeframe_min, ts, trend, atr, last_swing_high, last_swing_low, bos_direction, choch_direction
   FROM timeframe_state
   WHERE symbol = 'BTC-PERPETUAL'
   ORDER BY timeframe_min, ts DESC;
   ```

#### Verifiëren dat trade_proposals wordt gevuld:

1. Ga naar Supabase → **Table Editor** → `trade_proposals`
2. Je zou rijen moeten zien wanneer:
   - HTF trends aligneren (15m + 5m beide up voor long, beide down voor short)
   - LTF trigger firet (1m CHoCH of BOS in dezelfde richting)
3. Check proposal details:
   ```sql
   SELECT 
     direction,
     entry_price,
     stop_loss,
     take_profit,
     rr,
     reason,
     created_at
   FROM trade_proposals
   WHERE symbol = 'BTC-PERPETUAL'
   ORDER BY created_at DESC
   LIMIT 10;
   ```

#### Verifiëren dat paper trades worden uitgevoerd en gesloten:

1. Ga naar Supabase → **Table Editor** → `trade_proposals`
2. Check executed + closed trades:
   ```sql
   SELECT 
     status,
     direction,
     entry_fill_price,
     stop_loss,
     take_profit,
     pnl_pct,
     exit_reason,
     created_at,
     entry_fill_ts,
     exit_ts
   FROM trade_proposals
   WHERE symbol = 'BTC-PERPETUAL'
   ORDER BY created_at DESC
   LIMIT 50;
   ```
3. Je zou moeten zien:
   - `status` = 'executed' voor open trades
   - `status` = 'closed_tp' of 'closed_sl' voor gesloten trades
   - `entry_fill_price` en `entry_fill_ts` voor executed trades
   - `exit_price`, `exit_ts`, `pnl_pct` voor closed trades

#### Verifiëren daily stats:

1. Ga naar Supabase → **Table Editor** → `paper_stats_daily`
2. Check daily performance:
   ```sql
   SELECT 
     date,
     trades,
     wins,
     losses,
     winrate,
     pnl_pct,
     expectancy
   FROM paper_stats_daily
   WHERE symbol = 'BTC-PERPETUAL'
   ORDER BY date DESC
   LIMIT 30;
   ```
3. Je zou moeten zien:
   - `trades` = aantal gesloten trades per dag
   - `winrate` = percentage winning trades
   - `pnl_pct` = totale P&L percentage
   - `expectancy` = gemiddelde P&L per trade
4. Verifieer:
   - `rr` ≈ 2.0 (risk/reward ratio)
   - `entry_price` tussen `stop_loss` en `take_profit`
   - `reason` bevat HTF context + LTF trigger

## 🧪 Backtesting & Optimization

### Running Backtests

De bot heeft een ingebouwde backtest engine die historische data gebruikt om strategie varianten te testen en te optimaliseren.

#### 1. Database Setup

Zorg dat je de backtest tabellen hebt aangemaakt:
```sql
-- Run in Supabase SQL Editor
-- File: supabase/migrations/005_backtest_tables.sql
```

#### 2. Configure Backtest Mode

In Render, voeg de volgende environment variables toe:

```
BACKTEST_MODE=1
BACKTEST_START_TS=2025-12-01T00:00:00Z
BACKTEST_END_TS=2025-12-31T23:59:59Z
SYMBOL=BTC-PERPETUAL
DD_LIMIT=10  # Max drawdown % (default: 10)
```

#### 3. Run Backtest

1. Deploy de worker met `BACKTEST_MODE=1`
2. De worker zal:
   - Alle configuratie varianten testen (grid search)
   - Elke variant backtesten over de opgegeven periode
   - Resultaten opslaan in `strategy_runs` en `strategy_trades` tabellen
   - Top 10 configuraties loggen met metrics
3. Na voltooiing stopt de worker automatisch

#### 4. View Results

**In Supabase SQL Editor:**

```sql
-- Verify strategy_runs table exists and has data
SELECT 
  id,
  symbol,
  start_ts,
  end_ts,
  status,
  created_at,
  completed_at,
  results->>'trades' as trades,
  results->>'winrate' as winrate,
  results->>'total_pnl_pct' as pnl_pct,
  results->>'max_drawdown_pct' as drawdown_pct,
  results->>'profit_factor' as profit_factor,
  results->>'expectancy_pct' as expectancy_pct,
  config
FROM strategy_runs
ORDER BY created_at DESC
LIMIT 20;

-- Top 10 runs by expectancy score
SELECT 
  id,
  symbol,
  start_ts,
  end_ts,
  status,
  results->>'trades' as trades,
  results->>'winrate' as winrate,
  results->>'total_pnl_pct' as pnl_pct,
  results->>'max_drawdown_pct' as drawdown_pct,
  results->>'profit_factor' as profit_factor,
  results->>'expectancy_pct' as expectancy_pct,
  config
FROM strategy_runs
WHERE status = 'done'
ORDER BY (results->>'expectancy_pct')::numeric DESC
LIMIT 10;

-- Verify strategy_trades table exists and has data
SELECT 
  id,
  run_id,
  symbol,
  direction,
  entry_ts,
  entry_price,
  stop_loss,
  take_profit,
  exit_ts,
  exit_price,
  exit_reason,
  pnl_pct,
  mfe,
  mae
FROM strategy_trades
ORDER BY entry_ts DESC
LIMIT 20;

-- Trades for a specific run
SELECT 
  direction,
  entry_ts,
  entry_price,
  stop_loss,
  take_profit,
  exit_ts,
  exit_price,
  exit_reason,
  pnl_pct,
  mfe,
  mae
FROM strategy_trades
WHERE run_id = 'YOUR_RUN_ID'
ORDER BY entry_ts;

-- Count trades per run
SELECT 
  run_id,
  COUNT(*) as trade_count,
  SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN pnl_pct < 0 THEN 1 ELSE 0 END) as losses,
  AVG(pnl_pct) as avg_pnl_pct,
  SUM(pnl_pct) as total_pnl_pct
FROM strategy_trades
GROUP BY run_id
ORDER BY total_pnl_pct DESC;
```

#### 5. Backtest Metrics

Elke backtest berekent:
- **trades**: Aantal trades
- **winrate**: Win percentage
- **total_pnl_pct**: Totale PnL percentage
- **avg_pnl_pct**: Gemiddelde PnL per trade
- **expectancy_pct**: Expectancy (primary ranking metric)
- **max_drawdown_pct**: Maximale drawdown
- **profit_factor**: Gross profit / Gross loss
- **avg_trade_duration_min**: Gemiddelde trade duur in minuten

#### 6. Strategy Parameters

De optimizer test verschillende combinaties van:
- **Regime**: `require_5m_align`, `require_60m_align`
- **Entry**: `entry_trigger` ('choch', 'bos', 'either')
- **Exits**: `rr_target` (1.5, 2.0, 2.5), `timeout_min` (0, 30, 45)
- **Risk**: `sl_atr_buffer` (0.2, 0.3), `min_risk_pct` (0.001, 0.0015)
- **Costs**: `taker_fee_bps` (default 5), `slippage_bps` (default 2)

#### 7. Normal Mode

Om terug te gaan naar normale live/paper trading mode:
- Verwijder `BACKTEST_MODE` environment variable of zet `BACKTEST_MODE=0`
- De worker zal dan normaal draaien

## 📊 Paper Trading Runner

De bot heeft een live paper trading runner die meerdere strategy configs parallel kan evalueren op Deribit BTC-PERPETUAL op basis van live candle data. De runner simuleert trades per config en slaat resultaten op in Supabase.

### Database Setup

Zorg dat je de paper trading tabellen hebt aangemaakt:

```sql
-- Run in Supabase SQL Editor
-- File: supabase/migrations/008_paper_trading.sql
```

Dit creëert de volgende tabellen:
- `paper_runs` - Paper run records
- `paper_configs` - Strategy configs per run (van optimizer of manual)
- `paper_accounts` - Account state per config (balance, equity, open position)
- `paper_trades` - Simulated trades
- `paper_equity_snapshots` - Equity snapshots over tijd
- `paper_events` - Event log

### Configure Paper Trading Runner

In Render, voeg de volgende environment variables toe:

```bash
# Required
PAPER_OPTIMIZER_RUN_ID=<uuid>  # Optimizer run ID om configs van te laden

# Optional
SYMBOL=BTC-PERPETUAL
PAPER_TIMEFRAME_MIN=1
PAPER_BALANCE_START=1000
PAPER_TOP_N=10  # Aantal top configs om te laden
PAPER_POLL_SECONDS=15  # Poll interval in seconden

# Kill rules
PAPER_MIN_TRADES_BEFORE_KILL=50  # Min trades voordat kill rules actief worden
PAPER_KILL_MAX_DD_PCT=12  # Max drawdown % om te killen
PAPER_KILL_MIN_PF=0.8  # Min profit factor om te houden
PAPER_KILL_MIN_PNL_PCT=-2  # Min P&L % om te houden

# Optional: Discord notifications
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Run Paper Trading Runner

1. Deploy de worker met `PAPER_OPTIMIZER_RUN_ID` gezet
2. Set **Start Command**: `node src/jobs/paperTradeRunner.mjs`
3. De runner zal:
   - Een `paper_run` aanmaken
   - Top N configs laden uit `optimizer_run_top_configs`
   - `paper_accounts` aanmaken voor elke config
   - Live candles lezen uit de `candles` tabel
   - Per candle: strategy evalueren, trades openen/sluiten, equity updaten
   - Kill rules toepassen na minimum aantal trades
   - Equity snapshots opslaan
4. De runner stopt automatisch als alle configs gekilled zijn

### Monitoring

**In Supabase SQL Editor:**

```sql
-- Check active paper runs
SELECT * FROM paper_runs WHERE status = 'running' ORDER BY started_at DESC;

-- Check active accounts
SELECT 
  pc.rank,
  pa.equity,
  pa.balance,
  pa.trades_count,
  pa.wins_count,
  pa.losses_count,
  pa.max_drawdown_pct,
  pa.profit_factor,
  pa.last_candle_ts
FROM paper_accounts pa
JOIN paper_configs pc ON pa.paper_config_id = pc.id
WHERE pa.run_id = '<run_id>' AND pc.is_active = true
ORDER BY pa.equity DESC;

-- Check recent trades
SELECT 
  pc.rank,
  pt.side,
  pt.entry,
  pt.exit,
  pt.pnl_pct,
  pt.result,
  pt.opened_ts,
  pt.closed_ts
FROM paper_trades pt
JOIN paper_configs pc ON pt.paper_config_id = pc.id
WHERE pt.run_id = '<run_id>'
ORDER BY pt.opened_ts DESC
LIMIT 50;

-- Check equity curve
SELECT 
  pc.rank,
  pes.ts,
  pes.equity,
  pes.dd_pct
FROM paper_equity_snapshots pes
JOIN paper_configs pc ON pes.paper_config_id = pc.id
WHERE pes.run_id = '<run_id>'
ORDER BY pc.rank, pes.ts ASC;
```

### Kill Rules

De runner past automatisch kill rules toe na `PAPER_MIN_TRADES_BEFORE_KILL` trades:
- **Max Drawdown**: Als `max_drawdown_pct > PAPER_KILL_MAX_DD_PCT`, wordt de config gekilled
- **Profit Factor**: Als `profit_factor < PAPER_KILL_MIN_PF`, wordt de config gekilled
- **P&L %**: Als `(balance - balance_start) / balance_start * 100 < PAPER_KILL_MIN_PNL_PCT`, wordt de config gekilled

Gekilled configs krijgen `is_active=false` en een `kill_reason` in de `paper_configs` tabel.

### Idempotency

De runner is idempotent:
- Gebruikt `last_candle_ts` per account als checkpoint
- Unique constraints voorkomen duplicate trades/snapshots
- Bij herstart hervat de runner vanaf het laatste checkpoint

## 📥 Candle Ingest

De bot heeft een robuuste candle ingest oplossing om historische candles van Deribit naar Supabase te halen. Dit is handig voor:
- **One-time backfill**: Vul historische data aan (bijv. na een periode zonder data)
- **Continuous ingest**: Houd candles up-to-date door automatisch nieuwe data te fetchen

### Candle Ingest Job

De `src/jobs/candleIngest.mjs` module biedt een standalone script om candles te fetchen en op te slaan.

#### 1. One-Time Backfill

Voor eenmalige backfill van historische data:

```bash
# Set environment variables
export SYMBOL=BTC-PERPETUAL
export BACKFILL=true
export BACKFILL_START_TS=2026-01-02T00:00:00Z
export BACKFILL_END_TS=2026-01-14T23:59:00Z

# Run ingest
node src/jobs/candleIngest.mjs
```

Dit zal:
- Alle timeframes (1m, 5m, 15m, 60m) backfillen
- Timestamps correct afronden naar timeframe boundaries
- Candles upserten in Supabase (geen duplicates)
- Duidelijke logging per timeframe

#### 2. Continuous Ingest

Voor doorlopende ingest (automatisch vanaf laatste candle in DB):

```bash
# Set environment variables
export SYMBOL=BTC-PERPETUAL
export BACKFILL=false  # of weglaten

# Run ingest
node src/jobs/candleIngest.mjs
```

Dit zal:
- Per timeframe de laatste candle in DB bepalen
- Nieuwe candles fetchen vanaf de volgende candle tot nu
- Automatisch timestamps afronden naar timeframe boundaries

#### 3. Dry Run Mode

Test zonder daadwerkelijk naar de database te schrijven:

```bash
export DRY_RUN=true
node src/jobs/candleIngest.mjs
```

#### 4. Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SYMBOL` | Symbol to ingest | `BTC-PERPETUAL` | No |
| `BACKFILL` | Enable backfill mode | `false` | No |
| `BACKFILL_START_TS` | Start timestamp (ISO) | - | Yes if `BACKFILL=true` |
| `BACKFILL_END_TS` | End timestamp (ISO) | - | Yes if `BACKFILL=true` |
| `DRY_RUN` | Skip DB writes | `false` | No |

#### 5. Logging

De ingest job logt per timeframe:
- Aantal opgehaalde candles
- Eerste en laatste timestamp
- Aantal inserts/upserts
- Duur van de operatie

Voorbeeld output:
```
[ingest][1m] ✓ Ingested candles: fetched=1440, inserted=1440, range=2026-01-02T00:00:00.000Z -> 2026-01-02T23:59:00.000Z
[ingest][5m] ✓ Ingested candles: fetched=288, inserted=288, range=2026-01-02T00:00:00.000Z -> 2026-01-02T23:55:00.000Z
[ingest][15m] ✓ Ingested candles: fetched=96, inserted=96, range=2026-01-02T00:00:00.000Z -> 2026-01-02T23:45:00.000Z
[ingest][60m] ✓ Ingested candles: fetched=24, inserted=24, range=2026-01-02T00:00:00.000Z -> 2026-01-02T23:00:00.000Z
```

#### 6. Timestamp Rounding

Alle timestamps worden automatisch afgerond naar timeframe boundaries:
- **1m**: Rondt af naar minuut (bijv. `12:34:56` → `12:34:00`)
- **5m**: Rondt af naar 5-minuut boundary (bijv. `12:37:00` → `12:35:00`)
- **15m**: Rondt af naar 15-minuut boundary (bijv. `12:37:00` → `12:30:00`)
- **60m**: Rondt af naar uur boundary (bijv. `12:37:00` → `12:00:00`)

Dit zorgt voor consistentie met de database constraints.

#### 7. Error Handling

- **Per timeframe failures**: Als één timeframe faalt, blijven andere timeframes doorgaan
- **Rate limiting**: Automatische delays tussen API calls
- **Duplicate prevention**: Upsert gebruikt `ON CONFLICT` op `(symbol, timeframe_min, ts)`
- **Validation**: Timestamps worden gevalideerd (jaar 2009-2100)

#### 8. Integration with Render

Je kunt de ingest job draaien als een eenmalige job in Render:

1. Maak een **Background Worker** in Render
2. Set environment variables
3. Set **Start Command**: `node src/jobs/candleIngest.mjs`
4. De worker stopt automatisch na voltooiing

Of gebruik een **Cron Job** in Render om periodiek te draaien voor continuous ingest.

## 🔧 Development

### Syntax Check

```bash
npm run check:syntax
```

Dit controleert of alle `.mjs` bestanden syntactisch correct zijn.

### State Builder Testen

Test de state builder met een dev script:

```bash
# Test state builder voor 15m timeframe met laatste 200 candles
node scripts/dev_state_check.mjs 15 200

# Test andere timeframe
node scripts/dev_state_check.mjs 60 500
```

Dit laadt candles uit Supabase en print de computed state.

### Lokaal testen (optioneel)

```bash
# Install dependencies (als je die nodig hebt)
npm install

# Set environment variables
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
# ... etc

# Run worker
npm start
```

**Let op**: De worker is ontworpen om 24/7 te draaien. Voor lokale testing kun je Ctrl+C gebruiken om te stoppen.

## 📝 Fases

Het project is opgebouwd in fases:

- ✅ **FASE 0**: Werkende Worker (heartbeat)
- ✅ **FASE 1**: Supabase schema + client
- ✅ **FASE 2**: Deribit API client (candles)
- ✅ **FASE 3**: Ingest loop (candles → supabase)
- ✅ **FASE 4**: State builder (trend/ATR/swing/BOS/CHoCH)
- ✅ **FASE 5**: Strategy evaluator (setup detectie + trade proposals)
- ✅ **FASE 6**: Paper performance engine (execution, monitoring, stats)
- ⏳ **FASE 7**: Live execution

## 🔒 Security

- **Service Role Key**: Gebruik ALTIJD `SUPABASE_SERVICE_ROLE_KEY` (niet anon key) voor server-side
- **API Keys**: Bewaar nooit API keys in code - gebruik altijd environment variables
- **Paper Mode First**: Start altijd met `BOT_MODE=paper` voor testing, zelfs met live Deribit API
- **Deribit Environment**: Gebruik `DERIBIT_ENV=live` voor mainnet (aanbevolen) of `test` voor testnet

## 📚 Documentatie

- [Deribit API Docs](https://docs.deribit.com/)
- [Supabase Docs](https://supabase.com/docs)
- [Render Docs](https://render.com/docs)

## 🐛 Troubleshooting

### Worker start niet
- Check Render logs voor errors
- Verify alle environment variables zijn gezet
- Check of `npm start` correct is (moet `node worker.js` zijn)

### Supabase errors
- Verify `SUPABASE_SERVICE_ROLE_KEY` is gebruikt (niet anon key)
- Check of de SQL migration is uitgevoerd
- Verify RLS policies zijn correct ingesteld

### Deribit errors
- Check of API keys correct zijn
- Verify `DERIBIT_ENV` is correct (`test` of `live`)
- Check Deribit API status

## 📄 License

MIT
