# Effyra – Go-Live-Check vor Produktions-Release

**Datum:** 2026-07-19 · **Prüfer:** Release-Engineering (projektbegleitend) · **Paket:** `app.effyra.twa`

## 1. Go/No-Go

**Entscheidung: GO für den technischen Teil – NO-GO nur noch aus Prozessgründen (Testphase + fehlende Store-Grafiken).**

- **0 technische Blocker.** Billing, assetlinks, Secrets, Policy-Pflichten sind im Code verifiziert.
- Offen sind ausschließlich **operative Play-Console-Schritte**: Testphasen-Frist, 2 Store-Grafiken, Produktions-Fragebogen.
- Realistische Zeit bis einreichbar: **~ bis Ende der 14-Tage-Testfrist** (Rest ist in 1–2 h erledigt).

## 2. Was im Code verifiziert ist (erledigt ✅)

| Bereich | Befund | Fundstelle |
|---|---|---|
| Play Billing (Pflicht) | Kauf → `play-verify` → `grant_play_purchase`; **live getestet, schaltet Premium frei** | `index.dev.html:8956`, `supabase/functions/play-verify/index.ts:148` |
| Kein Stripe-Umweg in Play | TWA ohne Digital Goods weist NICHT auf Web-Checkout aus | `index.dev.html:4832` |
| Keine Secrets im Client | nur `sb_publishable_…` (anon, erlaubt); kein `sk-`, kein `service_role`, kein Private Key | Scan `index.html/.dev.html/sw.js` |
| assetlinks | `app.effyra.twa` + 2 Fingerprints (App-Signing 52:3C…92:DF + Upload 68:E1…C9:5C), live an Domain-Root | `.well-known/assetlinks.json` |
| Konto-Löschung | In-App-Link + öffentliche Seite | `konto-loeschen.html`, referenziert in `index.dev.html` |
| Notruf-Disclaimer | „Im echten Notfall 112" vorhanden | `index.dev.html` (11×) |
| KI-Melden + KI-Kennzeichnung | Report-Funktion + „Keine Rechtsberatung"/„ersetzt keine" | `index.dev.html` |
| PWA-Manifest / SW | standalone, Icons inkl. maskable, Offline-Fallback auf `index.html` | `manifest.webmanifest`, `sw.js:42` |

## 3. Noch offen VOR Go-Live (operativ, Play Console)

| # | Stufe | To-do | Status |
|---|---|---|---|
| 1 | HOCH | **Testphase erfüllen:** ≥ 12 Tester opt-in **und** 14 zusammenhängende Tage | läuft (seit ~gestern) |
| 2 | HOCH | **Feature-Grafik 1024×500 px** hochladen | offen |
| 3 | HOCH | **Min. 2 Telefon-Screenshots** hochladen | offen |
| 4 | HOCH | **App-Symbol 512×512** | von dir hochgeladen – bitte bestätigen |
| 5 | MITTEL | **Content-Rating (IARC-Fragebogen)** ausfüllen | bestätigen |
| 6 | MITTEL | **Datenschutz-URL** im Store-Eintrag hinterlegt (`…/datenschutz.html`) | bestätigen |
| 7 | MITTEL | **Data safety** ausgefüllt | erledigt (deine Angabe) |
| 8 | MITTEL | **App-Inhalte**: Zielgruppe (ab 18), Werbung=nein, Zugriffe deklariert | größtenteils erledigt |
| 9 | MITTEL | **Länder + Preise + Steuerprofil** | Preise gesetzt ✅ – Länderauswahl bestätigen |
| 10 | HOCH | **Produktionszugriff beantragen** + Fragebogen (Antworten liegen als Datei bereit) | ~Tag 14 |
| 11 | NIEDRIG | Beim Produktions-Release **vorhandene AAB Test→Produktion promoten** (keine neue Datei) | am Ende |

## 4. Reihenfolge

1. Jetzt: **Grafiken** (Feature-Grafik + 2 Screenshots) — blockiert sonst die Einreichung.
2. Parallel: **Content-Rating, Datenschutz-URL, Länder** bestätigen/nachziehen.
3. Warten: **Testfrist** (12 Tester × 14 Tage) läuft ab.
4. Dann: **Produktionszugriff beantragen** (Fragebogen einfügen) → **AAB promoten** → **gestaffelter Rollout**.

## 5. Kleinigkeiten (kein Blocker)

- `appVersionCode: 1` – für Erst-Release ok; bei jeder neuen AAB hochzählen (`twa-manifest.json`).
- Kosmetik: `manifest.webmanifest` `theme_color`/`background_color` (#7c3aed / weiß) weichen von der TWA-Hülle (#07090f) ab – rein optisch, kein Review-Risiko.

## 6. Was ich von dir zum Abhaken brauche

- Screenshot: **Store-Eintrag → Grafiken** (welche Felder gefüllt?)
- Bestätigung: **Content-Rating** ausgefüllt? **Datenschutz-URL** eingetragen?
- Bestätigung: **Länderauswahl** getroffen?
