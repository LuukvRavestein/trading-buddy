# Environment Variables - Overzicht

Dit document beschrijft alle environment variables die nodig zijn voor de Trading Buddy bot.

## 📋 Quick Reference

Voeg deze toe in **Vercel → Settings → Environment Variables** of in je lokale `.env` bestand.

---

## 🔴 Verplicht

### Deribit API Credentials

```
DERIBIT_CLIENT_ID=your_deribit_client_id
DERIBIT_CLIENT_SECRET=your_deribit_client_secret
```

**Hoe te verkrijgen:**
1. Log in op [Deribit](https://www.deribit.com)
2. Ga naar Account → API
3. Maak een nieuwe API key aan
4. Kopieer Client ID en Client Secret

### Bot Mode

```
BOT_MODE=paper
```

**Opties:**
- `paper` - Simulatie mode (geen echte trades)
- `live` - Echte trades plaatsen op Deribit

**⚠️ Start altijd met `paper` mode!**

---

## 🟡 Optioneel (maar aanbevolen)

### Webhook Security

```
WEBHOOK_SECRET=een_willekeurig_geheim_woord
```

**Gebruik:**
- Voeg toe voor extra beveiliging
- Moet overeenkomen met wat je in Pine Script invoert
- Als je dit niet instelt, werkt de webhook ook (minder veilig)

### Testnet

```
DERIBIT_USE_TESTNET=false
```

**Opties:**
- `true` - Gebruik Deribit testnet (aanbevolen voor testen)
- `false` - Gebruik Deribit mainnet (echte markt)

---

## 🟢 Optioneel (hebben defaults)

### Risk Management

```
MAX_RISK_PERCENT=1
MAX_DAILY_LOSS_PERCENT=3
MAX_TRADES_PER_DAY=5
```

**Defaults:**
- `MAX_RISK_PERCENT`: 1% (max risk per trade)
- `MAX_DAILY_LOSS_PERCENT`: 3% (max dagverlies)
- `MAX_TRADES_PER_DAY`: 5 (max trades per dag)

**Als je deze niet instelt, worden de defaults gebruikt.**

---

## 📝 Voorbeeld Configuratie

### Minimale Configuratie (Paper Mode)

```
DERIBIT_CLIENT_ID=abc123...
DERIBIT_CLIENT_SECRET=xyz789...
BOT_MODE=paper
```

### Aanbevolen Configuratie (Paper Mode + Security)

```
DERIBIT_CLIENT_ID=abc123...
DERIBIT_CLIENT_SECRET=xyz789...
BOT_MODE=paper
WEBHOOK_SECRET=mijn_geheime_woord_123
DERIBIT_USE_TESTNET=true
MAX_RISK_PERCENT=1
MAX_DAILY_LOSS_PERCENT=3
MAX_TRADES_PER_DAY=5
```

### Productie Configuratie (Live Mode)

```
DERIBIT_CLIENT_ID=abc123...
DERIBIT_CLIENT_SECRET=xyz789...
BOT_MODE=live
WEBHOOK_SECRET=sterk_geheim_woord_456
DERIBIT_USE_TESTNET=false
MAX_RISK_PERCENT=1
MAX_DAILY_LOSS_PERCENT=3
MAX_TRADES_PER_DAY=5
```

---

## 🔧 Vercel Setup

### Stap 1: Ga naar Environment Variables

1. Vercel Dashboard → Je Project
2. Settings → Environment Variables

### Stap 2: Voeg Variabelen Toe

Voor elke variabele:
1. Klik op "Add New"
2. Voer **Name** in (bijv. `DERIBIT_CLIENT_ID`)
3. Voer **Value** in (je waarde)
4. Selecteer environments:
   - ✅ Production
   - ✅ Preview (optioneel)
   - ✅ Development (optioneel)
5. Klik "Save"

### Stap 3: Redeploy

**Belangrijk:** Na het toevoegen van environment variables:
1. Ga naar Deployments tab
2. Klik op "..." naast laatste deployment
3. Klik "Redeploy"
4. Wacht tot deployment klaar is

Environment variables worden alleen geladen bij deployment!

---

## 🧪 Lokaal Testen

### .env Bestand Aanmaken

Maak een `.env` bestand in de root van je project:

```bash
cp docs/ENV_VARIABLES.md .env  # Kopieer en pas aan
```

Of maak handmatig:

```bash
touch .env
```

Voeg je variabelen toe:

```
DERIBIT_CLIENT_ID=...
DERIBIT_CLIENT_SECRET=...
BOT_MODE=paper
```

### Vercel Dev

```bash
vercel dev
```

Vercel laadt automatisch je `.env` bestand.

---

## 🔒 Security Best Practices

1. **Gebruik altijd WEBHOOK_SECRET** in productie
2. **Deel nooit je API keys** - voeg `.env` toe aan `.gitignore`
3. **Gebruik verschillende keys** voor testnet en mainnet
4. **Roteer secrets regelmatig** (verander WEBHOOK_SECRET periodiek)
5. **Start altijd met paper mode** voordat je live gaat

---

## ❓ Troubleshooting

### "DERIBIT_CLIENT_ID and DERIBIT_CLIENT_SECRET must be set"
- **Oplossing**: Check of variabelen zijn toegevoegd in Vercel
- **Oplossing**: Redeploy na het toevoegen van variabelen

### "Invalid webhook secret"
- **Oplossing**: Check of `WEBHOOK_SECRET` in Vercel overeenkomt met Pine Script
- **Oplossing**: Of verwijder secret tijdelijk om te testen

### Variabelen worden niet geladen
- **Oplossing**: Redeploy je Vercel project
- **Oplossing**: Check of variabelen zijn toegevoegd aan Production environment

