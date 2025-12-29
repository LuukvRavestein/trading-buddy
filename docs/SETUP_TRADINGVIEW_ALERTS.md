# TradingView Alerts naar Vercel - Stap voor Stap Handleiding

Deze handleiding helpt je om TradingView alerts te configureren die naar je Vercel webhook sturen.

## 📋 Overzicht

1. **Vercel Deployment** - Deploy je code naar Vercel
2. **Webhook URL Bepalen** - Vind je webhook endpoint URL
3. **Environment Variables** - Configureer secrets en API keys
4. **TradingView Alert Configureren** - Stel de alert in
5. **Testen** - Test de volledige flow

---

## Stap 1: Vercel Deployment

### 1.1. Vercel Account & Project

1. Ga naar [vercel.com](https://vercel.com) en log in (of maak account aan)
2. Klik op **"Add New Project"**
3. **Import Git Repository**: Kies je `trading-buddy` GitHub repository
4. Klik op **"Import"**

### 1.2. Project Settings

1. **Framework Preset**: Laat op "Other" (of "Vercel" als optie)
2. **Root Directory**: Laat leeg (of `./` als je in subdirectory zit)
3. **Build Command**: Laat leeg (Vercel detecteert automatisch)
4. **Output Directory**: Laat leeg
5. Klik op **"Deploy"**

### 1.3. Wacht op Deployment

- Vercel bouwt en deployt je project
- Dit duurt meestal 1-2 minuten
- Je ziet een URL zoals: `https://trading-buddy-xyz.vercel.app`

---

## Stap 2: Webhook URL Bepalen

### 2.1. Vind je Vercel URL

Na deployment krijg je een URL zoals:
```
https://jouw-project-naam.vercel.app
```

### 2.2. Webhook Endpoint

Je webhook endpoint is:
```
https://jouw-project-naam.vercel.app/api/webhook
```

**Voorbeeld:**
```
https://trading-buddy-abc123.vercel.app/api/webhook
```

### 2.3. Test de Health Endpoint (optioneel)

Test eerst of je deployment werkt:
```
https://jouw-project-naam.vercel.app/api/health
```

Je zou moeten zien: `{"status":"ok"}`

---

## Stap 3: Environment Variables Configureren

### 3.1. Ga naar Vercel Project Settings

1. In je Vercel dashboard, klik op je project
2. Ga naar **"Settings"** tab
3. Klik op **"Environment Variables"** in het menu links

### 3.2. Voeg Environment Variables Toe

Klik op **"Add New"** en voeg de volgende variabelen toe:

#### Verplicht:
```
DERIBIT_CLIENT_ID = je_deribit_client_id
DERIBIT_CLIENT_SECRET = je_deribit_client_secret
BOT_MODE = paper
```

#### Optioneel (aanbevolen):
```
WEBHOOK_SECRET = een_willekeurig_geheim_woord
DERIBIT_USE_TESTNET = false
MAX_RISK_PERCENT = 1
MAX_DAILY_LOSS_PERCENT = 3
MAX_TRADES_PER_DAY = 5
```

### 3.3. Environment Selecteren

Voor elke variabele, selecteer:
- ✅ **Production**
- ✅ **Preview** (optioneel)
- ✅ **Development** (optioneel)

### 3.4. Redeploy

Na het toevoegen van environment variables:
1. Ga naar **"Deployments"** tab
2. Klik op de **"..."** (drie puntjes) naast je laatste deployment
3. Klik op **"Redeploy"**
4. Wacht tot deployment klaar is

**Belangrijk:** Environment variables worden alleen geladen bij deployment. Je moet redeployen na het toevoegen van nieuwe variabelen!

---

## Stap 4: TradingView Alert Configureren

### 4.1. Pine Script Toevoegen aan Chart

1. Open TradingView
2. Ga naar **Pine Editor** (onderaan scherm)
3. Open het bestand: `pinescript/trading-buddy-strategy.pine`
4. Kopieer de volledige code
5. Plak in Pine Editor
6. Klik op **"Save"** (geef het een naam)
7. Klik op **"Add to Chart"**

### 4.2. Chart Instellen

- **Symbol**: BTC-PERPETUAL (of je gewenste instrument)
- **Timeframe**: 5m (voor entry signalen)
- Het script detecteert automatisch de 15m trend

### 4.3. Alert Aanmaken

1. **Rechtsklik op de chart** → **"Add Alert"**

2. **Alert Settings:**

   **Condition:**
   - Selecteer: **"Any alert() function call"**
   - Dit triggert wanneer het Pine Script een `alert()` aanroept

   **Webhook URL:**
   - Plak je Vercel webhook URL:
     ```
     https://jouw-project-naam.vercel.app/api/webhook
     ```
   - ✅ **Vink aan**: "Webhook URL"

   **Message (optioneel):**
   - Laat dit **leeg** of gebruik de standaard
   - Het Pine Script genereert automatisch de JSON payload

   **Alert Name:**
   - Bijv: "Trading Buddy - BTC Signals"

   **Expiration:**
   - Kies "No expiration" of stel een datum in

3. Klik op **"Create"**

### 4.4. Webhook Secret (optioneel, aanbevolen)

Als je `WEBHOOK_SECRET` hebt ingesteld in Vercel:

1. Open je Pine Script in de editor
2. Zoek naar de input: `webhookSecret = input.string(...)`
3. Voer hetzelfde secret in dat je in Vercel hebt ingesteld
4. Klik op **"Save"** en **"Add to Chart"** opnieuw

---

## Stap 5: Testen

### 5.1. Test de Webhook Direct

Je kunt de webhook testen met `curl` of een tool zoals Postman:

```bash
curl -X POST https://jouw-project-naam.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "signal": "LONG",
    "symbol": "BTC-PERPETUAL",
    "entry_price": 50000,
    "sl_price": 49750,
    "tp_price": 50500
  }'
```

**Verwacht antwoord:**
```json
{
  "status": "ok",
  "action": "paper_trade_logged",
  "reason": "Trade executed in paper mode (logged only)",
  "mode": "paper",
  ...
}
```

### 5.2. Test vanuit TradingView

1. Wacht tot je Pine Script een signal genereert
2. Of forceer een test door de code tijdelijk aan te passen
3. Check de Vercel logs:
   - Ga naar Vercel dashboard
   - Klik op je project → **"Deployments"**
   - Klik op je deployment → **"Functions"** tab
   - Klik op `/api/webhook` → Zie logs

### 5.3. Check Vercel Logs

**Real-time logs bekijken:**
1. Vercel dashboard → Je project
2. **"Deployments"** tab
3. Klik op je laatste deployment
4. **"Functions"** tab
5. Klik op `/api/webhook`
6. Je ziet real-time logs van alle webhook requests

**Of via Vercel CLI:**
```bash
vercel logs --follow
```

### 5.4. Veelvoorkomende Problemen

#### ❌ "Invalid webhook secret"
- **Oplossing**: Check of `WEBHOOK_SECRET` in Vercel overeenkomt met wat je in Pine Script hebt ingevoerd
- Of verwijder het secret tijdelijk om te testen

#### ❌ "Failed to get account state"
- **Oplossing**: Check of `DERIBIT_CLIENT_ID` en `DERIBIT_CLIENT_SECRET` correct zijn ingesteld
- Test eerst met Deribit testnet: `DERIBIT_USE_TESTNET=true`

#### ❌ "Method not allowed"
- **Oplossing**: TradingView moet POST requests sturen. Check of je alert correct is geconfigureerd

#### ❌ Alert wordt niet getriggerd
- **Oplossing**: 
  - Check of het Pine Script correct is geladen
  - Check of er daadwerkelijk signalen worden gegenereerd (zie shapes op chart)
  - Check of `barstate.isconfirmed` werkt (alerts worden alleen bij bar close verzonden)

---

## Stap 6: Live Mode Activeren (Pas Op!)

### 6.1. Test Eerst in Paper Mode

Zorg dat alles werkt in `BOT_MODE=paper` voordat je live gaat!

### 6.2. Schakel naar Live Mode

1. Ga naar Vercel → **Settings** → **Environment Variables**
2. Wijzig `BOT_MODE` van `paper` naar `live`
3. **Redeploy** je project
4. Test opnieuw met kleine amounts

### 6.3. Monitoring

- Monitor je Vercel logs continu
- Check je Deribit account regelmatig
- Start met kleine position sizes

---

## 📝 Checklist

Voordat je live gaat, check:

- [ ] Vercel deployment werkt (`/api/health` geeft `{"status":"ok"}`)
- [ ] Environment variables zijn ingesteld
- [ ] Webhook URL is correct in TradingView alert
- [ ] Pine Script is geladen en genereert signalen
- [ ] Test webhook request werkt (curl/Postman)
- [ ] Paper mode werkt correct
- [ ] Vercel logs tonen geen errors
- [ ] Deribit credentials zijn correct
- [ ] Risk parameters zijn ingesteld (MAX_RISK_PERCENT, etc.)

---

## 🔗 Handige Links

- **Vercel Dashboard**: https://vercel.com/dashboard
- **TradingView Alerts**: https://www.tradingview.com/chart/
- **Deribit API Docs**: https://docs.deribit.com/
- **Vercel Logs**: Via dashboard of `vercel logs`

---

## 💡 Tips

1. **Start altijd in paper mode** - Test alles eerst zonder echte trades
2. **Monitor logs** - Check Vercel logs regelmatig voor errors
3. **Kleine amounts** - Begin met kleine position sizes
4. **Webhook secret** - Gebruik altijd een secret voor productie
5. **Testnet** - Test eerst met Deribit testnet (`DERIBIT_USE_TESTNET=true`)

---

## 🆘 Hulp Nodig?

Als je problemen hebt:
1. Check de Vercel logs voor error messages
2. Test de webhook direct met curl/Postman
3. Check of alle environment variables zijn ingesteld
4. Verify dat je Pine Script correct is geladen

