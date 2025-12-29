# TradingView Pine Script - Trading Buddy Strategy

Dit Pine Script genereert trading signalen en stuurt ze naar de Trading Buddy webhook.

## Setup Instructies

### 1. Script toevoegen aan TradingView

1. Open TradingView en ga naar de Pine Editor
2. Kopieer de inhoud van `trading-buddy-strategy.pine`
3. Plak in de Pine Editor
4. Klik op "Save" en geef het script een naam (bijv. "Trading Buddy Strategy")
5. Klik op "Add to Chart"

### 2. Alert configureren

1. **Rechtsklik op de chart** → "Add Alert"
2. **Condition**: Selecteer "Any alert() function call"
3. **Webhook URL**: Voeg je Vercel webhook URL toe:
   ```
   https://jouw-app.vercel.app/api/webhook
   ```
4. **Message**: Laat dit leeg of gebruik de standaard payload (wordt automatisch gegenereerd door het script)
5. **Vink aan**: "Webhook URL"
6. **Alert Name**: Bijv. "Trading Buddy - BTC Signals"
7. Klik op "Create"

### 3. Webhook Secret (optioneel, aanbevolen)

Voor extra beveiliging:

1. Stel een `WEBHOOK_SECRET` in in je Vercel environment variables
2. Voer hetzelfde secret in bij de Pine Script input: "Webhook Secret"
3. Het script voegt automatisch het secret toe aan de payload

### 4. Strategy Parameters Aanpassen

In het Pine Script kun je de volgende parameters aanpassen:

- **Trend Timeframe**: Standaard 15m (voor trend bepaling)
- **Entry Timeframe**: Standaard 5m (voor entry signalen)
- **Stop Loss %**: Standaard 0.5%
- **Take Profit %**: Standaard 1.0%
- **Min Risk:Reward**: Standaard 2.0 (1:2 ratio)
- **Zone Lookback**: Aantal perioden voor zone detectie
- **Zone Strength**: Aantal touches nodig voor een zone

## Alert Payload Format

Het script stuurt de volgende JSON payload naar de webhook:

```json
{
  "signal": "LONG",
  "symbol": "BTC-PERPETUAL",
  "entry_price": 50000.00,
  "sl_price": 49750.00,
  "tp_price": 50500.00,
  "timeframe": "5",
  "time": "2024-01-15T10:30:00Z",
  "trend": "UP",
  "secret": "jouw-secret-optioneel"
}
```

## Belangrijke Velden

- `signal`: "LONG" of "SHORT"
- `symbol`: Trading symbol (wordt automatisch gedetecteerd)
- `entry_price`: Entry prijs
- `sl_price`: Stop loss prijs
- `tp_price`: Take profit prijs (optioneel, maar aanbevolen)
- `timeframe`: Huidige timeframe
- `time`: Timestamp
- `trend`: "UP", "DOWN", of "NEUTRAL"
- `secret`: Webhook secret (als geconfigureerd)

## Aanpassen van de Strategy Logica

Het huidige script bevat een **vereenvoudigde** supply/demand zone detectie. 

**Je moet dit aanpassen naar jouw specifieke strategie:**

1. Open `trading-buddy-strategy.pine`
2. Zoek naar de sectie: `// --- SUPPLY/DEMAND ZONE DETECTION ---`
3. Vervang de logica met jouw eigen zone detectie algoritme
4. Pas de entry voorwaarden aan in de sectie: `// --- ENTRY SIGNAL DETECTION ---`

## Testen

1. Gebruik eerst **paper mode** (`BOT_MODE=paper` in Vercel)
2. Test met een demo account op TradingView
3. Controleer de webhook logs in Vercel
4. Als alles werkt, schakel over naar `BOT_MODE=live`

## Troubleshooting

### Alert wordt niet verzonden
- Controleer of de webhook URL correct is
- Controleer of "Webhook URL" is aangevinkt in de alert settings
- Test de webhook URL eerst met een tool zoals `curl` of Postman

### Signal wordt niet gegenereerd
- Controleer of de trend correct wordt gedetecteerd (zie table rechtsboven)
- Pas de zone detectie parameters aan
- Controleer of de Risk:Reward ratio wordt gehaald

### Webhook ontvangt geen data
- Controleer Vercel logs
- Test de `/api/health` endpoint eerst
- Controleer of de payload format correct is (zie boven)

## Opmerkingen

- Het script gebruikt `barstate.isconfirmed` om dubbele alerts te voorkomen
- Alerts worden alleen verzonden bij bar close (confirmed bars)
- Voor backtesting kun je de strategy functies gebruiken (optioneel)
- De zone detectie is een **basis implementatie** - pas aan naar jouw strategie

