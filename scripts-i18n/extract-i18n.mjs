#!/usr/bin/env node
// Extrahiert ALLE zu uebersetzenden Sprach-Objekte aus index.dev.html.
// Ausgabe: scratch/i18n-manifest.json  mit:
//   strings : { <deutscherText>: { en } }         // eindeutige Quelltexte (dedupliziert)
//   inline  : [ { offset, de } ]                   // Einfuege-Positionen (nach pl-Wert) je Objekt
//   i18n    : { <key>: { de, en } }                // I18N-Dict-Keys (Basis de)
//   complex : [ { line, reason } ]                 // Objekte, die NICHT automatisch injizierbar sind
// Die Offsets sind absolute Zeichen-Positionen in index.dev.html.
import fs from 'fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const SRC = fs.readFileSync('index.dev.html', 'utf8');
const OUT = 'scripts-i18n/i18n-manifest.json';

function inlineScripts(html) {
  const out = []; const re = /<script>\n?/g; let m;
  while ((m = re.exec(html))) {
    const start = m.index + m[0].length;
    const end = html.indexOf('</script>', start);
    if (end < 0) continue;
    out.push({ code: html.slice(start, end), offset: start });
    re.lastIndex = end;
  }
  return out;
}
const keyName = (p) => !p.key ? null : (p.key.type === 'Identifier' ? p.key.name : (p.key.type === 'Literal' ? String(p.key.value) : null));
const litVal = (node) => {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis.map(q => q.cooked).join('');
  return undefined; // komplex (Concat/Interpolation)
};

const strings = {};        // deText -> {en}
const inline = [];         // {offset, de}
const i18n = {};           // key -> {de,en}
const complex = [];
let objCount = 0;

for (const blk of inlineScripts(SRC)) {
  let ast;
  try { ast = acorn.parse(blk.code, { ecmaVersion: 'latest', locations: true, sourceType: 'script' }); }
  catch (e) { console.error('Parse-Fehler:', e.message); process.exit(2); }
  walk.ancestor(ast, {
    ObjectExpression(node, _st, ancestors) {
      const props = {};
      for (const p of node.properties) if (p.type === 'Property') { const k = keyName(p); if (k) props[k] = p; }
      if (!('pl' in props)) return;                         // nur Sprach-Maps
      const plVal = props.pl.value;
      if (plVal.type === 'ObjectExpression') return;        // I18N-Top-Level -> separat behandelt
      objCount++;
      // Deutscher Quelltext: entweder de-Property, sonst Eltern-Property-Key (TDICT)
      let de = null;
      if (props.de) de = litVal(props.de.value);
      if (de == null) {
        const parent = ancestors[ancestors.length - 2];
        if (parent && parent.type === 'Property') de = keyName(parent);
      }
      const en = props.en ? litVal(props.en.value) : null;
      const plv = litVal(plVal);
      if (de === undefined || plv === undefined || de == null) {
        complex.push({ line: node.loc.start.line + SRC.slice(0, blk.offset).split('\n').length - 1, reason: 'nicht-literaler Wert' });
        return;
      }
      // Einfuege-Offset = Ende des pl-Wertes (absolut)
      const offset = plVal.end + blk.offset;
      inline.push({ offset, de });
      if (!(de in strings)) strings[de] = { en: en || '' };
    }
  });
}

// ---- I18N-Dict (Basis de) ----
function evalNamed(name) {
  const at = SRC.indexOf('const ' + name + ' = {'); if (at < 0) return null;
  const bs = SRC.indexOf('{', at); let d = 0, i = bs, q = 0, e = 0;
  for (; i < SRC.length; i++) { const c = SRC[i];
    if (q) { if (e) e = 0; else if (c === '\\') e = 1; else if (c === q) q = 0; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  try { return (0, eval)('(' + SRC.slice(bs, i + 1) + ')'); } catch (er) { return null; }
}
const I18N = evalNamed('I18N');
if (I18N) for (const k of Object.keys(I18N.de || {})) {
  i18n[k] = { de: I18N.de[k], en: (I18N.en || {})[k] || '' };
  if (!(I18N.de[k] in strings)) strings[I18N.de[k]] = { en: (I18N.en || {})[k] || '' };
}

fs.mkdirSync('scripts-i18n', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ strings, inline, i18n, complex }, null, 0));
console.log(`Objekte (inline, injizierbar): ${inline.length}`);
console.log(`Eindeutige Quelltexte (dedupliziert): ${Object.keys(strings).length}`);
console.log(`I18N-Dict-Keys: ${Object.keys(i18n).length}`);
console.log(`Komplex (manuell): ${complex.length}` + (complex.length ? ' → ' + complex.slice(0, 8).map(c => c.line).join(',') : ''));
console.log(`Manifest → ${OUT}`);
