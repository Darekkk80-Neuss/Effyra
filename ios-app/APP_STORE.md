# Ordela – App-Store-Unterlagen (iOS)

Alles, was App Store Connect vor der Einreichung wissen will. Muss zu Google Play
(Datensicherheit) und zur Datenschutzerklärung passen.

## 1. Screenshots

Ordela ist nur für das iPhone freigegeben (`TARGETED_DEVICE_FAMILY = 1`), deshalb sind
**keine iPad-Screenshots** nötig.

| Größe | Pflicht? | Auflösung (Hochformat) | Beispielgeräte |
|---|---|---|---|
| **6,9 Zoll** | **ja** | 1320 × 2868 (oder 1290 × 2796) | iPhone 16/17 Pro Max |
| 6,5 Zoll | nur falls kein 6,9" vorhanden | 1284 × 2778 (oder 1242 × 2688) | iPhone 14 Plus, 11 Pro Max |

Apple skaliert die 6,9"-Bilder für kleinere Geräte. 3–10 Bilder pro Sprache, PNG/JPG ohne Transparenz.
Vorschlag (Deutsch, danach Englisch):

1. Start / Tagesübersicht („Alles im Blick – Fristen, Termine, Aufgaben“)
2. Brief fotografieren → Zuschneiden
3. Brief erklärt in einfachen Worten + gefundene Frist
4. Kalender mit Erinnerung
5. Musterbriefe
6. Notfallmappe / Vorrat
7. Ordela Plus (Einmalkauf, kein Abo)

**Ohne Mac:** Screenshots direkt auf dem iPhone (TestFlight-Build) machen – Seitentaste + Lauter.
Ein iPhone 15/16 Pro Max liefert direkt 6,9"-Format; andere iPhones: Bilder auf 1320 × 2868
bringen (z. B. mit einem Rahmen-Werkzeug), **nicht verzerren**.

Für jeden In-App-Kauf zusätzlich **ein Screenshot** des Kauffensters (nur für die Prüfung, nicht öffentlich).

## 2. App-Datenschutz („Nutrition Labels“)

App Store Connect → App → **App-Datenschutz**. Antworten so wie im Google-Play-Formular:

**Erfasst die App Daten?** → Ja.

| Apple-Kategorie | Datentyp | Zweck | Mit Identität verknüpft? | Tracking? | Wann |
|---|---|---|---|---|---|
| Käufe | **Kaufverlauf** | App-Funktionalität | Nein | Nein | KI-Pakete: Kauf wird beim Ordela-Server gutgeschrieben |
| Kennungen | **Geräte-ID** | App-Funktionalität | Nein | Nein | zufällige Guthaben-Id der App (kein Werbe-ID, kein Konto) |
| Benutzerinhalte | **Fotos oder Videos** | App-Funktionalität | Nein | Nein | nur bei KI-Brieferklärung |
| Benutzerinhalte | **Andere Benutzerinhalte** (Dokumente/Brieftext) | App-Funktionalität | Nein | Nein | nur bei KI-Brieferklärung |
| Gesundheit und Fitness | **Gesundheit** | App-Funktionalität | Nein | Nein | nur wenn ein Brief Gesundheitsdaten enthält und per KI erklärt wird |

**Nicht** angeben:
- **Kalender-Abos:** werden nur durchgereicht (nichts gespeichert, Echtzeit) → zählt bei Apple nicht als „erfasst“.
- Name/Passwort des Profils, Aufgaben, Termine, Notfalldaten: bleiben **nur auf dem Gerät** → nicht erfasst.
- Keine Analyse, keine Werbung, kein Tracking → Frage „Tracking“ mit **Nein** beantworten.

Das gleiche steht maschinenlesbar in `ios/App/App/PrivacyInfo.xcprivacy`.

**Datenschutzerklärung-URL:** `https://darekkk80-neuss.github.io/Effyra/datenschutz.html`
> Ergänzt am 29.10.2026 (de/en/tr/uk, PR „Rechtstexte: Apple App Store“): Käufe in der iOS-App laufen über **Apple (App Store)**;
> der Ordela-Worker fragt dazu die Transaktion bei Apple ab (App Store Server API). Bisher nennt
> der Text nur Google Play.

## 3. Prüfhinweise für Apple (App Review → „Notizen“)

**Anmeldedaten:** „Anmeldung erforderlich“ **ausschalten** – es gibt kein Server-Konto.

Text für das Notizfeld (Englisch):

```
Ordela is a local-first organizer for letters, deadlines and everyday tasks.
There is NO server account: all data stays on the device.

How to sign in: on first launch choose "Create your profile" and enter ANY nickname and
ANY password (e.g. "Review" / "review123"). This creates a local profile on the
device only.

Native features used:
- Camera: Documents tab → tap the upload area → "Take a photo of a letter" (letter scan with cropping).
- Local notifications: create a task with a due date and a reminder ("1 hour before");
  the reminder is scheduled as a local notification and fires even when the app is closed.
- Files/Share: Settings → "Save backup" exports a backup file via the iOS share sheet.

In-app purchases (StoreKit):
- "ordela_plus" (non-consumable): Settings → "Ordela Plus" → buy / "Restore purchase".
- "ordela_ki_25" / "ordela_ki_50" (consumable): Settings → "AI pack: explain letters" → "Buy pack".
  Credits are used for AI letter explanations (Documents → scan → "Explain").
  The AI is optional; all core features are free and work offline.

AI explanations are processed by OpenAI only when the user explicitly requests them
and has given consent in the app. Nothing is used for tracking or advertising.
```

## 4. Weitere Angaben

| Feld | Vorschlag |
|---|---|
| Kategorie | Produktivität (zweite: Lifestyle) |
| Altersfreigabe | 4+ (keine bedenklichen Inhalte; KI nur auf Wunsch) – im Fragebogen „Uneingeschränkter Webzugriff“: Nein |
| Preis der App | Kostenlos (mit In-App-Käufen) |
| Support-URL | `https://darekkk80-neuss.github.io/Effyra/impressum.html` |
| Marketing-URL | `https://darekkk80-neuss.github.io/Effyra/` |
| Copyright | 2026 Gonsoft Labs |
| Exportkonformität | nur Standard-Verschlüsselung → in `Info.plist` als `ITSAppUsesNonExemptEncryption = NO` hinterlegt |
| Konto löschen (Richtlinie 5.1.1(v)) | erfüllt: kein Server-Konto; Profil + Daten lassen sich in den Einstellungen löschen |
