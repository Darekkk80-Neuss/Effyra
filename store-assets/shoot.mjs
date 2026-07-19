import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + resolve(__dir, '..', 'index.html');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = resolve(__dir, 'shots');

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, locale: 'de-DE' });
await ctx.route(/^https?:\/\//, r => r.abort());
await ctx.route('**supabase**', r => r.abort());
const page = await ctx.newPage();
const wait = ms => page.waitForTimeout(ms);
const shot = n => page.screenshot({ path: resolve(OUT, n) });
const nav = async v => { try { await page.click(`button[data-view="${v}"]`, { timeout: 2500 }); await wait(1200); return true; } catch { return false; } };

await page.goto(APP, { waitUntil: 'domcontentloaded' });
await wait(1000);

// Registrierung (lokal)
await page.fill('#auName', 'Darius'); await page.fill('#auEmail', 'darius@example.com'); await page.fill('#auPass', 'effyra2026');
await page.click('#authGo'); await wait(1800);
// Sprache
try { await page.click('#langPicker [data-lang="de"]', { timeout: 3000 }); } catch { try { await page.getByText('Deutsch').first().click({ timeout: 1500 }); } catch {} }
await wait(900);
// Onboarding
for (let i = 0; i < 5; i++) { try { await page.click('#obNext', { timeout: 1200 }); await wait(500); } catch { break; } }
for (let i = 0; i < 3; i++) { let a = false; for (const t of ['Verstanden','Später','Überspringen','Fertig','Alles klar','OK']) { try { await page.getByRole('button',{name:t}).first().click({timeout:400}); a=true; break; } catch {} } if(!a) break; await wait(300); }
await wait(500);

// Demo-Daten GENAU EINMAL laden (Aufgaben, Termine, Kind)
await nav('settings');
try { await page.click('#btnDemoData', { timeout: 2500 }); } catch (e) { console.log('demoData err', e.message.slice(0,50)); }
await wait(1500);

// Dokumenten-Analyse auslösen (Demo Beispiel-Analyse)
await nav('docs');
try {
  await page.setInputFiles('#docInput', resolve(OUT, 'dummy.jpg'));
  await wait(4800);
} catch (e) { console.log('doc err', e.message.slice(0,50)); }
await shot('view_docs.png');

// Datenreiche Views
for (const v of ['dashboard', 'calendar', 'tasks', 'life']) { await nav(v); await wait(400); await shot(`view_${v}.png`); }

console.log('DONE');
await browser.close();
