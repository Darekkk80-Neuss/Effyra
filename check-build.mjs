/* Effyra – prueft, ob index.html aus der aktuellen index.dev.html gebaut wurde.
 *
 * WARUM
 * index.html ist ein Build-Artefakt (build.mjs). Nichts erzwang den Build: wer
 * index.dev.html aenderte, committete und `node build.mjs` vergass, veroeffentlichte
 * die ALTE Fassung – ohne Fehler, ohne Hinweis, erst im Feld sichtbar. Bei
 * mehreren parallel arbeitenden Sitzungen ist das eine Frage der Zeit.
 *
 * WIE
 * build.mjs stempelt einen Fingerabdruck der Quelldatei in index.html
 * (<meta name="effyra-src">). Hier wird nur nachgerechnet. Bewusst OHNE Neubau:
 *
 *   - Ein Vergleich "neu bauen und Dateien gegenueberstellen" waere nicht
 *     moeglich, weil build.mjs eine ZEITBASIERTE Bau-Kennung einstempelt. Zwei
 *     Laeufe erzeugen nie dieselbe Datei; die Pruefung wuerde jeden Commit
 *     ablehnen, auch den frisch gebauten – und waere binnen eines Tages per
 *     --no-verify tot.
 *   - Der Fingerabdruck haengt dagegen nur am Inhalt der Quelle und ist damit
 *     reproduzierbar.
 *
 * Aufruf: node check-build.mjs   (Rueckgabe 0 = in Ordnung, 1 = veraltet)
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'index.dev.html';
const OUT = 'index.html';

let src, out;
try {
  src = readFileSync(SRC);
  out = readFileSync(OUT, 'utf8');
} catch (e) {
  console.error(`check-build: ${e.message}`);
  process.exit(1);
}

const soll = createHash('sha256').update(src).digest('hex').slice(0, 16);
const m = /<meta name="effyra-src" content="([^"]*)">/.exec(out);

if (!m) {
  console.error(`check-build: ${OUT} traegt keinen Quell-Fingerabdruck.`);
  console.error('  -> node build.mjs ausfuehren und beide Dateien committen.');
  process.exit(1);
}

if (m[1] !== soll) {
  console.error('check-build: index.html ist NICHT aus der aktuellen index.dev.html gebaut.');
  console.error(`  erwartet ${soll}, gefunden ${m[1]}`);
  console.error('  -> node build.mjs ausfuehren, dann index.html mitcommitten.');
  process.exit(1);
}

/* Zusaetzlich: parst das ausgelieferte JavaScript ueberhaupt?
 *
 * Der Fingerabdruck oben sagt nur "aus dieser Quelle gebaut" – nicht "laeuft".
 * Ein Syntaxfehler in index.dev.html haette hier bisher fehlerfrei bestanden und
 * waere ausgeliefert worden: der Browser bricht dann den GESAMTEN Skriptblock ab,
 * die Seite rendert noch (statisches HTML), aber keine einzige Funktion existiert.
 * Genau dieser Ausfall ist von aussen kaum von einem Logikfehler zu unterscheiden.
 * Ein Parser-Durchlauf kostet Millisekunden und schliesst das aus.
 */
let esbuild;
try { esbuild = (await import('esbuild')).default ?? (await import('esbuild')); }
catch { esbuild = null; }

if (esbuild) {
  let geprueft = 0, kaputt = 0;
  for (const [name, html] of [[OUT, out], [SRC, src.toString('utf8')]]) {
    // Nur Inline-Bloecke (mit src= laedt der Browser separat).
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m2, nr = 0;
    while ((m2 = re.exec(html))) {
      nr++;
      const code = m2[1];
      if (!code.trim()) continue;
      geprueft++;
      try { esbuild.transformSync(code, { loader: 'js' }); }
      catch (e) {
        kaputt++;
        console.error(`check-build: SYNTAXFEHLER in ${name}, Skriptblock ${nr}`);
        console.error(`  ${String(e.message).split('\n')[0]}`);
      }
    }
  }
  if (kaputt) {
    console.error('  -> Diese Fassung wuerde im Browser GAR NICHT laufen. Nicht ausliefern.');
    process.exit(1);
  }
  console.log(`check-build: ${geprueft} Inline-Skripte parsen sauber.`);
}

console.log(`check-build: index.html passt zur Quelle (${soll}).`);
