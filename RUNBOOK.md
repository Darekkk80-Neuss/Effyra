# Effyra – Betriebshandbuch

Die einzige verbindliche Quelle für **Reihenfolge** und **Deploy-Flags**.
Beides war bisher nur in Kommentarköpfen von 20 Dateien verstreut dokumentiert,
und genau daran ist am 20.07.2026 zweimal Arbeit verloren gegangen.

---

## 0. Vor JEDEM Deploy und JEDEM SQL-Lauf

```bash
git fetch && git status
```

Steht dort „behind", **zuerst** `git pull`. `supabase functions deploy` schickt,
was auf der Platte liegt — ohne jeden Bezug zum Git-Stand und ohne Warnung. Ein
veralteter Arbeitsordner rollt stillschweigend alte Versionen über neue Fixes.

An diesem Repository arbeiten mehrere Claude-Sitzungen parallel und pushen nach
`master`. Das ist der Grund für diese Regel.

---

## 1. SQL-Reihenfolge

Im Supabase-Dashboard → SQL Editor → New query → Inhalt einfügen → Run.
Alle Dateien sind idempotent und mehrfach ausführbar.

**Die Reihenfolge ist zwingend.** Mehrere Dateien definieren dieselben
Funktionen; die zuletzt ausgeführte gewinnt.

| # | Datei | Zweck |
|---|---|---|
| 1 | `supabase-setup.sql` | profiles, Registrierungs-Trigger |
| 2 | `supabase-sync.sql` | user_state (Geräte-Sync) |
| 3 | `supabase-push.sql` | push_subscriptions |
| 4 | `supabase-codes.sql` | `gen_family_code`, Beitritts-Rate-Limit |
| 5 | `supabase-kids.sql` | Kinderprofile, **kanonische `save_family`** |
| 6 | `supabase-family.sql` | Familien, Beitritt/Austritt (nach kids.sql!) |
| 7 | `supabase-tiers.sql` | Stufen, `apply_purchase` |
| 8 | `supabase-family-entitlements.sql` | `get_entitlements`, `effective_tier` |
| 9 | `supabase-play-purchases.sql` | Play-Abo-Lebenszyklus, Sitzplätze |
| 10 | `supabase-trial-and-play.sql` | **`consume_ai` – muss NACH 7–9 laufen** |
| 11 | `supabase-trial-schutz.sql` | Missbrauchsschutz Testphase |
| 12 | `supabase-optimierung.sql` | Indizes, `refund_ai`, Statistik, Caches |
| 13 | `supabase-due-reminder.sql` | reminder_log + Cron (alle 15 Min) |
| 14 | `supabase-due-check.sql` | `due_reminders()` – nach 13 |
| 15 | `supabase-morning.sql` | Cron Morgen-Push |
| 16 | `supabase-overdue.sql` | Cron überfällige Aufgaben |
| 17 | `supabase-weather.sql` | Warn-Spalten + Cron Unwetter |
| 18 | `supabase-monitoring.sql` | `cron_health()`, `cron_http_health()` |
| 19 | `supabase/migrations/20260719_*.sql` | Rollenprüfung Kindercodes |

### Doppelt definierte Funktionen — bewusst bereinigt

| Funktion | Gültige Definition | Aus welcher Datei entfernt |
|---|---|---|
| `consume_ai` | `supabase-trial-and-play.sql` | tiers, family-entitlements |
| `save_family` | `supabase-kids.sql` | family.sql |
| `get_entitlements` | steht in **beiden** (tiers + family-entitlements) | — noch offen, family-entitlements gewinnt durch Reihenfolge |

---

## 2. Edge Functions deployen

Das Flag `--no-verify-jwt` ist eine **Einstellung pro Function**, die bei jedem
Deploy neu gesetzt wird. Ein Sammel-Deploy ohne Flag schaltet die JWT-Prüfung
bei den Cron-Functions wieder ein — pg_cron schickt keinen JWT, alle Pushes
fallen dann mit 401 aus, still.

```bash
# Eigene Auth im Code (JWT aus dem Client) → OHNE Flag
supabase functions deploy claude-proxy
supabase functions deploy nutrition-proxy
supabase functions deploy photo-proxy
supabase functions deploy fuel-proxy
supabase functions deploy push-send
supabase functions deploy delete-account
supabase functions deploy stripe-checkout

# Cron/Webhook, Auth über CRON_SECRET bzw. Signatur → MIT Flag
supabase functions deploy due-reminder     --no-verify-jwt
supabase functions deploy morning-push     --no-verify-jwt
supabase functions deploy overdue-reminder --no-verify-jwt
supabase functions deploy weather-push     --no-verify-jwt
supabase functions deploy play-verify      --no-verify-jwt   # RTDN von Google Pub/Sub
supabase functions deploy stripe-webhook   --no-verify-jwt   # Signaturprüfung im Code
```

---

## 3. Client

```bash
node build.mjs        # index.dev.html -> index.html  (NIE index.html direkt bearbeiten)
git add -A && git commit && git push
```

GitHub Pages zieht nach dem Push automatisch nach. `build.mjs` wird **nicht**
erzwungen — wer `index.dev.html` ändert und den Build vergisst, deployt die alte
Fassung, ohne Fehler und ohne Hinweis.

Bei Änderungen am Service Worker zusätzlich `sw.js` → `CACHE`-Namen hochzählen.

---

## 4. Nach dem Deploy prüfen

```sql
select * from public.cron_health();        -- laufen alle vier Jobs?
select * from public.cron_http_health();   -- nehmen die Functions sie an?
```

Alles ausser `ok (200)` heisst: der Job läuft, die Function weist ihn ab.
`403` = CRON_SECRET stimmt nicht · `401` = ohne `--no-verify-jwt` deployt ·
`500` = fehlende RPC (SQL nicht eingespielt).

Zusätzlich in den Function-Logs nach diesen Zeichenketten suchen:

| Logeintrag | Bedeutung |
|---|---|
| `consume_ai_outdated` | `supabase-trial-and-play.sql` nicht eingespielt — Erstattungen treffen den falschen Topf |
| `refund_failed` | `refund_ai` fehlt — Nutzer verlieren Credits bei jedem KI-Fehler |
| `due_reminders_failed` | `supabase-due-check.sql` nicht eingespielt |
| `unhandled` | unerwarteter Fehler im claude-proxy |

---

## 5. Secrets

`supabase secrets set NAME=wert`

| Secret | Gebraucht von | Fehlt → |
|---|---|---|
| `CRON_SECRET` | due-reminder, morning-push, overdue-reminder, weather-push, play-verify (RTDN) | 403, still |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` / `VAPID_SUBJECT` | alle Push-Functions | 500 |
| `OPENAI_API_KEY` | claude-proxy | 500 |
| `OPENAI_MODEL_CHAIN` | claude-proxy (optional) | Default-Kette |
| `GOOGLE_TTS_KEY`, `ELEVENLABS_API_KEY` | claude-proxy (optional) | still auf OpenAI-TTS |
| `PLAY_PACKAGE_NAME`, `PLAY_SERVICE_ACCOUNT_JSON` | play-verify | 500 |
| `RTDN_SECRET` | play-verify | fällt auf CRON_SECRET zurück |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `APP_URL` | stripe-* | **Käufe werden nicht gutgeschrieben, nur im Stripe-Dashboard sichtbar** |
| `PEXELS_KEY`, `SPOONACULAR_KEY`, `TANKERKOENIG_KEY` | jeweiliger Proxy | Widget zeigt „nicht eingerichtet" |

**CRON_SECRET rotieren:** Secret setzen **und** alle fünf Cron-Jobs neu
schreiben (`supabase-due-reminder.sql`, `-morning.sql`, `-overdue.sql`,
`-weather.sql` erneut ausführen). Zwischen beiden Schritten fallen alle Pushes
aus.

---

## 6. Backup und Wiederherstellung

**Offen — vor dem öffentlichen Launch zu klären.**

Die SQL-Dateien werden von Hand im Dashboard ausgeführt, ohne
Transaktionsklammer und ohne Rückfrage. Ein Fehlgriff ist ohne
Point-in-Time-Recovery endgültig, und `user_state` ist das einzige
serverseitige Abbild der Nutzerdaten.

Zu tun:
1. Supabase-Plan prüfen (PITR gibt es erst ab Pro als Add-on)
2. PITR aktivieren
3. Wiederherstellung **einmal testen** — ein ungetestetes Backup ist kein Backup

---

## 7. Bekannte Grenzen

| Grenze | Ab wann | Was dann |
|---|---|---|
| `due_reminders()` liest jeden Blob mit Push-Abo | ~50.000 Nutzer | Spalte `user_state.next_due_at` mit Index |
| `families.data` als ein Blob, Last-Writer-Wins | wächst mit Familiengrösse | optimistisches Sperren oder feldweise RPCs |
| `morning-push` Laufzeit | ~100.000 Geräte | nach Shards aufteilen (mehrere Cron-Einträge) |
| Kein Alerting | jetzt | `cron_health()` regelmässig ansehen |
