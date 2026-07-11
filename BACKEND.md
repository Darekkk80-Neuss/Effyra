# Effyra – Backend einrichten (Supabase, kostenlos)

Mit dem Backend werden Nutzer **zentral verwaltet**: Du siehst alle Konten in einem Dashboard, die 14-Tage-Testphase startet serverseitig (nicht manipulierbar), und Freischalt-Codes sind einmalig einlösbar. Der kostenlose Tarif reicht für bis zu **50.000 monatlich aktive Nutzer**.

Die App erkennt automatisch, ob das Backend konfiguriert ist:
- **Ohne Konfiguration** → lokaler Modus wie bisher (Konto nur auf dem Gerät)
- **Mit Konfiguration** → echte Cloud-Konten mit E-Mail + Passwort

---

## Einrichtung in ~10 Minuten

### 1. Supabase-Konto erstellen
[supabase.com](https://supabase.com) → **Start your project** → am einfachsten **mit GitHub anmelden** (kostenlos, keine Kreditkarte).

### 2. Projekt anlegen
**New project** → Name z. B. `effyra`, Region **Central EU (Frankfurt)** (Datenschutz/DSGVO), Datenbank-Passwort generieren lassen und sicher notieren. Dann ~2 Minuten warten, bis das Projekt bereit ist.

### 3. Datenbank einrichten
Linke Seitenleiste → **SQL Editor** → **New query** → den **kompletten Inhalt** der Datei [`supabase-setup.sql`](supabase-setup.sql) einfügen → **Run**. Unten sollte „Success" erscheinen.

**Optional – Familien-Sync:** Wer die **Familienzentrale mit dem Partner synchronisieren** möchte, führt zusätzlich [`supabase-family.sql`](supabase-family.sql) im SQL-Editor aus (gleicher Ablauf). Ohne dieses Script funktioniert die Familienzentrale lokal auf dem Gerät; nur die Partner-Synchronisierung braucht es. Der Notfallbereich bleibt bewusst immer nur lokal (sensible Daten).

### 4. E-Mail-Bestätigung ausschalten (empfohlen)
**Authentication → Sign In / Providers → Email** → Schalter **„Confirm email" ausschalten** → Save.

> Warum? Im kostenlosen Tarif verschickt Supabase nur ~2 Bestätigungs-Mails pro Stunde – neue Nutzer könnten sich sonst nicht sofort anmelden. Später (mit eigenem SMTP-Server, z. B. Resend kostenlos) kannst du die Bestätigung wieder aktivieren.

### 5. Site-URL eintragen (für „Passwort vergessen")
**Authentication → URL Configuration** → **Site URL**: `https://darekkk80-neuss.github.io/Effyra/` → Save.

### 6. Die zwei Schlüsselwerte kopieren
**Project Settings (Zahnrad) → API**:
- **Project URL** (sieht aus wie `https://abcdefgh.supabase.co`)
- Der öffentliche Key: je nach Projekt-Alter heißt er **„anon public"** (beginnt mit `eyJ…`) oder — bei neuen Projekten — **„Publishable key"** (beginnt mit `sb_publishable_…`). Beide funktionieren gleich.

### 7. In die App eintragen
In `index.html` ganz oben im Script-Block die markierte Stelle ausfüllen:

```js
const SUPABASE_URL = 'https://DEIN-PROJEKT.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ…';
```

Dann committen und pushen – fertig. *(Oder gib mir die beiden Werte, dann trage ich sie ein und teste alles durch.)*

> 🔓 **Ist der anon-Key im öffentlichen Repo ein Problem? Nein.** Er ist dafür gemacht, im Browser zu stehen. Die Sicherheit kommt aus den Datenbank-Regeln (Row Level Security), die das SQL-Script setzt: Jeder Nutzer sieht nur sein eigenes Profil, und `plan`/`trial_start` kann niemand selbst ändern – nur die serverseitige Code-Einlösung.

---

## Nutzer verwalten (dein Admin-Bereich)

| Was | Wo im Supabase-Dashboard |
|---|---|
| Alle Nutzer sehen, löschen, sperren | **Authentication → Users** |
| Stufe, Rolle & Credits einsehen/ändern | **Table Editor → profiles** (`tier` = `basic`/`ai`/`family`, `status`, `role`, `ai_used`/`ai_extra` = manuell freischalten/gutschreiben) |
| Eingelöste Codes sehen | **Table Editor → premium_codes** |
| Neue Freischalt-Codes anlegen | **SQL Editor**: `insert into public.premium_codes (code_hash) values (encode(digest(upper('Effyra-DEIN-CODE'), 'sha256'), 'hex'));` |

**Wichtig:** Im Cloud-Modus ist jeder Code **einmalig** einlösbar (anders als im lokalen Modus).

---

## Was das Backend abdeckt – und was (noch) nicht

✅ Zentrale Konten (E-Mail + Passwort, gehasht bei Supabase) · ✅ Testphase serverseitig · ✅ Premium-Einlösung serverseitig, einmalig · ✅ Admin-Dashboard · ✅ Passwort-vergessen per E-Mail-Link

⚠️ **Bewusst noch lokal:** Aufgaben, Termine, Dokumente und Chat bleiben auf dem Gerät (Datenschutz-Versprechen der App). ⚠️ Die **Anzeige**-Sperre in der App bleibt clientseitig – wirklich wasserdicht wird es erst mit dem KI-Proxy aus Phase 2 (siehe unten), der bei jedem KI-Aufruf serverseitig Plan und Limit prüft. Das Backend hier ist dafür bereits die richtige Grundlage.

---

# Phase 2 – Gehostete KI (Proxy) + Stripe-Bezahlung

Damit läuft **Effyra AI / Family mit vom Anbieter gestelltem Schlüssel** sicher: Der echte Claude-Schlüssel liegt **nur auf dem Server**, die **Effyra Credits (500 für AI, 1500 für Family) werden serverseitig** gezählt (fälschungssicher), und alle Käufe (Lifetime Basic, AI Premium, Family, Credit-Boost) werden per **Stripe** bezahlt.

> Der Client ist vorbereitet, aber standardmäßig **aus**: In `index.html` steht `const BACKEND_V2 = false;`. Erst nach den folgenden Schritten auf `true` setzen, committen, pushen.

## A. Datenbank erweitern
SQL-Editor → **kompletten Inhalt** von [`supabase-tiers.sql`](supabase-tiers.sql) einfügen → **Run**. (Fügt Stufen- (`free/basic/ai/family`), Rollen- (`OWNER/ADULT_MEMBER/CHILD_MEMBER`), Status- und Credit-Spalten sowie die RPCs `get_entitlements`, `consume_credits`, `apply_purchase`, `add_family_member` hinzu; migriert bestehende Nutzer aus dem alten `medium/premium`-Modell.)

## B. Supabase CLI installieren & anmelden
```bash
npm i -g supabase        # oder: scoop install supabase (Windows)
supabase login
supabase link --project-ref DEINE-PROJEKT-REF   # Ref = Subdomain der Project URL
```

## C. Secrets setzen
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...        # der echte Claude-Schlüssel (gibst du mir/hier später)
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...      # aus Schritt E
supabase secrets set STRIPE_PRICE_BASIC=price_...          # aus Schritt D (Lifetime Basic)
supabase secrets set STRIPE_PRICE_AI_MONTHLY=price_...
supabase secrets set STRIPE_PRICE_AI_YEARLY=price_...
supabase secrets set STRIPE_PRICE_FAMILY_MONTHLY=price_...
supabase secrets set STRIPE_PRICE_FAMILY_YEARLY=price_...
supabase secrets set STRIPE_PRICE_FAMILY_BOOST=price_...   # +1500 Credits
supabase secrets set STRIPE_PRICE_TOPUP=price_...          # +500 Credits (Effyra AI)
supabase secrets set STRIPE_PRICE_ADD_ADULT=price_...      # +Erwachsener 3,99 €/Mon.
supabase secrets set STRIPE_PRICE_ADD_CHILD=price_...      # +Kind 0,99 €/Mon.
supabase secrets set APP_URL=https://darekkk80-neuss.github.io/Effyra/
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sind in Functions automatisch vorhanden.

## D. Stripe-Produkte anlegen
[dashboard.stripe.com](https://dashboard.stripe.com) → **Test-Modus** → **Products** (Price-ID jeweils kopieren):
- **Lifetime Basic** – Einmalzahlung 4,99 € → `STRIPE_PRICE_BASIC`
- **Effyra AI Premium** – wiederkehrend 4,99 €/Monat → `STRIPE_PRICE_AI_MONTHLY`
- **Effyra AI Premium (Jahr)** – wiederkehrend 49,99 €/Jahr → `STRIPE_PRICE_AI_YEARLY`
- **Effyra Family** – wiederkehrend 15,99 €/Monat → `STRIPE_PRICE_FAMILY_MONTHLY`
- **Effyra Family (Jahr)** – wiederkehrend 149,99 €/Jahr → `STRIPE_PRICE_FAMILY_YEARLY`
- **Family Boost +1500 Credits** – Einmalzahlung 4,99 € → `STRIPE_PRICE_FAMILY_BOOST`
- **Credit-Boost +500 Credits** – Einmalzahlung 4,99 € → `STRIPE_PRICE_TOPUP`
- **Zusätzlicher Erwachsener** – wiederkehrend 3,99 €/Monat → `STRIPE_PRICE_ADD_ADULT`
- **Zusätzliches Kind** – wiederkehrend 0,99 €/Monat → `STRIPE_PRICE_ADD_CHILD`

> Die `kind`-Werte, die der Checkout an `apply_purchase` weiterreicht: `basic_lifetime`, `ai_monthly`, `ai_yearly`, `family_monthly`, `family_yearly`, `family_boost`, `topup`. Zusätzliche Mitglieder laufen über `add_family_member` (Familienzentrale).

## E. Functions deployen
```bash
supabase functions deploy claude-proxy
supabase functions deploy stripe-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```
(Der Webhook prüft die Stripe-Signatur selbst, daher `--no-verify-jwt`.)

## F. Stripe-Webhook eintragen
Stripe → **Developers → Webhooks → Add endpoint**
- URL: `https://DEIN-PROJEKT.functions.supabase.co/stripe-webhook`
- Events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
- **Signing secret** (`whsec_…`) kopieren → als `STRIPE_WEBHOOK_SECRET` setzen (Schritt C) und `stripe-webhook` erneut deployen.

## G. Aktivieren
In `index.html`: `const BACKEND_V2 = true;` → committen & pushen. Fertig.

### Danach automatisch
- **Effyra AI / Family ohne eigenen Schlüssel** → KI läuft über den Proxy, jede Aktion kostet ihre Credits (Section 7) und zählt serverseitig, Balken/Boost sind live, Reset am 1.
- **Family-Pool**: Die 1500 Credits teilen sich alle Erwachsenen der Familie; Kinder verbrauchen nie Credits und können keine KI starten (serverseitig erzwungen).
- **Kauf-Buttons** öffnen Stripe-Checkout; nach Zahlung setzt der Webhook Stufe/Status. Bei Rückkehr (`?checkout=success`) gleicht die App den Stand ab.
- **Eigener Schlüssel** (nur Erwachsene) in den Einstellungen bleibt die unbegrenzte Alternative (läuft direkt an Anthropic, kein Credit-Verbrauch).

> Sicherheit: `consume_credits`/`apply_purchase`/`add_family_member` sind `security definer` und für normale Nutzer gesperrt – nur Proxy/Webhook (service_role) dürfen sie aufrufen. Kinder werden in `consume_credits` hart abgewiesen. Der Anthropic-Schlüssel steht ausschließlich als Function-Secret, nie im Client.
