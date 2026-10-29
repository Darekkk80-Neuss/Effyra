# Ordela für iPhone – Schritt-für-Schritt-Anleitung

Dieser Ordner macht aus der fertigen Web-App (`index.html` im Hauptordner) eine
echte iPhone-App. Gebaut wird **in der Cloud bei Codemagic** – ein Mac ist nicht nötig.

**Kurz erklärt:**

- Die App enthält alle Dateien selbst und funktioniert auch **offline**, ohne GitHub Pages.
- Auf dem iPhone nutzt Ordela echte iPhone-Funktionen: **Kamera** (Brief scannen),
  **Erinnerungen** (kommen auch bei geschlossener App), **Teilen/Dateien** (Sicherung,
  Exporte) und eine zusätzliche **Datensicherung im App-Ordner**.
- Käufe laufen über **Apple** (Ordela Plus und KI-Pakete). In Android und im Browser
  bleibt alles wie bisher (Google Play).

| Wert | Inhalt |
|---|---|
| Bundle-ID | `app.ordela.ios` |
| App-Name | Ordela |
| Produkte | `ordela_plus` (Nicht-Verbrauchsartikel), `ordela_ki_25`, `ordela_ki_50` (Verbrauchsartikel) |
| Mindest-iOS | 15 |
| Geräte | nur iPhone (läuft auf dem iPad im iPhone-Modus) |

---

## Teil A – Einmalig bei Apple einrichten

Du brauchst dafür nur einen Browser.

### A1. App-ID anlegen
1. Öffne https://developer.apple.com/account → **Certificates, Identifiers & Profiles** → **Identifiers** → **+**.
2. **App IDs** → **App** → Weiter.
3. Beschreibung: `Ordela`, Bundle ID **Explicit**: `app.ordela.ios`.
4. Bei den Fähigkeiten musst du nichts ankreuzen (In-App-Käufe sind automatisch dabei). → **Register**.

### A2. App in App Store Connect anlegen
1. https://appstoreconnect.apple.com → **Apps** → **+** → **Neue App**.
2. Plattform **iOS**, Name **Ordela** (falls vergeben: „Ordela – Briefe & Fristen“), Primärsprache **Deutsch**,
   Bundle-ID `app.ordela.ios`, SKU z. B. `ordela-ios`, Zugriff **Voller Zugriff**.

### A3. Verträge prüfen
**Business** (früher „Verträge, Steuern und Bankwesen“): Der Vertrag für **kostenpflichtige Apps**
muss **aktiv** sein, sonst lassen sich keine Käufe testen.

### A4. In-App-Käufe anlegen
In deiner App → **Monetarisierung → In-App-Käufe** → **+**:

| Typ | Referenzname | Produkt-ID | Preis |
|---|---|---|---|
| Nicht-Verbrauchsartikel | Ordela Plus | `ordela_plus` | 9,99 € |
| Verbrauchsartikel | KI-Paket 25 Briefe | `ordela_ki_25` | 3,99 € |
| Verbrauchsartikel | KI-Paket 50 Briefe | `ordela_ki_50` | 6,99 € |

Für jedes Produkt: Anzeigename + Beschreibung (Deutsch und Englisch), Preis, und für die
Prüfung einen **Screenshot** des Kauf-Fensters (kannst du nach dem ersten TestFlight-Build machen).
Die Produkt-IDs müssen **genau** so heißen – sie stehen so im Code und im Worker.

### A5. Schlüssel für Codemagic (App Store Connect API)
1. App Store Connect → **Benutzer und Zugriff** → **Integrationen** → **App Store Connect API** → **Team-Schlüssel** → **+**.
2. Name `Codemagic`, Zugriff **App Manager** → Erstellen.
3. **API-Schlüssel herunterladen** (`.p8`-Datei – geht nur **einmal**, gut aufheben!).
4. Notiere **Aussteller-ID** (Issuer ID, oben auf der Seite) und **Schlüssel-ID** (Key ID).

### A6. Schlüssel für den Kauf-Server (In-App-Kauf-Schlüssel)
Damit der Ordela-Worker KI-Pakete bei Apple prüfen kann:
1. App Store Connect → **Benutzer und Zugriff** → **Integrationen** → **In-App-Kauf** → **+**.
2. Name `Ordela Worker` → Erstellen → **.p8-Datei herunterladen** (nur einmal möglich).
3. Notiere die **Schlüssel-ID**. Die **Aussteller-ID** ist dieselbe wie in A5.

> Diese Schlüssel gehören **niemals** ins Repo, in Chats oder E-Mails.

---

## Teil B – Kauf-Server (Cloudflare-Worker) für Apple freischalten

Der Worker `ordela-ki` prüft KI-Paket-Käufe jetzt auch bei Apple. Die neuen Einstellungen
in `ki-worker/wrangler.toml` (`APPLE_BUNDLE_ID`, `APPLE_SANDBOX`, erlaubter Ursprung
`capacitor://localhost`) kommen mit dem Pull Request. Die **Geheimnisse** trägst du selbst ein:

**Variante 1 – Cloudflare-Dashboard (ohne Kommandozeile):**
Workers & Pages → `ordela-ki` → **Settings → Variables and Secrets** → **Add** → Typ **Secret**:

| Name | Wert |
|---|---|
| `APPLE_IAP_KEY` | kompletter Inhalt der `.p8`-Datei aus A6 (mit `-----BEGIN PRIVATE KEY-----` …) |
| `APPLE_KEY_ID` | Schlüssel-ID aus A6 |
| `APPLE_ISSUER_ID` | Aussteller-ID aus A5 |

**Variante 2 – Kommandozeile** (im Ordner `ki-worker`, fragt den Wert verdeckt ab):
```
npx wrangler@4 secret put APPLE_IAP_KEY
npx wrangler@4 secret put APPLE_KEY_ID
npx wrangler@4 secret put APPLE_ISSUER_ID
```

Danach den Worker **neu veröffentlichen** (nach dem Merge des PR): `npx wrangler@4 deploy` im Ordner `ki-worker`.
Erst dann kennt der Live-Worker die iOS-App.

`APPLE_SANDBOX = "1"` erlaubt Test-Käufe aus TestFlight. Das ist Apples empfohlenes Vorgehen
(erst echte Käufe, dann Sandbox prüfen) und kann so bleiben.

---

## Teil C – Codemagic einrichten

1. https://codemagic.io → anmelden → **Add application** → GitHub → Repository **Effyra** →
   Projekttyp **„Other“** bzw. **„codemagic.yaml“**.
2. **Settings → Integrations → Developer Portal**: Hier ist schon der Schlüssel von RIVELLO
   eingetragen (Name **`RIVELLO_ASC`**). Teamschlüssel gelten für alle Apps des Kontos – Ordela
   nutzt ihn mit, `codemagic.yaml` verweist genau auf diesen Namen. Nur falls er fehlt:
   **Add key** → Name `RIVELLO_ASC`, Issuer ID, Key ID und `.p8`-Datei aus **A5**.
3. **Bereitstellungsprofil** (einmalig): developer.apple.com → Profiles → **+** → *App Store Connect* →
   App-ID `app.ordela.ios` → das vorhandene Vertriebszertifikat → Name `Ordela App Store` → Generate.
   Dann in Codemagic **Settings → Code signing identities → iOS provisioning profiles → Fetch profiles**
   → „Ordela App Store“ anhaken, Referenzname `ordela_appstore` → *Download selected*.
   Das Vertriebszertifikat (`rivello_dist`) liegt dort schon und gilt für beide Apps.
4. **Repository:** Das Codemagic-GitHub-Konto sieht nur RIVELLO. Ordela ist deshalb über
   *Add application → Other → `https://github.com/Darekkk80-Neuss/Effyra.git` → Public repository*
   eingebunden (App-Name in Codemagic: „Effyra“). Builds startet man per **Start new build**.

## Teil D – App bauen und zu TestFlight schicken

1. In Codemagic die App öffnen → **Start new build** → Branch wählen
   (vor dem Merge: `ios-app`, danach `master`) → Workflow **„Ordela iOS → TestFlight“** → **Start**.
2. Dauer ca. 10–20 Minuten. Grün = die App ist bei Apple hochgeladen.
3. Apple verarbeitet den Build noch 5–30 Minuten. Danach erscheint er in
   **App Store Connect → TestFlight**.
4. Bei der ersten Version fragt Apple nach der **Exportkonformität**: Ordela nutzt nur
   Standard-Verschlüsselung (HTTPS) – das ist bereits in der App hinterlegt, meist kommt keine Frage.

## Teil E – Auf dem iPhone testen

1. App Store Connect → TestFlight → **Interne Tests** → Gruppe anlegen → dich selbst hinzufügen.
2. Auf dem iPhone die App **TestFlight** öffnen → Ordela installieren.
3. **Sandbox-Konto für Testkäufe:** App Store Connect → Benutzer und Zugriff → **Sandbox** → Test-Account
   anlegen (eine neue E-Mail-Adresse, die noch keine Apple-ID ist). In TestFlight-Builds wird
   ohnehin **nichts abgebucht** – Käufe laufen automatisch im Testmodus.
4. **Testliste:**
   - [ ] Neues Profil anlegen (beliebiger Spitzname + Passwort), App startet ohne Internet.
   - [ ] Dokumente → Brief fotografieren → Kamera öffnet sich → Zuschneiden → Erklärung.
   - [ ] Aufgabe mit Erinnerung „1 Stunde vorher“ anlegen → Erlaubnis bestätigen → App schließen → Benachrichtigung kommt.
   - [ ] Einstellungen → Sicherung speichern → Teilen-Menü → „In Dateien sichern“.
   - [ ] Einstellungen → **Ordela Plus** → Preis in Euro aus dem App Store → Kaufen → „Ordela Plus aktiv“.
   - [ ] App löschen, neu installieren → Plus → **Kauf wiederherstellen** → wieder aktiv.
   - [ ] Einstellungen → **KI-Paket** → 25 Briefe kaufen → „Noch 25 Briefe übrig“ → einen Brief erklären lassen → 24.

---

## Für Entwickler

```
# im Hauptordner: Web-App bauen (wie immer)
node build.mjs

# im Ordner ios-app: Abhängigkeiten + Web-Dateien ins iOS-Projekt
npm install
npm run sync        # = scripts/copy-web.mjs (→ www/) + npx cap sync ios
```

- `scripts/copy-web.mjs` kopiert die **gebaute** `index.html` und die Dateien, die sie lädt
  (Schriften, Übersetzungen, JSON, Bilder, `vendor/` ohne Supabase, Rechtstexte).
  `sw.js` wird nicht gebraucht (Service Worker laufen in der iOS-WebView nicht).
- Capacitor 8 nutzt den **Swift Package Manager** statt CocoaPods – darum gibt es keinen
  `pod install`-Schritt; Xcode lädt die Pakete beim Bauen selbst.
- Eigenes Kauf-Modul: `ios/App/App/OrdelaStorePlugin.swift` (StoreKit 2), in JavaScript
  `window.Capacitor.Plugins.OrdelaStore`. Die Weiche Apple/Google steckt in `index.dev.html`
  (Abschnitt „Kaeufe in der iOS-App“): `plusBuy`/`plusRestore`/`kiBuy`/`kiRestore` rufen auf dem
  iPhone die Apple-Variante, sonst unverändert Google Play.
- Alles Native in `index.dev.html` hängt an `NATIVE` (nur true in der iOS-App).
- Datenschutz-Manifest: `ios/App/App/PrivacyInfo.xcprivacy`. App-Store-Unterlagen: `APP_STORE.md`.
- Neue Version: `MARKETING_VERSION` in `ios/App/App.xcodeproj/project.pbxproj` erhöhen (z. B. 1.0 → 1.1);
  die Build-Nummer zählt Codemagic selbst hoch.
