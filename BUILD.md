# Effyra – Build

Die App ist eine einzelne HTML-Datei. Für schnelleres Laden wird die
ausgelieferte `index.html` **minifiziert** (nur inline-JS und -CSS).

## ⚠️ Wichtig
- **Bearbeite immer `index.dev.html`** (lesbare Quelle) – NICHT `index.html`.
- `index.html` ist die **minifizierte Ausgabe** von `build.mjs` und wird deployt.

## Build
```
npm install        # einmalig – installiert esbuild lokal (node_modules, nicht deployt)
node build.mjs     # bzw. npm run build  →  erzeugt minifizierte index.html
```

## Deployen (wie bisher)
1. `node build.mjs` – `index.html` neu erzeugen
2. `git add index.dev.html index.html build.mjs package.json .gitignore BUILD.md`
3. commit + push origin master
4. ggf. Pages-Build anstoßen:
   `gh api -X POST repos/Darekkk80-Neuss/Effyra/pages/builds`

## Was der Build macht
- Minifiziert die **inline-`<script>`-Blöcke** (esbuild) und den **`<style>`-Block**.
- **Identifier-Minifizierung ist an** – sicher, weil die App keine inline-Handler
  (`onclick=` …), kein `window.X = …`, kein `eval`/`with` nutzt und alles in IIFEs kapselt.
- **Keine HTML-Minifizierung** – die HTML hat tolerante Eigenheiten, die ein strenger
  HTML-Minifier ablehnt (Browser tolerieren sie); die HTML ist mit ~70 KB ohnehin klein.
- Das externe Supabase-CDN-`<script src=…>` wird übersprungen.

## Ergebnis
~877 KB → **~688 KB** roh · ~258 KB → **~212 KB** gzip (≈ 18 % über das Netz).
Verifiziert: App rendert, 0 Konsolenfehler, Event-Handler (z. B. Theme-Umschaltung) funktionieren.
