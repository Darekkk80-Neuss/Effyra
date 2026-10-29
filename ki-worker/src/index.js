/* Ordela KI-Pakete – Cloudflare Worker.
   Kleinster moegliche Server fuer die Brief-Erklaerung ohne eigenen Schluessel:
   - POST /redeem   Google-Play-Kauf pruefen, verbrauchen, Guthaben gutschreiben
   - GET  /balance  Guthaben einer Geldboerse abfragen
   - POST /explain  Brief an OpenAI weiterreichen, 1 Brief abziehen
   - POST /ics      Kalender-Abo: ICS-Link abrufen und durchreichen (CORS)
   - POST /ack      Ordela-Plus-Kauf bei Google bestaetigen (Absicherung gegen Auto-Erstattung)
                    bzw. bei Apple pruefen (platform: 'apple')
   iOS-App: /redeem und /ack nehmen auch { platform: 'apple', transactionId, sku }.
   Der Worker fragt die Transaktion bei Apple ab (App Store Server API) – erst
   Produktion, bei "unbekannt" die Sandbox (TestFlight/Test-Kaeufe).
   Es gibt keine Konten: die App erzeugt eine zufaellige Geldboersen-Id
   (128 Bit) und schickt sie mit. Gespeichert werden nur Id + Guthaben und die
   bereits eingeloesten Kauf-Tokens – KEINE Briefe, keine Antworten.

   Geheimnisse (wrangler secret put …, nie ins Repo):
     OPENAI_API_KEY   Server-Schluessel fuer OpenAI
     GOOGLE_SA_JSON   JSON des Play-Dienstkontos (Kaufpruefung)
     APPLE_IAP_KEY    Inhalt der .p8-Datei ("In-App-Kauf"-Schluessel aus App Store Connect)
     APPLE_KEY_ID     Schluessel-ID dazu (10 Zeichen)
     APPLE_ISSUER_ID  Aussteller-ID (UUID, App Store Connect → Benutzer und Zugriff → Integrationen)
   Variablen (wrangler.toml): PACKAGE_NAME, ALLOWED_ORIGINS, SKU_CREDITS, MODEL,
     APPLE_BUNDLE_ID, APPLE_SANDBOX ("1" = Sandbox-Kaeufe annehmen, fuer TestFlight) */

const MAX_BODY = 8 * 1024 * 1024;        // ein verkleinertes Foto ist ~0,5–2 MB
const MAX_TOKENS = 3000;

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = {
      'access-control-allow-origin': allowed.includes(origin) ? origin : (allowed[0] || ''),
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      'vary': 'origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json' } });
    if (origin && !allowed.includes(origin)) return json({ error: 'origin' }, 403);

    const url = new URL(req.url);
    try {
      if (url.pathname === '/balance' && req.method === 'GET') {
        const w = wallet(url.searchParams.get('wallet'));
        if (!w) return json({ error: 'wallet' }, 400);
        return json({ ok: true, credits: await credits(env, w) });
      }
      if (url.pathname === '/redeem' && req.method === 'POST') {
        const b = await body(req);
        const w = wallet(b.wallet);
        if (b.platform === 'apple') {
          if (!w || !appleTxId(b.transactionId) || typeof b.sku !== 'string') return json({ error: 'bad_request' }, 400);
          return json(await redeemApple(env, w, b.sku, String(b.transactionId)));
        }
        if (!w || typeof b.token !== 'string' || typeof b.sku !== 'string') return json({ error: 'bad_request' }, 400);
        return json(await redeem(env, w, b.sku, b.token));
      }
      if (url.pathname === '/explain' && req.method === 'POST') {
        const b = await body(req);
        const w = wallet(b.wallet);
        if (!w || !Array.isArray(b.messages)) return json({ error: 'bad_request' }, 400);
        return await explain(env, w, b, json);
      }
      if (url.pathname === '/ack' && req.method === 'POST') {
        const b = await body(req);
        if (b.platform === 'apple') {
          if (!appleTxId(b.transactionId) || typeof b.sku !== 'string') return json({ error: 'bad_request' }, 400);
          return json(await checkApplePlus(env, b.sku, String(b.transactionId)));
        }
        if (typeof b.token !== 'string' || typeof b.sku !== 'string') return json({ error: 'bad_request' }, 400);
        return json(await acknowledge(env, b.sku, b.token));
      }
      if (url.pathname === '/ics' && req.method === 'POST') {
        const b = await body(req);
        return json(await fetchIcs(b.url));
      }
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      if (e && e.code) return json({ error: e.code }, e.status || 400);
      return json({ error: 'server' }, 500);
    }
  }
};

class Fail extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }

const wallet = (w) => (typeof w === 'string' && /^[a-f0-9]{32}$/.test(w)) ? w : null;

async function body(req) {
  const len = +req.headers.get('content-length') || 0;
  if (len > MAX_BODY) throw new Fail('too_large', 413);
  const txt = await req.text();
  if (txt.length > MAX_BODY) throw new Fail('too_large', 413);
  try { return JSON.parse(txt); } catch (e) { throw new Fail('bad_json', 400); }
}

async function credits(env, w) {
  const r = await env.DB.prepare('SELECT credits FROM wallets WHERE id = ?').bind(w).first();
  return r ? r.credits : 0;
}

/* ---------- Kauf einloesen ---------- */
async function redeem(env, w, sku, token) {
  const map = JSON.parse(env.SKU_CREDITS || '{}');
  const add = map[sku];
  if (!add) throw new Fail('unknown_sku', 400);
  // Schon eingeloest? Dann nur den Stand melden (die App darf ruhig doppelt fragen).
  const seen = await env.DB.prepare('SELECT wallet FROM redeemed WHERE token = ?').bind(token).first();
  if (seen) return { ok: true, credits: await credits(env, seen.wallet), already: true };

  /* Nur fuer `wrangler dev` (DEV_FAKE_PURCHASES=1 in .dev.vars): Test-Tokens ohne Google.
     Im Live-Worker ist die Variable nicht gesetzt. */
  if (env.DEV_FAKE_PURCHASES === '1' && token.startsWith('test-')) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO redeemed (token, wallet, sku, ts) VALUES (?, ?, ?, ?)').bind(token, w, sku, Date.now()),
      env.DB.prepare('INSERT INTO wallets (id, credits, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET credits = credits + excluded.credits, updated = excluded.updated').bind(w, add, Date.now())
    ]);
    return { ok: true, credits: await credits(env, w) };
  }

  const at = await googleToken(env);
  const base ='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    encodeURIComponent(env.PACKAGE_NAME) + '/purchases/products/' + encodeURIComponent(sku) + '/tokens/' + encodeURIComponent(token);
  const r = await fetch(base, { headers: { authorization: 'Bearer ' + at } });
  // 401/403 = Dienstkonto (noch) ohne Rechte in der Play Console – von „Kauf unbekannt" trennen.
  if (r.status === 401 || r.status === 403) throw new Fail('google_permission', 503);
  if (!r.ok) throw new Fail('purchase_not_found', 402);
  const p = await r.json();
  if (p.purchaseState !== 0) throw new Fail('purchase_not_completed', 402);   // 0 = gekauft, 1 = storniert, 2 = ausstehend

  // Erst gutschreiben (Token als Sperre), dann bei Google verbrauchen, damit das Paket wieder kaufbar ist.
  await env.DB.batch([
    env.DB.prepare('INSERT INTO redeemed (token, wallet, sku, ts) VALUES (?, ?, ?, ?)').bind(token, w, sku, Date.now()),
    env.DB.prepare('INSERT INTO wallets (id, credits, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET credits = credits + excluded.credits, updated = excluded.updated').bind(w, add, Date.now())
  ]);
  if (p.consumptionState === 0) {
    await fetch(base + ':consume', { method: 'POST', headers: { authorization: 'Bearer ' + at } }).catch(() => {});
  }
  return { ok: true, credits: await credits(env, w) };
}

/* ---------- Einmalkauf bestaetigen (Ordela Plus) ----------
   Google erstattet Kaeufe, die nicht binnen 3 Tagen bestaetigt werden. Die App
   bestaetigt ueber die Billing-Bibliothek; dieser Aufruf ist die Absicherung
   und darf beliebig oft kommen (bereits bestaetigt = nichts zu tun). */
async function acknowledge(env, sku, token) {
  const allowed = (env.ACK_SKUS || 'ordela_plus').split(',').map(s => s.trim());
  if (!allowed.includes(sku)) throw new Fail('unknown_sku', 400);
  const at = await googleToken(env);
  const base = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    encodeURIComponent(env.PACKAGE_NAME) + '/purchases/products/' + encodeURIComponent(sku) + '/tokens/' + encodeURIComponent(token);
  const r = await fetch(base, { headers: { authorization: 'Bearer ' + at } });
  if (r.status === 401 || r.status === 403) throw new Fail('google_permission', 503);
  if (!r.ok) throw new Fail('purchase_not_found', 402);
  const p = await r.json();
  if (p.purchaseState !== 0) return { ok: false, state: p.purchaseState };   // storniert/ausstehend: nicht bestaetigen
  if (p.acknowledgementState === 1) return { ok: true, acknowledged: true, already: true };
  const a = await fetch(base + ':acknowledge', { method: 'POST', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' }, body: '{}' });
  if (!a.ok) throw new Fail('ack_failed', 502);
  return { ok: true, acknowledged: true };
}

/* ---------- Apple (iOS-App) ----------
   Die App schickt nur die Transaktions-Id. Der Worker holt die Transaktion selbst
   bei Apple (App Store Server API, signiertes JWT mit dem In-App-Kauf-Schluessel)
   – eine gefaelschte Id kann so nichts gutschreiben. Antwort kommt als JWS ueber
   TLS direkt von Apple; geprueft werden Bundle-Id, Produkt, Erstattung und bei
   KI-Paketen, dass der Kauf fuer genau diese Geldboerse gemacht wurde
   (appAccountToken = Geldboersen-Id als UUID). */
const appleTxId = (v) => (typeof v === 'string' || typeof v === 'number') && /^\d{1,20}$/.test(String(v));
const walletToUuid = (w) => w.slice(0, 8) + '-' + w.slice(8, 12) + '-' + w.slice(12, 16) + '-' + w.slice(16, 20) + '-' + w.slice(20, 32);

async function redeemApple(env, w, sku, txId) {
  const map = JSON.parse(env.SKU_CREDITS || '{}');
  const add = map[sku];
  if (!add) throw new Fail('unknown_sku', 400);
  const key = 'apple:' + txId;
  const seen = await env.DB.prepare('SELECT wallet FROM redeemed WHERE token = ?').bind(key).first();
  if (seen) return { ok: true, credits: await credits(env, seen.wallet), already: true };

  if (!(env.DEV_FAKE_PURCHASES === '1' && txId.startsWith('9999'))) {
    const tx = await appleTransaction(env, txId);
    if (tx.productId !== sku) throw new Fail('wrong_product', 402);
    if (tx.type && tx.type !== 'Consumable') throw new Fail('wrong_product', 402);
    if (tx.revocationDate) throw new Fail('purchase_revoked', 402);
    if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== walletToUuid(w)) throw new Fail('wallet_mismatch', 403);
  }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO redeemed (token, wallet, sku, ts) VALUES (?, ?, ?, ?)').bind(key, w, sku, Date.now()),
    env.DB.prepare('INSERT INTO wallets (id, credits, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET credits = credits + excluded.credits, updated = excluded.updated').bind(w, add, Date.now())
  ]);
  return { ok: true, credits: await credits(env, w) };
}

/* Plus (Einmalkauf): nur pruefen und Ergebnis melden – freigeschaltet wird in der
   App (StoreKit prueft dort selbst). Dient als Gegenprobe/Protokoll wie /ack bei Google. */
async function checkApplePlus(env, sku, txId) {
  const allowed = (env.ACK_SKUS || 'ordela_plus').split(',').map(s => s.trim());
  if (!allowed.includes(sku)) throw new Fail('unknown_sku', 400);
  const tx = await appleTransaction(env, txId);
  if (tx.productId !== sku) throw new Fail('wrong_product', 402);
  return { ok: !tx.revocationDate, active: !tx.revocationDate, environment: tx.environment };
}

async function appleTransaction(env, txId) {
  const jwt = await appleJwt(env);
  const hosts = ['https://api.storekit.itunes.apple.com'];
  if (env.APPLE_SANDBOX === '1') hosts.push('https://api.storekit-sandbox.itunes.apple.com');
  for (const host of hosts) {
    const r = await fetch(host + '/inApps/v1/transactions/' + encodeURIComponent(txId), { headers: { authorization: 'Bearer ' + jwt } });
    if (r.status === 401) throw new Fail('apple_auth', 503);
    if (r.status === 404) continue;            // in dieser Umgebung unbekannt → naechste
    if (!r.ok) throw new Fail('apple_unreachable', 502);
    const j = await r.json();
    const tx = jwsPayload(j.signedTransactionInfo);
    if (!tx || tx.bundleId !== env.APPLE_BUNDLE_ID) throw new Fail('wrong_app', 402);
    return tx;
  }
  throw new Fail('purchase_not_found', 402);
}

function jwsPayload(jws) {
  try {
    const p = String(jws).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(p + '='.repeat((4 - p.length % 4) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  } catch (e) { return null; }
}

/* JWT fuer die App Store Server API (ES256, hoechstens 60 Min. gueltig). */
let appleTok = null;
async function appleJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  if (appleTok && appleTok.exp > now + 60) return appleTok.v;
  if (!env.APPLE_IAP_KEY || !env.APPLE_KEY_ID || !env.APPLE_ISSUER_ID || !env.APPLE_BUNDLE_ID) throw new Fail('server_not_configured', 503);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const exp = now + 1800;
  const unsigned = enc({ alg: 'ES256', kid: env.APPLE_KEY_ID, typ: 'JWT' }) + '.' + enc({
    iss: env.APPLE_ISSUER_ID, iat: now, exp, aud: 'appstoreconnect-v1', bid: env.APPLE_BUNDLE_ID
  });
  const pem = env.APPLE_IAP_KEY.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  appleTok = { v: unsigned + '.' + b64url(new Uint8Array(sig)), exp };   // WebCrypto liefert ES256 bereits im JWS-Format (r||s)
  return appleTok.v;
}

/* Zugriffstoken fuer die Play Developer API aus dem Dienstkonto (JWT, RS256).
   Wird ~55 Min. in D1 zwischengespeichert – die RSA-Signatur ist die einzige
   teure Rechenarbeit und soll nicht bei jedem Kauf anfallen. */
let memTok = null;
async function googleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (memTok && memTok.exp > now + 60) return memTok.v;
  const row = await env.DB.prepare("SELECT v, exp FROM meta WHERE k = 'gtoken'").first();
  if (row && row.exp > now + 60) { memTok = row; return row.v; }

  const sa = JSON.parse(env.GOOGLE_SA_JSON || '{}');
  if (!sa.client_email || !sa.private_key) throw new Fail('server_not_configured', 503);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + unsigned + '.' + b64url(new Uint8Array(sig))
  });
  const j = await r.json();
  if (!j.access_token) throw new Fail('google_auth', 503);
  memTok = { v: j.access_token, exp: now + Math.min(j.expires_in || 3600, 3300) };
  await env.DB.prepare("INSERT INTO meta (k, v, exp) VALUES ('gtoken', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp").bind(memTok.v, memTok.exp).run();
  return memTok.v;
}
function b64url(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------- Kalender-Abo (ICS-Link) ----------
   Google & Co. senden keine CORS-Header – eine Web-App kann den Link nicht
   selbst laden. Der Worker reicht den Kalender nur durch: nichts wird
   gespeichert oder protokolliert. Nur https, keine IP-Adressen/localhost,
   hoechstens 4 MB, und es muss wirklich ein iCalendar sein. */
const ICS_MAX = 4 * 1024 * 1024;
async function fetchIcs(raw) {
  let u;
  try { u = new URL(String(raw || '').trim().replace(/^webcal:/i, 'https:')); } catch (e) { throw new Fail('bad_url', 400); }
  if (u.protocol !== 'https:') throw new Fail('bad_url', 400);
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':')) throw new Fail('bad_url', 400);
  let r;
  try { r = await fetch(u.toString(), { headers: { accept: 'text/calendar, */*' }, redirect: 'follow', signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw new Fail('ics_unreachable', 502); }
  if (r.status === 404 || r.status === 401 || r.status === 403) throw new Fail('ics_not_found', 404);
  if (!r.ok) throw new Fail('ics_unreachable', 502);
  const len = +r.headers.get('content-length') || 0;
  if (len > ICS_MAX) throw new Fail('ics_too_large', 413);
  const txt = await r.text();
  if (txt.length > ICS_MAX) throw new Fail('ics_too_large', 413);
  if (!/BEGIN:VCALENDAR/i.test(txt.slice(0, 2000))) throw new Fail('not_ics', 422);
  return { ok: true, ics: txt };
}

/* ---------- Brief erklaeren ---------- */
async function explain(env, w, b, json) {
  if (!env.OPENAI_API_KEY) throw new Fail('server_not_configured', 503);
  // Vorab ein Guthaben reservieren (atomar), bei Fehler zurueckbuchen.
  const res = await env.DB.prepare('UPDATE wallets SET credits = credits - 1, updated = ? WHERE id = ? AND credits > 0').bind(Date.now(), w).run();
  if (!res.meta || res.meta.changes !== 1) return json({ error: 'no_credits', credits: 0 }, 402);
  const refund = () => env.DB.prepare('UPDATE wallets SET credits = credits + 1 WHERE id = ?').bind(w).run();

  const model = env.MODEL || 'gpt-5-mini';
  const messages = (b.system ? [{ role: 'system', content: String(b.system) }] : []).concat(b.messages);
  let r;
  try {
    r = await fetch(env.OPENAI_URL || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.OPENAI_API_KEY },
      body: JSON.stringify({ model, messages, max_completion_tokens: Math.min(+b.max_tokens || MAX_TOKENS, MAX_TOKENS), reasoning_effort: 'minimal' })
    });
  } catch (e) { await refund(); return json({ error: 'ai_unreachable' }, 502); }
  if (!r.ok) { await refund(); return json({ error: r.status === 429 ? 'ai_busy' : 'ai_failed' }, 502); }
  const j = await r.json().catch(() => ({}));
  const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!content) { await refund(); return json({ error: 'ai_empty' }, 502); }
  return json({ ok: true, content, credits: await credits(env, w) });
}
