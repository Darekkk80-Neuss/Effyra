#!/usr/bin/env node
// Injiziert tr/uk-Uebersetzungen in index.dev.html anhand von Manifest + Uebersetzungen.
//   node scripts-i18n/inject-i18n.mjs --tr=<transFile> [--out=index.dev.html] [--langs=tr,uk]
// transFile: JSON  { "<deutscherText>": { "tr": "...", "uk": "..." }, ... }
// Fehlt eine Uebersetzung -> Abbruch (keine Teil-Injektion).
import fs from 'fs';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const TR_FILE = arg('tr'); const OUT = arg('out', 'index.dev.html'); const LANGS = arg('langs', 'tr,uk').split(',');
if (!TR_FILE) { console.error('--tr=<file> fehlt'); process.exit(1); }

const SRC = fs.readFileSync('index.dev.html', 'utf8');
const man = JSON.parse(fs.readFileSync('scripts-i18n/i18n-manifest.json', 'utf8'));
const T = JSON.parse(fs.readFileSync(TR_FILE, 'utf8'));

function tr(de, l) {
  const e = T[de];
  // Leerer String ist eine gueltige Uebersetzung (z. B. Suffix " Uhr", das auch EN weglaesst);
  // nur echtes Fehlen (kein Eintrag / null) ist ein Fehler.
  if (!e || e[l] == null) { console.error(`FEHLT ${l}: ${JSON.stringify(de).slice(0, 60)}`); process.exit(3); }
  return e[l];
}

// 1) Inline-Objekte: von HINTEN nach VORN einfuegen (Offsets bleiben gueltig)
let out = SRC;
const ins = man.inline.slice().sort((a, b) => b.offset - a.offset);
for (const it of ins) {
  let add = '';
  for (const l of LANGS) add += `, ${l}: ${JSON.stringify(tr(it.de, l))}`;
  out = out.slice(0, it.offset) + add + out.slice(it.offset);
}

// 2) I18N-Bloecke tr/uk hinter den pl-Block einfuegen
//    Finde `const I18N = {` -> darin `pl: {` -> dessen schliessende `}`.
function findI18nPlEnd(s) {
  const at = s.indexOf('const I18N = {'); if (at < 0) return -1;
  const plAt = s.indexOf('pl: {', at); if (plAt < 0) return -1;
  let d = 0, i = s.indexOf('{', plAt), q = 0, e = 0;
  for (; i < s.length; i++) { const c = s[i];
    if (q) { if (e) e = 0; else if (c === '\\') e = 1; else if (c === q) q = 0; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (!d) return i + 1; } }
  return -1;
}
const plEnd = findI18nPlEnd(out);
if (plEnd < 0) { console.error('I18N pl-Block nicht gefunden'); process.exit(4); }
let blocks = '';
for (const l of LANGS) {
  const entries = Object.keys(man.i18n).map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(tr(man.i18n[k].de, l))}`).join(',\n');
  blocks += `,\n  ${l}: {\n${entries}\n  }`;
}
out = out.slice(0, plEnd) + blocks + out.slice(plEnd);

fs.writeFileSync(OUT, out);
console.log(`Injiziert: ${man.inline.length} Objekte × ${LANGS.length} Sprachen + I18N-Bloecke (${LANGS.join(',')}) → ${OUT}`);
