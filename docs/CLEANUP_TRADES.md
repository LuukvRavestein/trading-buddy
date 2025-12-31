# Trades Cleanup in Supabase

Handleiding voor het verwijderen van oude trades uit de Supabase database.

## ⚠️ Waarschuwing

**Let op:** Het verwijderen van trades is permanent en kan niet ongedaan worden gemaakt. Zorg dat je een backup maakt als je belangrijke data wilt behouden.

## Methode 1: Alle Trades Verwijderen (Schone Start)

Als je alle trades wilt verwijderen voor een schone start:

1. **Ga naar Supabase Dashboard**
   - Login op [supabase.com](https://supabase.com)
   - Selecteer je project

2. **Open SQL Editor**
   - Klik op "SQL Editor" in het menu links
   - Klik op "New query"

3. **Voer deze query uit:**
   ```sql
   -- Verwijder alle trades
   DELETE FROM trades;
   ```

4. **Bevestig de actie**
   - Klik op "Run" (of druk op Ctrl+Enter)
   - Bevestig dat je alle trades wilt verwijderen

## Methode 2: Alleen Oude Trades Verwijderen (Behoud Recente)

Als je alleen oude trades wilt verwijderen en recente wilt behouden:

```sql
-- Verwijder trades ouder dan 1 dag
DELETE FROM trades 
WHERE created_at < NOW() - INTERVAL '1 day';

-- Of verwijder trades ouder dan een specifieke datum
DELETE FROM trades 
WHERE created_at < '2025-12-29 00:00:00';
```

## Methode 3: Alleen Rejected Trades Verwijderen

Als je alleen rejected trades wilt verwijderen:

```sql
-- Verwijder alle rejected trades
DELETE FROM trades 
WHERE success = false OR action = 'rejected';
```

## Methode 4: Alleen Test Trades Verwijderen

Als je alleen test trades wilt verwijderen (van test mode):

```sql
-- Verwijder trades met TEST signal
DELETE FROM trades 
WHERE signal = 'TEST';
```

## Methode 5: Verwijderen met Limiet (Behoud Laatste N Trades)

Als je alleen de laatste 10 trades wilt behouden:

```sql
-- Verwijder alle trades behalve de laatste 10
DELETE FROM trades 
WHERE id NOT IN (
  SELECT id 
  FROM trades 
  ORDER BY created_at DESC 
  LIMIT 10
);
```

## Verificatie

Na het verwijderen, check hoeveel trades er nog zijn:

```sql
-- Tel aantal trades
SELECT COUNT(*) as total_trades FROM trades;

-- Toon laatste 10 trades
SELECT id, created_at, signal, action, success 
FROM trades 
ORDER BY created_at DESC 
LIMIT 10;
```

## Backup Maken (Aanbevolen)

Voordat je trades verwijdert, kun je een backup maken:

```sql
-- Export trades naar CSV (via Supabase Dashboard)
-- Ga naar Table Editor → trades → Export → CSV

-- Of maak een backup tabel
CREATE TABLE trades_backup AS SELECT * FROM trades;
```

## Na Cleanup

Na het verwijderen van oude trades:

1. **Refresh het dashboard** - Hard refresh (Ctrl+Shift+R)
2. **Check Total P&L** - Zou nu alleen van nieuwe trades moeten zijn
3. **Test met nieuwe trades** - Genereer nieuwe signalen om te testen

## Troubleshooting

### "Permission denied"
- Zorg dat je de Service Role Key gebruikt (niet de Anon Key)
- Of gebruik de Supabase Dashboard SQL Editor (heeft automatisch juiste permissions)

### "Table does not exist"
- Check of de tabel naam correct is: `trades` (niet `trade` of `Trades`)
- Check of je in het juiste schema zit: `public`

### Trades komen terug
- Dit kan gebeuren als er nog alerts worden verwerkt
- Wacht even en verwijder opnieuw als nodig

