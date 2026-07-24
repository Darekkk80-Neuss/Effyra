// Ordela – ICS/iCal-Proxy (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Holt einen Abfallkalender (iCal/ICS) einer Gemeinde SERVERSEITIG und gibt den
// Text an den Client zurueck. Noetig, weil viele Kommunen den direkten
// Browser-Zugriff per CORS sperren – der Server hat diese Beschraenkung nicht.
//
// EINRICHTUNG (einmalig):
//   Kein Secret noetig. Nur deployen:  supabase functions deploy ics-proxy
//   (config.toml: [functions.ics-proxy] verify_jwt = true)
//
// Sicherheit: nur eingeloggte Nutzer (getUser), nur http/https auf
// Standard-Ports, interne/private Adressen werden blockiert (SSRF-Schutz),
// Timeout 12 s, Antwort auf 3 MB begrenzt, Inhalt muss ein VCALENDAR sein.
// ----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchT } from '../_shared/util.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'content-type': 'application/json' } });

const MAX_BYTES = 3 * 1024 * 1024;

// Blockt interne/private Ziele (SSRF). Erlaubt nur http/https auf Standard-Ports
// und oeffentlich aussehende Hostnamen.
function isPublicHttpUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host === 'metadata.google.internal') return null;
  // IPv4-Literal?
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const o = m.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    const [a, b] = o;
    if (a === 0 || a === 127 || a === 10 || a === 169 && b === 254 ||
        a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 ||
        a === 100 && b >= 64 && b <= 127 || a >= 224) return null;
  }
  // IPv6-Literal? (nur eindeutig oeffentliche zulassen ist schwer – interne Praefixe blocken)
  if (host.includes(':')) {
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') ||
        host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') ||
        host.startsWith('feb') || host.startsWith('::')) return null;
  }
  if (!host.includes('.') && !host.includes(':')) return null;   // bloße Namen (z. B. „intranet")
  return u;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  // Nur eingeloggte Nutzer – verify_jwt akzeptiert auch den oeffentlichen Anon-Key,
  // daher zusaetzlich getUser (gleiches Muster wie fuel-/nutrition-proxy).
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ ok: false, error: 'auth_required' }, 401);
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: ures, error: uerr } = await userClient.auth.getUser();
  if (uerr || !ures?.user) return json({ ok: false, error: 'auth_invalid' }, 401);

  let body: { url?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad_body' }, 400); }
  let target = String(body.url || '').trim().replace(/^webcal:/i, 'https:');
  const u = isPublicHttpUrl(target);
  if (!u) return json({ ok: false, error: 'bad_url' }, 400);

  try {
    const res = await fetchT(u.toString(), { headers: { 'Accept': 'text/calendar, text/plain, */*' } }, 12000);
    if (!res.ok) return json({ ok: false, error: 'upstream_' + res.status }, 200);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return json({ ok: false, error: 'too_large' }, 200);
    const text = new TextDecoder('utf-8').decode(buf);
    if (!/BEGIN:VCALENDAR/i.test(text)) return json({ ok: false, error: 'not_ics' }, 200);
    return json({ ok: true, ics: text });
  } catch (_e) {
    return json({ ok: false, error: 'fetch_failed' }, 200);
  }
});
