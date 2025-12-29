# TradingView Alerts Controleren

Hoe controleer je of TradingView alerts correct binnenkomen via de webhook.

## 📊 Vercel Logs Bekijken

### Methode 1: Via Vercel Dashboard (Aanbevolen)

1. **Ga naar Vercel Dashboard**
   - https://vercel.com/dashboard
   - Selecteer je `trading-buddy` project

2. **Open Deployments**
   - Klik op "Deployments" tab
   - Klik op je laatste deployment

3. **Bekijk Functions**
   - Klik op "Functions" tab
   - Klik op `/api/webhook`
   - Je ziet nu alle logs van webhook requests

4. **Real-time Monitoring**
   - Logs worden real-time bijgewerkt
   - Elke request heeft een unieke `request_id` voor tracking

### Methode 2: Via Vercel CLI

```bash
# Installeer Vercel CLI (als je dat nog niet hebt)
npm i -g vercel

# Login
vercel login

# Bekijk logs in real-time
vercel logs trading-buddy --follow
```

## 🔍 Wat Zoeken in de Logs

### Succesvolle Alert

Je zou moeten zien:

```
[webhook] [req-xxx] New request received - Method: POST
[webhook] [req-xxx] Parsed payload: {
  "signal": "LONG",
  "symbol": "BTC-PERPETUAL",
  "entry_price": 50000,
  ...
}
[webhook] [req-xxx] Trade execution result (340ms): {
  "success": true,
  "action": "paper_trade_logged",
  ...
}
```

### Problemen Herkennen

#### ❌ "Method not allowed"
- TradingView stuurt geen POST request
- **Oplossing**: Check alert configuratie in TradingView

#### ❌ "Invalid payload format"
- Payload is geen geldige JSON
- **Oplossing**: Check Pine Script alert() format

#### ❌ "Invalid or missing signal"
- Payload mist required fields
- **Oplossing**: Check Pine Script payload structuur

#### ❌ "Invalid webhook secret"
- Secret komt niet overeen
- **Oplossing**: Check WEBHOOK_SECRET in Vercel vs Pine Script

## 🧪 Test Alert Manueel

### Test 1: Direct Webhook Test

```bash
curl -X POST https://trading-buddy.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "signal": "LONG",
    "symbol": "BTC-PERPETUAL",
    "entry_price": 50000,
    "sl_price": 49750,
    "tp_price": 50500
  }'
```

**Check logs direct na deze test** - je zou de request moeten zien.

### Test 2: TradingView Alert Test

1. **Forceer een Signal** (tijdelijk in Pine Script):
   ```pine
   // Tijdelijk: forceer een LONG signal voor testen
   if barstate.islast
       alert('{"signal":"LONG","symbol":"BTC-PERPETUAL","entry_price":50000,"sl_price":49750,"tp_price":50500}', alert.freq_once_per_bar)
   ```

2. **Wacht op Alert** - TradingView stuurt automatisch

3. **Check Vercel Logs** - binnen 1-2 seconden zou je de request moeten zien

## 📋 Checklist: Is Alert Binnengekomen?

- [ ] Vercel logs tonen `[webhook] New request received`
- [ ] Payload wordt correct geparsed
- [ ] Signal validatie slaagt
- [ ] Trade execution result is zichtbaar
- [ ] Geen error messages in logs

## 🔧 Troubleshooting

### Alert wordt niet getriggerd

1. **Check TradingView Alert Status**
   - Ga naar TradingView → Alerts
   - Check of alert "Active" is
   - Check of er recent alerts zijn getriggerd

2. **Check Pine Script**
   - Zorg dat `alert()` wordt aangeroepen
   - Check of `barstate.isconfirmed` correct werkt
   - Verify dat signalen daadwerkelijk worden gegenereerd

3. **Check Webhook URL**
   - URL moet exact zijn: `https://trading-buddy.vercel.app/api/webhook`
   - Geen trailing slash
   - "Webhook URL" moet aangevinkt zijn

### Alert wordt getriggerd maar niet ontvangen

1. **Check Vercel Logs**
   - Als je niets ziet in logs, komt request niet aan
   - Check of deployment actief is
   - Check of URL correct is

2. **Check Network**
   - TradingView moet internet toegang hebben
   - Firewall blokkeert mogelijk requests

3. **Test Direct**
   - Gebruik curl/Postman om webhook direct te testen
   - Als dat werkt, is probleem bij TradingView configuratie

## 💡 Tips

1. **Monitor Logs Continu** - Houd Vercel logs open tijdens testen
2. **Unieke Request IDs** - Elke request heeft een ID voor tracking
3. **Check Headers** - Logs tonen User-Agent (TradingView heeft specifieke user-agent)
4. **Timing** - Alerts worden verzonden bij bar close (confirmed bars)

## 📞 Hulp Nodig?

Als alerts niet binnenkomen:
1. Check Vercel logs voor error messages
2. Test webhook direct met curl
3. Verify TradingView alert configuratie
4. Check Pine Script alert() format

