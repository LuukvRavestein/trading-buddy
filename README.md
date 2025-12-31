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

### Supabase Tables

1. Ga naar Supabase dashboard → **Table Editor**
2. Check de volgende tabellen:
   - `candles` - Market data (zou moeten groeien elke minuut)
   - `timeframe_state` - Computed state (trend, ATR, swings, BOS/CHoCH)
   - `trade_proposals` - Generated trade signals (✅ actief - wordt gevuld door strategy evaluator)
   - `paper_trades` - Simulated trades (nog niet actief)

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
4. Verifieer:
   - `rr` ≈ 2.0 (risk/reward ratio)
   - `entry_price` tussen `stop_loss` en `take_profit`
   - `reason` bevat HTF context + LTF trigger

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
- ⏳ **FASE 6**: Paper trading + validatie
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
