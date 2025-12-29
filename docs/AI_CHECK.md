# AI Check Module

De AI Check Module gebruikt OpenAI om een "second opinion" te geven op trades voordat ze worden uitgevoerd.

## 🎯 Functionaliteit

De AI check analyseert trade proposals op basis van:
- Risk management (stop loss, position size)
- Risk:Reward ratio
- Market context en trend
- Entry timing
- Overall trade quality

## ⚙️ Setup

### Stap 1: OpenAI API Key Aanmaken

1. Ga naar [OpenAI Platform](https://platform.openai.com)
2. Maak een account aan (of log in)
3. Ga naar **API Keys** → **Create new secret key**
4. Kopieer de API key (je ziet hem maar één keer!)

### Stap 2: Environment Variables Toevoegen

In Vercel Dashboard → Settings → Environment Variables:

```
OPENAI_API_KEY=sk-...
ENABLE_AI_CHECK=true
```

**Belangrijk:** 
- `ENABLE_AI_CHECK=true` om AI check te activeren
- `ENABLE_AI_CHECK=false` of niet ingesteld = AI check uitgeschakeld

### Stap 3: Redeploy

Na het toevoegen van environment variables:
1. Redeploy je Vercel project
2. AI check is nu actief

## 🔍 Hoe Het Werkt

### Trade Flow Met AI Check

1. **TradingView Alert** → Webhook ontvangt signal
2. **Signal Validatie** → Basis validatie
3. **Risk Engine** → Risk checks (max risk, daily loss, etc.)
4. **AI Check** → OpenAI analyseert de trade (als enabled)
5. **Trade Execution** → Order wordt geplaatst (of gerejected)

### AI Check Resultaat

De AI retourneert:
```json
{
  "allow_trade": true/false,
  "reason": "Uitleg van de beslissing",
  "confidence": 0.0-1.0,
  "position_size_usd": 20000,
  "analysis": "Gedetailleerde analyse",
  "risks": ["Risico 1", "Risico 2"],
  "recommendations": ["Aanbeveling 1"]
}
```

### AI Check Rejectie

Als AI `allow_trade: false` retourneert:
- Trade wordt **niet** uitgevoerd
- Response bevat: `"action": "rejected"` met reason
- AI check details worden gelogd

## 💰 Kosten

OpenAI API kosten (bij benadering):
- **gpt-4o-mini** (standaard): ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
- Per trade check: ~$0.001-0.002 (zeer goedkoop)
- 1000 trades = ~$1-2

**Tip:** Gebruik `gpt-4o-mini` voor kosten-effectieve checks. Je kunt dit aanpassen in `core/aiCheck.js` naar `gpt-4` voor betere analyses (duurder).

## 📊 AI Check Details in Logs

Wanneer AI check actief is, zie je in Vercel logs:

```
[tradeExecutor] AI check completed
- Allow trade: true
- Confidence: 0.85
- Reason: "Good risk:reward ratio and entry timing"
```

## 🔧 Configuratie

### AI Check Uitschakelen

Zet `ENABLE_AI_CHECK=false` of verwijder de variabele. Trades worden dan uitgevoerd zonder AI check.

### Model Aanpassen

In `core/aiCheck.js`, regel ~50:
```javascript
model: 'gpt-4o-mini', // Verander naar 'gpt-4' voor betere analyses
```

### Temperature Aanpassen

Huidige setting: `temperature: 0.3` (laag = meer consistent)
- Verhoog naar `0.7` voor meer creatieve analyses
- Verlaag naar `0.1` voor zeer conservatieve checks

## 🧪 Testen

### Test Met AI Check Enabled

1. Zet `ENABLE_AI_CHECK=true` in Vercel
2. Redeploy
3. Trigger een TradingView alert
4. Check Vercel logs voor AI check resultaten

### Test Zonder AI Check

1. Zet `ENABLE_AI_CHECK=false` of verwijder variabele
2. Redeploy
3. Trades worden uitgevoerd zonder AI check

## ⚠️ Belangrijk

1. **Fail-Open**: Als AI check faalt (API error), wordt trade **toch** uitgevoerd (veiliger)
2. **Kosten**: Monitor je OpenAI usage via [OpenAI Dashboard](https://platform.openai.com/usage)
3. **Latency**: AI check voegt ~1-2 seconden toe aan trade execution tijd
4. **Rate Limits**: OpenAI heeft rate limits - bij veel trades kan dit een bottleneck worden

## 📝 Voorbeeld Response

**Goedgekeurde Trade:**
```json
{
  "allow_trade": true,
  "reason": "Strong setup with good risk:reward ratio and favorable entry timing",
  "confidence": 0.82,
  "position_size_usd": 20000,
  "analysis": "The trade aligns well with the current downtrend...",
  "risks": ["Market volatility", "Potential reversal"],
  "recommendations": ["Monitor closely", "Consider partial profit taking"]
}
```

**Afgewezen Trade:**
```json
{
  "allow_trade": false,
  "reason": "Risk:reward ratio too low and entry timing questionable",
  "confidence": 0.35,
  "position_size_usd": 20000,
  "analysis": "The stop loss is too tight relative to entry...",
  "risks": ["High risk of stop loss hit", "Poor entry timing"],
  "recommendations": ["Wait for better entry", "Consider wider stop loss"]
}
```

## 🔗 Handige Links

- **OpenAI Platform**: https://platform.openai.com
- **OpenAI Pricing**: https://openai.com/pricing
- **OpenAI API Docs**: https://platform.openai.com/docs

