# Effyra – Zusammenfassung

**Stand:** Juli 2026 · **Live:** https://darekkk80-neuss.github.io/Effyra/ · **Repo:** [Darekkk80-Neuss/Effyra](https://github.com/Darekkk80-Neuss/Effyra)

---

## Was ist Effyra?

Der persönliche **KI-Alltagsmanager** – eine Web-App, die Arbeit abnimmt statt nur Informationen zu liefern. Komplett auf Deutsch, dunkles/visionäres Design, läuft auf Handy und Desktop.

Technisch: **eine einzige `index.html`** (Vanilla-JavaScript, kein Build-System, keine Abhängigkeiten). Alle Daten bleiben lokal im Browser – kein Server, keine Cloud, keine Werbung, kein Tracking.

---

## Funktionen

| Bereich | Was es kann |
|---|---|
| 📄 **Dokumente** | Brief/Rechnung/Vertrag fotografieren → Effyra erklärt ihn in einfachen Worten, erkennt Fristen, schlägt Aufgaben vor, formuliert einen Antwortentwurf |
| ✅ **Aufgaben** | To-dos mit Fälligkeit und Priorität; entstehen automatisch aus Dokumenten und Chat; überfällige rot markiert |
| 📅 **Kalender** | Monatsübersicht, Termine und Fristen automatisch eingetragen |
| ✨ **KI-Chat** | „Ich möchte nächste Woche in den Urlaub" → prüft Kalender, erstellt Packliste + Erinnerungen per Ein-Klick-Buttons |
| 📊 **Dashboard** | Begrüßung, nächste Termine, wichtigste Aufgaben, zuletzt analysierte Dokumente |

**KI zweistufig:** Demo-Modus funktioniert sofort (simulierte Analysen, funktionierende Chat-Szenarien). Mit eigenem Anthropic-API-Schlüssel in den Einstellungen wird echte KI aktiv (Claude analysiert Fotos wirklich, Chat antwortet frei). Der Schlüssel bleibt nur lokal im Browser.

---

## Authentifizierung & Berechtigungen

Beim ersten Start erscheint eine **Login-/Registrierungsseite** als erste Seite.

| Stufe | Zugang |
|---|---|
| **Gast** (nicht angemeldet) | Nur Login-Seite |
| **Free Trial (14 Tage)** | Voller Zugang – ohne Effyra AI / Credits |
| **Free – abgelaufen** | Plan-Auswahl; Daten bleiben erhalten |
| **Lifetime Basic** (4,99 € einmalig) | Komplette App ohne KI, dauerhaft (eigener API-Key optional) |
| **Effyra AI Premium** (4,99 €/Mon. · 49,99 €/Jahr) | + Effyra AI, **500 Credits/Monat** (ab 18) |
| **Effyra Family** (15,99 €/Mon. · 149,99 €/Jahr) | 1 Admin + 1 Erwachsener + bis 3 Kinder, **1500 Credits/Monat** (Pool), Familienzentrale & Rollen |

**Rollen:** `OWNER`, `ADULT_MEMBER`, `CHILD_MEMBER`. **Credits** statt Abrechnung pro Anfrage (Frage 1 · Scan 5 · Rechnung 10 · große Analyse 20 …). **Boost** 4,99 € (+1500 Family / +500 AI). Kinder starten nie KI und verbrauchen keine Credits. Vollständiges Modell: [KONZEPT.md](KONZEPT.md).

**Sicherheit:** Passwort wird gesalzen und SHA-256-gehasht gespeichert (nie im Klartext). Die 14-Tage-Testphase startet bei Registrierung und lässt sich nicht durch Neuanmeldung verlängern (Startzeitpunkt separat gespeichert). Effyra AI Premium wird über Codes im Format `Effyra-XXXX-XXXX` freigeschaltet – im Quelltext stehen nur die Hashes der Codes, nicht die Codes selbst.

> ⚠️ **Ehrlicher Hinweis:** Da Effyra ohne Server läuft, ist die Sperre eine **Komfort-Sperre, kein echter Schutz** – technisch versierte Nutzer könnten sie umgehen. Für die aktuelle Prototyp-Phase ist das ausreichend und üblich.

---

## KI-Kostenmodell (Kurzfassung)

Die zentrale Frage „Wer bezahlt die KI?" in drei Ausbaustufen:

1. **Heute – BYOK + Demo:** Erwachsene bringen ihren eigenen API-Schlüssel mit → **kostet dich 0 €**, ideal zum Validieren der Idee.
2. **Credits statt Abo-Willkür:** Effyra AI (500) und Family (1500 Pool) laufen über **Effyra Credits** – planbare KI-Kosten, klare Marge. Eine KI-Frage = 1 Credit, ein Scan = 5, eine große Analyse = 20. Boost 4,99 €. Braucht das Backend (Supabase + Stripe), damit der API-Key serverseitig bleibt und Credits fälschungssicher gezählt werden.
3. **Optimierung:** günstigeres Modell (Haiku) für einfache Aktionen, besseres (Sonnet) für komplexe; Credit-Kosten je Aktion begrenzen das Risiko pro Nutzer.

**Empfehlung:** Jetzt bei BYOK + Demo bleiben (kostenlos), erst bei zahlungsbereiten Nutzern die Backend-Brücke bauen. → Details in [KONZEPT.md](KONZEPT.md).

---

## Projekt-Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Die gesamte App |
| `manifest.webmanifest` + `icon.svg` | „Zum Startbildschirm hinzufügen" auf dem Handy |
| `README.md` | Kurzbeschreibung mit Live-Link |
| `KONZEPT.md` | Ausführliches Berechtigungs- und KI-Kostenkonzept |
| `ZUSAMMENFASSUNG.md` | Dieses Dokument |

## Deployment

Ein `git push` auf `master` genügt → GitHub Pages aktualisiert die Live-Seite automatisch. Falls der Build nicht anspringt:
`gh api -X POST repos/Darekkk80-Neuss/Effyra/pages/builds`
