# NEXA – Backend einrichten (Supabase, kostenlos)

Mit dem Backend werden Nutzer **zentral verwaltet**: Du siehst alle Konten in einem Dashboard, die 3-Tage-Testphase startet serverseitig (nicht manipulierbar), und Premium-Codes sind einmalig einlösbar. Der kostenlose Tarif reicht für bis zu **50.000 monatlich aktive Nutzer**.

Die App erkennt automatisch, ob das Backend konfiguriert ist:
- **Ohne Konfiguration** → lokaler Modus wie bisher (Konto nur auf dem Gerät)
- **Mit Konfiguration** → echte Cloud-Konten mit E-Mail + Passwort

---

## Einrichtung in ~10 Minuten

### 1. Supabase-Konto erstellen
[supabase.com](https://supabase.com) → **Start your project** → am einfachsten **mit GitHub anmelden** (kostenlos, keine Kreditkarte).

### 2. Projekt anlegen
**New project** → Name z. B. `nexa`, Region **Central EU (Frankfurt)** (Datenschutz/DSGVO), Datenbank-Passwort generieren lassen und sicher notieren. Dann ~2 Minuten warten, bis das Projekt bereit ist.

### 3. Datenbank einrichten
Linke Seitenleiste → **SQL Editor** → **New query** → den **kompletten Inhalt** der Datei [`supabase-setup.sql`](supabase-setup.sql) einfügen → **Run**. Unten sollte „Success" erscheinen.

### 4. E-Mail-Bestätigung ausschalten (empfohlen)
**Authentication → Sign In / Providers → Email** → Schalter **„Confirm email" ausschalten** → Save.

> Warum? Im kostenlosen Tarif verschickt Supabase nur ~2 Bestätigungs-Mails pro Stunde – neue Nutzer könnten sich sonst nicht sofort anmelden. Später (mit eigenem SMTP-Server, z. B. Resend kostenlos) kannst du die Bestätigung wieder aktivieren.

### 5. Site-URL eintragen (für „Passwort vergessen")
**Authentication → URL Configuration** → **Site URL**: `https://darekkk80-neuss.github.io/Nexa/` → Save.

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
| Plan & Testphase einsehen/ändern | **Table Editor → profiles** (Spalte `plan` auf `premium` setzen = manuell freischalten) |
| Eingelöste Codes sehen | **Table Editor → premium_codes** |
| Neue Premium-Codes anlegen | **SQL Editor**: `insert into public.premium_codes (code_hash) values (encode(digest(upper('NEXA-DEIN-CODE'), 'sha256'), 'hex'));` |

**Wichtig:** Im Cloud-Modus ist jeder Code **einmalig** einlösbar (anders als im lokalen Modus).

---

## Was das Backend abdeckt – und was (noch) nicht

✅ Zentrale Konten (E-Mail + Passwort, gehasht bei Supabase) · ✅ Testphase serverseitig · ✅ Premium-Einlösung serverseitig, einmalig · ✅ Admin-Dashboard · ✅ Passwort-vergessen per E-Mail-Link

⚠️ **Bewusst noch lokal:** Aufgaben, Termine, Dokumente und Chat bleiben auf dem Gerät (Datenschutz-Versprechen der App). ⚠️ Die **Anzeige**-Sperre in der App bleibt clientseitig – wirklich wasserdicht wird es erst mit dem KI-Proxy aus [KONZEPT.md](KONZEPT.md) Stufe 2, der bei jedem KI-Aufruf serverseitig Plan und Limit prüft. Das Backend hier ist dafür bereits die richtige Grundlage.
