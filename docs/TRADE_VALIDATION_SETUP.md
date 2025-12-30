# Trade Validation Setup - TradingView Exit Alerts

Deze feature maakt automatische validatie mogelijk van paper trades via TradingView alerts. Wanneer een trade TP of SL raakt, stuurt TradingView automatisch een alert met alle validatie data.

## Hoe het werkt

1. **Entry Alert**: Wanneer een signal wordt gegenereerd, stuurt Pine Script een `LONG` of `SHORT` alert
2. **Exit Detection**: Pine Script detecteert automatisch wanneer TP of SL wordt geraakt
3. **Exit Alert**: TradingView stuurt een `TRADE_EXIT` alert met alle exit data
4. **Auto Update**: De webhook ontvangt de exit alert en update automatisch de trade in de database

## Database Schema Update

Voeg deze kolommen toe aan je `trades` table in Supabase:

```sql
-- Add exit validation columns
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_type TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_price NUMERIC(20, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_time TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS validated BOOLEAN DEFAULT false;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS validated_by TEXT;
```

## TradingView Alert Setup

### Alert 1: Entry Signals (bestaand)
- **Condition**: `Any alert() function call` (voor LONG/SHORT signals)
- **Webhook URL**: `https://your-app.vercel.app/api/webhook`
- **Message**: Automatisch gegenereerd door Pine Script

### Alert 2: Exit Validation (nieuw)
- **Condition**: `Any alert() function call` (voor TRADE_EXIT signals)
- **Webhook URL**: `https://your-app.vercel.app/api/webhook` (zelfde URL)
- **Message**: Automatisch gegenereerd door Pine Script

**Belangrijk**: Beide alerts gebruiken dezelfde webhook URL. De webhook detecteert automatisch het type alert.

## Pine Script Features

De Pine Script detecteert nu automatisch:
- ✅ Wanneer TP wordt geraakt (voor LONG en SHORT)
- ✅ Wanneer SL wordt geraakt (voor LONG en SHORT)
- ✅ Stuurt automatisch exit alert met alle data:
  - Exit type (TAKE_PROFIT of STOP_LOSS)
  - Exit price
  - Entry price (voor matching)
  - Entry signal (LONG/SHORT)
  - Entry en exit bar indices
  - Timestamps

## Validatie Data Format

Exit alert payload:
```json
{
  "signal": "TRADE_EXIT",
  "type": "TAKE_PROFIT",  // of "STOP_LOSS"
  "symbol": "BTC-PERPETUAL",
  "entry_price": 50000,
  "sl_price": 49750,
  "tp_price": 50500,
  "exit_price": 50500,
  "entry_signal": "LONG",
  "entry_bar": 12345,
  "exit_bar": 12350,
  "timeframe": "5",
  "time": "2025-12-30T10:00:00Z",
  "secret": "your-webhook-secret"
}
```

## Voordelen

1. **Automatisch**: Geen handmatige validatie meer nodig
2. **Accuraat**: Gebruikt werkelijke TradingView marktdata
3. **Real-time**: Trades worden direct gevalideerd wanneer TP/SL wordt geraakt
4. **Betrouwbaar**: TradingView detecteert exact wanneer levels worden geraakt

## Testing

1. Wacht op een trade signal
2. Wacht tot TP of SL wordt geraakt
3. Check de database - de trade zou automatisch moeten zijn geüpdatet met exit data
4. Check het dashboard - je zou de validatie moeten zien

## Troubleshooting

### Exit alerts komen niet binnen
- Check of de Pine Script correct is geüpdatet
- Check TradingView alert logs
- Check Vercel webhook logs

### Trade wordt niet gevonden
- Check of entry_price exact overeenkomt (0.1% tolerance)
- Check of entry_signal overeenkomt
- Check of trade al een exit heeft (wordt niet opnieuw geüpdatet)

