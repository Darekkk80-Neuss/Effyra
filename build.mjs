/*
 * Effyra Build – minifiziert NUR inline-JS und -CSS.
 *
 * Quelle (lesbar, bearbeiten):  index.dev.html
 * Ausgabe (deployen):           index.html   (minifiziert)
 *
 * Bewusst NICHT:
 *   - keine HTML-Minifizierung (die HTML hat tolerante Eigenheiten, die
 *     ein strenger HTML-Parser ablehnt – Browser tolerieren sie)
 *   - keine Identifier-Umbenennung (minifyIdentifiers:false), damit globale
 *     Funktionen / inline-Handler / window-Referenzen NICHT brechen
 *
 * Nutzung:  node build.mjs   (bzw.  npm run build)
 * Einmalig vorher:  npm install
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { transform } from 'esbuild';

const SRC = 'index.dev.html';
const OUT = 'index.html';
const JS_TYPES = /^(?:text\/javascript|application\/javascript|module)$/;

let html = readFileSync(SRC, 'utf8');
let styleCount = 0, scriptCount = 0, skipped = 0;

// ---- CSS: inline <style> ... </style> ----
const styleBlocks = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)];
for (const m of styleBlocks) {
  const [full, attrs, css] = m;
  if (!css.trim()) continue;
  const { code } = await transform(css, { loader: 'css', minify: true });
  const rep = `<style${attrs}>${code.trimEnd()}</style>`;
  html = html.replace(full, () => rep);   // Funktion -> keine $-Muster-Interpretation
  styleCount++;
}

// ---- JS: inline <script> ... </script> (externe/Nicht-JS überspringen) ----
const scriptBlocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
for (const m of scriptBlocks) {
  const [full, attrs, js] = m;
  if (/\bsrc\s*=/i.test(attrs)) { skipped++; continue; }          // externes Script
  const t = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i);
  if (t && !JS_TYPES.test(t[1].toLowerCase())) { skipped++; continue; } // z. B. application/json
  if (!js.trim()) continue;
  const { code } = await transform(js, {
    loader: 'js',
    target: 'es2015',
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: true,    // sicher: keine inline-Handler / kein window.X / kein eval; alles in IIFEs
    legalComments: 'none',
  });
  const rep = `<script${attrs}>${code.trimEnd()}</script>`;
  html = html.replace(full, () => rep);   // Funktion -> keine $-Muster-Interpretation
  scriptCount++;
}

writeFileSync(OUT, html);

const kb = n => (n / 1024).toFixed(0);
const srcSize = statSync(SRC).size, outSize = statSync(OUT).size;
const srcGz = gzipSync(readFileSync(SRC)).length, outGz = gzipSync(readFileSync(OUT)).length;
console.log(`\nMinifiziert: ${styleCount} <style>, ${scriptCount} <script> (${skipped} uebersprungen)`);
console.log(`Quelle  ${SRC}: ${kb(srcSize)} KB roh | ${kb(srcGz)} KB gzip`);
console.log(`Ausgabe ${OUT}: ${kb(outSize)} KB roh | ${kb(outGz)} KB gzip`);
console.log(`Ersparnis: ${(100 - outSize / srcSize * 100).toFixed(0)}% roh, ${(100 - outGz / srcGz * 100).toFixed(0)}% gzip\n`);
