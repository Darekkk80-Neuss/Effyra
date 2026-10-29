/* Kopiert die FERTIG GEBAUTE Web-App (../index.html + Dateien) nach www/.
   Die App laeuft damit komplett vom Geraet – ohne GitHub Pages, auch offline.
   Bewusst NICHT: index.dev.html (Quelle), sw.js (Service Worker laeuft in der
   iOS-WebView nicht), Supabase (offline-Version), Werbe- und Store-Dateien.
   Vorher im Hauptordner bauen: node build.mjs */
import { cpSync, mkdirSync, rmSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const OUT = join(here, '..', 'www');

const SKIP_FILES = new Set(['index.dev.html', 'werbespot.html', 'demo-scan.html', 'sw.js',
  'package.json', 'package-lock.json', 'twa-manifest.json', 'store-feature-graphic.png']);
const ROOT_EXT = /\.(html|json|png|jpg|svg|webmanifest)$/i;
const DIRS = ['fonts', 'translation', 'vendor', 'effyrafit_heroes'];
const SKIP_IN_DIRS = new Set(['supabase.min.js']);

if (!existsSync(join(ROOT, 'index.html'))) { console.error('index.html fehlt – erst im Hauptordner "node build.mjs" ausfuehren.'); process.exit(1); }
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let n = 0;
for (const f of readdirSync(ROOT)) {
  if (SKIP_FILES.has(f) || !ROOT_EXT.test(f) || !statSync(join(ROOT, f)).isFile()) continue;
  cpSync(join(ROOT, f), join(OUT, f)); n++;
}
for (const d of DIRS) {
  if (!existsSync(join(ROOT, d))) continue;
  cpSync(join(ROOT, d), join(OUT, d), { recursive: true, filter: (src) => !SKIP_IN_DIRS.has(src.split(/[\/]/).pop()) });
  n++;
}
console.log('www/ bereit: ' + n + ' Dateien/Ordner aus ' + ROOT);
