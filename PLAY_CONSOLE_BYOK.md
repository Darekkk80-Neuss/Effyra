# Anleitung: Die zwei Produkte „Eigener KI-Schlüssel" in der Play Console anlegen

Stand 26.07.2026 · gehört zu Commit `a098865` · Texte für alle Sprachen: `legal/byok_products.md`

Du legst zwei Produkte an:

| Produkt-ID | Typ | Preis |
|---|---|---|
| `effyra_byok_monthly` | **Abo** | 1,99 € / Monat |
| `effyra_byok_lifetime` | **Einmalkauf** | 24,99 € |

Die IDs müssen **buchstabengenau** stimmen — die App sucht exakt danach. Eine
Produkt-ID lässt sich nach dem Anlegen **nie wieder ändern**.

---

## ⚠️ Zuerst prüfen: Ist Play Billing in der App überhaupt aktiv?

**Ohne diesen Schritt funktioniert kein einziger Kauf** — auch die bestehenden nicht.

Ordela ist eine Web-App in einer TWA-Hülle. Käufe laufen über die *Digital Goods
API*, und die ist nur verfügbar, wenn die TWA **mit Play-Billing-Unterstützung
gebaut** wurde. In der Referenz-Datei `twa-manifest.json` dieses Projekts ist das
Merkmal **nicht** gesetzt, und gebaut wird bei dir über **PWABuilder**.

**So prüfst du es in 30 Sekunden:**

1. Ordela auf dem Handy **aus dem Play Store** öffnen (nicht im Browser).
2. Einstellungen → *Eigener KI-Schlüssel* → auf „Monatlich freischalten" tippen.
3. Was passiert?
   - **Google-Bezahldialog erscheint** → alles gut, weiter bei Schritt 1 unten.
   - **Meldung „Käufe laufen über die Ordela-App (Google Play)"** → Play Billing
     fehlt im Build.

**Falls es fehlt:** Auf [pwabuilder.com](https://www.pwabuilder.com) das Android-Paket
neu erzeugen und dort **„Google Play Billing"** aktivieren (in den Android-Optionen).
Danach neues AAB in den Test-Track hochladen. Wichtig: **Paketname
`app.effyra.twa` und denselben Signaturschlüssel behalten**, sonst gilt es als
andere App.

---

## Schritt 1 — Das Abo anlegen (1,99 €/Monat)

**Play Console → Monetarisierung → Produkte → Abos → „Abo erstellen"**

1. **Produkt-ID:** `effyra_byok_monthly`
   *(exakt so, keine Leerzeichen, nicht änderbar)*
2. **Name:** `Eigener KI-Schlüssel – monatlich`
3. **Speichern.**

Jetzt braucht das Abo noch einen **Basisplan** — ohne ihn ist es nicht kaufbar:

4. Im Abo auf **„Basisplan hinzufügen"**.
5. **Basisplan-ID:** `monthly` *(auch das ist dauerhaft)*
6. **Typ:** **Automatisch verlängernd**
7. **Abrechnungszeitraum:** **Monatlich**
8. **Preise:** Deutschland **1,99 €** eintragen → dann
   **„Preise für andere Länder festlegen"** und Googles Umrechnung übernehmen.
9. **Basisplan aktivieren** (eigener Knopf — leicht zu übersehen).
10. Oben das **Abo selbst auf „Aktiv"** setzen.

> **Keine kostenlose Testphase und kein Einführungsangebot anlegen.** Die App
> rechnet mit sofortiger Freischaltung; ein Gratis-Zeitraum würde die Laufzeit
> gegenüber deiner Datenbank verschieben.

---

## Schritt 2 — Den Einmalkauf anlegen (24,99 €)

**Play Console → Monetarisierung → Produkte → In-App-Produkte → „Produkt erstellen"**

1. **Produkt-ID:** `effyra_byok_lifetime`
2. **Name:** `Eigener KI-Schlüssel – dauerhaft`
3. **Beschreibung:**
   `Einmal zahlen, dauerhaft nutzen: Ordelas KI mit deinem eigenen OpenAI-Schlüssel, ohne Credit-Limit. Die KI-Kosten rechnest du direkt mit OpenAI ab.`
4. **Preis:** **24,99 €**, danach wieder **„Preise für andere Länder festlegen"**.
5. **Speichern → Aktivieren.**

> **Nicht verbrauchbar:** Ob ein Einmalkauf „aufgebraucht" wird, entscheidet die
> App — nicht die Console. Ordela verbraucht diesen Kauf **nicht**, er bleibt dem
> Konto dauerhaft erhalten und wird nach einer Neuinstallation automatisch
> wiederhergestellt. Du musst dazu nichts einstellen.

---

## Schritt 3 — Übersetzungen (optional, aber empfohlen)

In beiden Produkten gibt es **„Übersetzungen verwalten"**. Die fertigen Texte für
Englisch, Französisch, Spanisch, Italienisch und Polnisch stehen in
**`legal/byok_products.md`** zum Kopieren.

---

## Schritt 4 — Testen, ohne echtes Geld auszugeben

1. **Play Console → Einstellungen → Lizenztests**: deine Test-Google-Konten
   eintragen. Diese Konten sehen beim Kauf „Testkarte, immer erfolgreich" und
   zahlen nichts.
2. Ordela auf dem Testgerät **aus dem Play Store installieren** (Test-Track) —
   ein per Kabel installiertes APK kennt keine Play-Produkte.
3. In der App: **Einstellungen → Eigener KI-Schlüssel → „Monatlich freischalten"**.
4. Nach dem Kauf muss erscheinen:
   - Toast **„✓ Eigener KI-Schlüssel (Monat) aktiviert. Danke!"**
   - die Karte zeigt jetzt **„✓ Eigener Schlüssel freigeschaltet bis …"**
   - darunter das **Eingabefeld für den Schlüssel** (vorher war da nur das Angebot)
5. Gegenprobe in Supabase (**SQL-Editor**):
   ```sql
   select u.email, p.byok_lifetime, p.byok_until
   from public.profiles p
   join auth.users u on u.id = p.id
   order by u.created_at desc
   limit 20;
   ```
   → beim Testkonto steht `byok_until` in der Zukunft bzw. `byok_lifetime = true`.

   > **Nicht** `select public.byok_status();` im SQL-Editor verwenden. Die Funktion
   > liefert bewusst nur die Daten des *angemeldeten* Nutzers und antwortet dort
   > mit `not authenticated`, weil der Editor ohne Nutzer-Anmeldung läuft. Das ist
   > richtig so – aus der App heraus funktioniert sie.

   Prüfen, dass die Spalten überhaupt existieren:
   ```sql
   select column_name, data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name like 'byok%';
   ```

**Test-Abos rückgängig machen:** Play Store-App → Profil → Zahlungen & Abos →
Abos → Testabo kündigen. Lizenztest-Abos verlängern sich stark beschleunigt
(ein „Monat" dauert wenige Minuten) — praktisch zum Prüfen der Verlängerung.

---

## Schritt 5 — Kontrolle, dass alles zusammenspielt

- [ ] Kauf löst den Google-Dialog aus
- [ ] Nach dem Kauf erscheint das Schlüssel-Eingabefeld
- [ ] In `public.profiles` steht `byok_until` bzw. `byok_lifetime` beim Testkonto
- [ ] Schlüssel eintragen → KI-Anfrage läuft **ohne** Credit-Abzug
- [ ] Nach Deinstallation + Neuinstallation ist die Freischaltung wieder da
      *(Wiederherstellung läuft automatisch beim Start)*

---

## Wenn etwas klemmt

| Symptom | Ursache | Lösung |
|---|---|---|
| „Käufe laufen über die Ordela-App (Google Play)" | Play Billing fehlt im TWA-Build | Neu bauen mit PWABuilder, Billing aktivieren |
| „Kauf nicht möglich: … ITEM_UNAVAILABLE" | Produkt-ID falsch, nicht aktiv, oder Änderung noch nicht verteilt | ID buchstabengenau prüfen; nach dem Aktivieren **bis zu 24 Std** warten |
| Kauf klappt, App bleibt gesperrt | SQL nicht eingespielt oder `play-verify` scheitert | `public.profiles` prüfen (Abfrage oben); Logs der Function `play-verify` ansehen |
| `not authenticated` im SQL-Editor | **kein Fehler** – `byok_status()` braucht einen angemeldeten Nutzer | stattdessen `public.profiles` abfragen (siehe oben) |
| Kauf klappt nur beim ersten Mal | Normal beim Einmalkauf — er ist dauerhaft | kein Fehler |

Die App meldet einen misslungenen Kauf **ehrlich** („Kauf erhalten – die
Freischaltung wird abgeschlossen") und versucht die Freischaltung beim nächsten
Start automatisch erneut.

---

## Nebenbefund zum Aufräumen (nicht dringend)

Die Produkttabelle in `GOOGLE_PLAY_SETUP.md` ist an zwei Stellen veraltet:
`effyra_ai_boost` heißt im Code **+1000 Credits** (dort steht +500), und
`effyra_lifetime` (12,99 €) wird vom Client **nie ausgelöst** — es gibt kein
Lifetime-Produkt ohne KI mehr. Beim nächsten Durchgang angleichen.
