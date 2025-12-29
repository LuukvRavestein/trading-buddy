# 🚀 Quick Start Guide

Snelle start voor Trading Buddy bot.

## ⚡ 5-Minuten Setup

### 1. Deploy naar Vercel (2 min)

```bash
# In je project directory
vercel
```

Of via GitHub:
- Push naar GitHub
- Import repository in Vercel
- Deploy

### 2. Environment Variables (2 min)

Vercel Dashboard → Settings → Environment Variables:

```
DERIBIT_CLIENT_ID=je_client_id
DERIBIT_CLIENT_SECRET=je_client_secret
BOT_MODE=paper
```

**Redeploy** na het toevoegen!

### 3. Test Webhook (1 min)

```bash
curl https://jouw-app.vercel.app/api/health
# Moet teruggeven: {"status":"ok"}
```

### 4. TradingView Alert (2 min)

1. Open Pine Editor in TradingView
2. Plak code uit `pinescript/trading-buddy-strategy.pine`
3. Add to Chart
4. Rechtsklik → Add Alert
5. Condition: "Any alert() function call"
6. Webhook URL: `https://jouw-app.vercel.app/api/webhook`
7. ✅ Vink "Webhook URL" aan
8. Create

**Klaar!** 🎉

---

## 📚 Volledige Documentatie

- **Setup TradingView Alerts**: [SETUP_TRADINGVIEW_ALERTS.md](./SETUP_TRADINGVIEW_ALERTS.md)
- **Environment Variables**: [ENV_VARIABLES.md](./ENV_VARIABLES.md)

---

## 🧪 Testen

### Test Webhook Direct

```bash
curl -X POST https://jouw-app.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "signal": "LONG",
    "symbol": "BTC-PERPETUAL",
    "entry_price": 50000,
    "sl_price": 49750,
    "tp_price": 50500
  }'
```

### Check Logs

Vercel Dashboard → Deployments → Functions → `/api/webhook` → Logs

---

## ⚠️ Belangrijk

- Start altijd met `BOT_MODE=paper`
- Test eerst met kleine amounts
- Monitor Vercel logs
- Gebruik testnet voor eerste tests: `DERIBIT_USE_TESTNET=true`

