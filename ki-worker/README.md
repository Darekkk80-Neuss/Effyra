# Ordela KI-Pakete – Cloudflare Worker

Kleiner Server, damit Nutzer ohne eigenen OpenAI-Schlüssel Briefe erklären lassen
können. Sie kaufen in der App ein Paket (Google Play, Verbrauchsartikel
`ordela_ki_25` = 25 Briefe). Der Worker prüft den Kauf bei Google, führt das
Guthaben und reicht den Brief an OpenAI weiter.

**Gespeichert wird nur:** eine zufällige Geldbörsen-Id aus der App, das
Guthaben und die eingelösten Kauf-Tokens. Keine Briefe, keine Antworten, kein
Konto, keine E-Mail.

## Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/balance?wallet=<id>` | Guthaben abfragen |
| POST | `/redeem` `{wallet, token, sku}` | Kauf prüfen, bei Google verbrauchen, gutschreiben |
| POST | `/explain` `{wallet, system?, messages, max_tokens?}` | 1 Brief abziehen, OpenAI fragen; bei Fehler wird zurückgebucht |

## Einrichtung (einmalig)

1. **Cloudflare-Konto** anlegen (kostenlos): https://dash.cloudflare.com/sign-up
2. In diesem Ordner anmelden – öffnet den Browser:
   `npx wrangler@4 login`
3. **Datenbank** anlegen und die ausgegebene `database_id` in `wrangler.toml` eintragen:
   `npx wrangler@4 d1 create ordela-ki`
4. Tabellen anlegen:
   `npx wrangler@4 d1 execute ordela-ki --remote --file schema.sql`
5. **Geheimnisse** eintragen (werden abgefragt, nie ins Repo schreiben):
   - `npx wrangler@4 secret put OPENAI_API_KEY` – Schlüssel aus https://platform.openai.com/api-keys
     (dort unter *Limits* ein Monatslimit setzen, z. B. 20 $)
   - `npx wrangler@4 secret put GOOGLE_SA_JSON` – Inhalt der JSON-Datei des Dienstkontos (Schritt 7)
6. Veröffentlichen: `npx wrangler@4 deploy` → URL notieren, z. B.
   `https://ordela-ki.<konto>.workers.dev`
7. **Google-Play-Dienstkonto** (damit der Worker Käufe prüfen darf):
   - Google Cloud Console → Projekt der Play Console → *IAM → Dienstkonten* → neues
     Dienstkonto, Schlüssel als JSON herunterladen.
   - *Google Play Android Developer API* im Projekt aktivieren.
   - Play Console → *Nutzer und Berechtigungen* → Dienstkonto-E-Mail einladen, für
     die App Ordela mit „Finanzdaten ansehen" und „Bestellungen und Abos verwalten".
8. **Produkt** in der Play Console: *Monetarisieren → In-App-Produkte* →
   `ordela_ki_25`, Preis z. B. 3,99 €, aktivieren.
9. In `index.dev.html` `KI_PACK_URL` auf die Worker-URL setzen, bauen, PR.

## Lokal testen

`.dev.vars` (nicht im Repo) mit `DEV_FAKE_PURCHASES=1`, `OPENAI_API_KEY=…`,
optional `OPENAI_URL` auf einen Mock und `ALLOWED_ORIGINS=http://[::1]:8123`.
Dann Tabellen lokal anlegen und starten (kurzer `--persist-to`-Pfad, sonst
scheitert SQLite unter Windows an der Pfadlänge):

```
npx wrangler@4 d1 execute ordela-ki --local --persist-to C:/tmp/kiw --file schema.sql
npx wrangler@4 dev --local --persist-to C:/tmp/kiw --port 8787
```

Test-Käufe: `POST /redeem` mit `token: "test-…"` schreibt ohne Google gut –
nur wenn `DEV_FAKE_PURCHASES=1` gesetzt ist, also nie im Live-Worker.

## iOS-App (Apple)

`/redeem` und `/ack` nehmen zusätzlich `{ platform: "apple", transactionId, sku }`
(bei `/redeem` plus `wallet`). Der Worker holt die Transaktion selbst bei Apple
(App Store Server API, erst Produktion, dann Sandbox) und prüft Bundle-Id, Produkt,
Erstattung und – bei KI-Paketen – dass der Kauf für genau diese Geldbörse war.

Zusätzliche Geheimnisse (Dashboard → Settings → Variables and Secrets oder `secret put`):
`APPLE_IAP_KEY` (Inhalt der .p8-Datei „In-App-Kauf“), `APPLE_KEY_ID`, `APPLE_ISSUER_ID`.
Variablen in `wrangler.toml`: `APPLE_BUNDLE_ID`, `APPLE_SANDBOX` („1“ = TestFlight-Käufe annehmen),
`ALLOWED_ORIGINS` enthält `capacitor://localhost`. Schritt für Schritt: `ios-app/README.md`.
