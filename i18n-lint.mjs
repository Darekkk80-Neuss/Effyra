#!/usr/bin/env node
// Effyra i18n-Vollstaendigkeits-Linter (AST-basiert, acorn)
// -----------------------------------------------------------------------------
// Findet JEDES Sprach-Objekt-Literal (Objekt mit einem `pl`-Schluessel) im
// Inline-JS von index.dev.html und prueft, ob alle geforderten Sprachen da sind.
// Deckt ab: pickLang/agentMsg-Argumente, AGENT_*-Konstanten, TDICT_SRC-Eintraege
// und den I18N-Block (dort zusaetzlich Schluessel-Tiefe je Sprache).
// Zusaetzlich: Inhalts-JSONs (behoerden/briefe/selbstfuersorge) je Sprache.
// Exit != 0 bei Luecken -> als Build-Guard nutzbar.
//   node i18n-lint.mjs [--required=de,en,fr,es,it,pl,tr,uk]
// -----------------------------------------------------------------------------
import fs from 'fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const SRC = fs.readFileSync('index.dev.html', 'utf8');
// Standard: genau die Sprachen pruefen, die als lieferbar deklariert sind (SUPPORTED_LANGS).
// So kann keine Sprache freigeschaltet werden, bevor der Linter fuer sie gruen ist.
function supportedFromSource() {
  const m = /const SUPPORTED_LANGS = \[([^\]]*)\]/.exec(SRC);
  if (!m) return ['de', 'en', 'fr', 'es', 'it', 'pl', 'tr', 'uk'];
  return m[1].split(',').map(s => s.replace(/['"\s]/g, '')).filter(Boolean);
}
const arg = process.argv.find(a => a.startsWith('--required='));
const REQUIRED = arg ? arg.split('=')[1].split(',') : supportedFromSource();
const CHECK = REQUIRED.filter(l => l !== 'de' && l !== 'en'); // de/en = Basis-Fallback

// ---- Inline-<script>-Bloecke (ohne src) mit Zeilen-Offset extrahieren ----
function inlineScripts(html) {
  const out = []; const re = /<script>\n?/g; let m;
  while ((m = re.exec(html))) {
    const start = m.index + m[0].length;
    const end = html.indexOf('</script>', start);
    if (end < 0) continue;
    const code = html.slice(start, end);
    const lineOffset = html.slice(0, start).split('\n').length; // 1-basiert
    out.push({ code, lineOffset });
    re.lastIndex = end;
  }
  return out;
}

function keyName(p) {
  if (!p.key) return null;
  if (p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'Literal') return String(p.key.value);
  return null;
}

const gaps = [];
let langObjCount = 0;
for (const blk of inlineScripts(SRC)) {
  let ast;
  try { ast = acorn.parse(blk.code, { ecmaVersion: 'latest', locations: true, sourceType: 'script' }); }
  catch (e) { console.error(`Parse-Fehler in <script> ab Zeile ${blk.lineOffset}: ${e.message}`); process.exit(2); }
  walk.simple(ast, {
    ObjectExpression(node) {
      const keys = new Set();
      for (const p of node.properties) { if (p.type === 'Property') { const k = keyName(p); if (k) keys.add(k); } }
      if (!keys.has('pl')) return;          // nur echte Sprach-Maps (pl ist ueberall vorhanden)
      langObjCount++;
      const missing = CHECK.filter(l => !keys.has(l));
      if (missing.length) gaps.push({ line: node.loc.start.line + blk.lineOffset - 1, missing });
    }
  });
}

// ---- I18N: Schluessel-Tiefe je Sprache (Basis = de) ----
function evalNamed(name) {
  const at = SRC.indexOf('const ' + name + ' = {');
  if (at < 0) return null;
  const bs = SRC.indexOf('{', at);
  let depth = 0, i = bs, inStr = 0, esc = false;
  for (; i < SRC.length; i++) { const c = SRC[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inStr) inStr = 0; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; } }
  try { return (0, eval)('(' + SRC.slice(bs, i + 1) + ')'); } catch (e) { return null; }
}
const I18N = evalNamed('I18N');
const i18nGaps = {};
if (I18N) {
  const base = Object.keys(I18N.de || {});
  for (const l of CHECK) {
    if (!I18N[l]) { i18nGaps[l] = ['<GESAMTER BLOCK fehlt>']; continue; }
    const miss = base.filter(k => !(k in I18N[l]));
    if (miss.length) i18nGaps[l] = miss;
  }
}

// ---- Inhalts-JSONs ----
const jsonGaps = [];
const ckJson = (f) => { if (!fs.existsSync(f)) jsonGaps.push(f + ' (fehlt)'); else { try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { jsonGaps.push(f + ' (ungueltig)'); } } };
// Behörden-Wegweiser = deutsche Behörden je Sprache übersetzt: behoerden.DE.<lang>.json
for (const l of CHECK) ckJson(`behoerden.DE.${l}.json`);
// Selbstfürsorge ist NICHT länderspezifisch → bleibt selbstfuersorge.<lang>.json
for (const l of CHECK) ckJson(`selbstfuersorge.${l}.json`);
// Musterbriefe = Recht des Wohnsitz-Landes, je EINE Fassung (feste Liste; Deutschland
// nutzt die eingebauten Vorlagen, hat also KEINE Datei).
for (const f of ['briefe.PL.pl.json', 'briefe.FR.fr.json', 'briefe.ES.es.json', 'briefe.IT.it.json', 'briefe.TR.tr.json', 'briefe.UA.uk.json']) ckJson(f);

// ---- Bericht ----
console.log(`i18n-Linter (acorn) — geforderte Sprachen: ${REQUIRED.join(', ')} | geprueft: ${CHECK.join(', ')}`);
console.log(`Sprach-Objekte (mit pl:): ${langObjCount}`);
const byMiss = {}; for (const g of gaps) for (const m of g.missing) byMiss[m] = (byMiss[m] || 0) + 1;
console.log(`Objekte mit Luecken: ${gaps.length}` + (gaps.length ? ` → ${Object.entries(byMiss).map(([k, v]) => k + '×' + v).join(', ')}` : ''));
for (const g of gaps.slice(0, 20)) console.log(`  Zeile ${g.line}: fehlt ${g.missing.join(',')}`);
if (gaps.length > 20) console.log(`  … +${gaps.length - 20} weitere`);
console.log('I18N-Block-Luecken: ' + (Object.keys(i18nGaps).length ? '' : 'keine ✓'));
for (const [l, ks] of Object.entries(i18nGaps)) console.log(`  ${l}: ${ks.length} Keys fehlen (${ks.slice(0, 6).join(', ')}${ks.length > 6 ? ' …' : ''})`);
console.log('Inhalts-JSON-Luecken: ' + (jsonGaps.length ? jsonGaps.join(', ') : 'keine ✓'));

const total = gaps.length + Object.keys(i18nGaps).length + jsonGaps.length;
console.log(total === 0 ? '\n✅ VOLLSTAENDIG — keine Luecken.' : `\n❌ ${total} Luecken-Gruppen offen.`);
process.exit(total === 0 ? 0 : 1);
