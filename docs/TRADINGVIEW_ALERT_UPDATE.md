# TradingView Alert Update - Exit Validation

## Wat is er veranderd?

De Pine Script is aangepast om automatisch exit alerts te sturen wanneer TP of SL wordt geraakt. Je hoeft **geen nieuwe alert aan te maken** - de bestaande alert werkt voor beide (entry en exit).

## Stap 1: Pine Script Updaten

1. **Open TradingView**
2. **Ga naar je chart** met de Trading Buddy strategy
3. **Klik op "Pine Editor"** (onderaan)
4. **Kopieer de nieuwe Pine Script code** uit `pinescript/trading-buddy-strategy.pine`
5. **Plak de code** in de Pine Editor
6. **Klik op "Save"** (of Ctrl+S / Cmd+S)
7. **Klik op "Add to Chart"** (als het nog niet op de chart staat)

## Stap 2: Check Alert Configuratie

Je bestaande alert zou automatisch moeten werken voor beide types (entry en exit). Check of je alert:

✅ **Condition**: `Any alert() function call`
✅ **Webhook URL**: `https://jouw-app.vercel.app/api/webhook`
✅ **Webhook URL enabled**: ✅ Aangevinkt

**Belangrijk**: Je hoeft **geen nieuwe alert aan te maken**. Dezelfde alert werkt voor:
- Entry signals (LONG/SHORT)
- Exit validation (TRADE_EXIT)

## Stap 3: Testen

### Test 1: Entry Alert (bestaand)
1. Wacht op een signal (LONG of SHORT)
2. Check Vercel logs - je zou een entry alert moeten zien

### Test 2: Exit Alert (nieuw)
1. Wacht tot een trade TP of SL raakt
2. Check Vercel logs - je zou een TRADE_EXIT alert moeten zien
3. Check database - de trade zou automatisch geüpdatet moeten zijn

## Hoe het werkt

1. **Entry Signal**: Pine Script detecteert signal → stuurt `LONG`/`SHORT` alert
2. **Exit Detection**: Pine Script detecteert TP/SL hit → stuurt `TRADE_EXIT` alert
3. **Auto Update**: Webhook ontvangt exit alert → update trade in database

## Troubleshooting

### Exit alerts komen niet binnen
- ✅ Check of Pine Script is geüpdatet (nieuwste versie)
- ✅ Check of alert nog actief is
- ✅ Check Vercel logs voor errors
- ✅ Check of TP/SL daadwerkelijk wordt geraakt (kijk op chart)

### Trade wordt niet gevonden
- ✅ Check of entry_price exact overeenkomt (0.1% tolerance)
- ✅ Check of entry_signal overeenkomt (LONG/SHORT)
- ✅ Check of trade al een exit heeft (wordt niet opnieuw geüpdatet)

## Optioneel: Aparte Alert voor Exits

Als je liever een aparte alert hebt voor exits (voor betere organisatie):

1. **Maak nieuwe alert** in TradingView
2. **Condition**: `Any alert() function call` (zelfde als entry alert)
3. **Webhook URL**: Zelfde URL als entry alert
4. **Name**: "Trading Buddy - Exit Validation"
5. **Note**: Beide alerts gebruiken dezelfde webhook - de webhook detecteert automatisch het type

**Maar dit is niet nodig** - één alert werkt perfect voor beide!

