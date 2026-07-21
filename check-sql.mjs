// Prüft das Dollar-Quoting aller .sql-Dateien.
//
// Warum es das gibt: ein kaputter Begrenzer macht die GANZE Datei unparsebar,
// und der Fehler ist beim Lesen fast unsichtbar – `end $;` statt `end $$;`.
// Zweimal ist das hier passiert, beide Male durch ein Patch-Skript: JavaScripts
// String.replace deutet `$$` im ERSATZTEXT als ein einzelnes `$`. Wer SQL mit
// replace() umschreibt, zerstört damit lautlos jede Funktion, die er verschiebt.
//
// Die Prüfung kennt benannte Begrenzer ($fn$, $func$ …) – die sind gültig und
// im Projekt in Gebrauch. Eine Prüfung, die nur `$$` zählt, schlägt dort falsch
// an und übersieht gleichzeitig echte Schäden.
//
// Aufruf: node check-sql.mjs   (Exit 1 bei Befund)
import { readFileSync, readdirSync } from 'node:fs';

const D = String.fromCharCode(36);
const BEGRENZER = new RegExp('\\' + D + '[A-Za-z_]*\\' + D, 'g');

// Einzelne Dollar sind in SQL völlig normal: Regex-Anker ('…$'), Kommentare,
// Formatangaben. Nur ein Dollar, der wie ein Begrenzer AUSSIEHT, aber keinen
// Partner hat, ist ein Schaden.
const VERDAECHTIG = new RegExp('^\\s*(as|end)\\s*\\' + D + '\\s*;?\\s*$', 'i');

let befunde = 0;
for (const datei of readdirSync('.').filter(f => f.endsWith('.sql'))) {
  const text = readFileSync(datei, 'utf8');

  const zaehler = {};
  for (const b of text.match(BEGRENZER) || []) zaehler[b] = (zaehler[b] || 0) + 1;
  for (const [b, n] of Object.entries(zaehler)) {
    if (n % 2) { console.log(`UNGERADE  ${datei}  Begrenzer ${b}: ${n}x — eine Funktion ist nicht geschlossen`); befunde++; }
  }

  text.split(/\r?\n/).forEach((zeile, i) => {
    if (VERDAECHTIG.test(zeile)) {
      console.log(`KAPUTT    ${datei}:${i + 1}  ${zeile.trim()}  — Begrenzer braucht ZWEI Dollar`);
      befunde++;
    }
  });
}

console.log(befunde ? `\n${befunde} Problem(e) – diese Dateien laufen NICHT durch.` : 'check-sql: Dollar-Quoting in allen .sql-Dateien in Ordnung.');
process.exit(befunde ? 1 : 0);
