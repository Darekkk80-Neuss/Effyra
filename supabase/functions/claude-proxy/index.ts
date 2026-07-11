// Effyra – KI-Proxy (Supabase Edge Function) — OpenAI-Backend
// Hält den echten OpenAI-Schlüssel serverseitig und setzt das Credit-Kontingent
// fälschungssicher durch (RPC consume_ai). Der Client ruft diese Funktion mit
// dem eingeloggten Supabase-JWT auf – niemals mit dem echten Key.
// (Funktionsname bleibt aus Kompatibilität "claude-proxy"; Backend ist OpenAI.)
//
// Benötigtes Secret (supabase secrets set ...):
//   OPENAI_API_KEY   (dein OpenAI-Schlüssel, sk-…)
// Automatisch vorhanden: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ALLOWED_MODELS = ['gpt-5-mini', 'gpt-5-nano'];   // im OpenAI-Projekt freigegebene Chat-Modelle
const DEFAULT_MODEL = 'gpt-5-mini';
// Modell je Operation – SERVERSEITIG bestimmt (Client kann kein teureres Modell erzwingen)
const OP_MODEL: Record<string, string> = {
  question: 'gpt-5-nano',   // KI-Antworten: schnell & günstig
  voice: 'gpt-5-nano',      // Sprachassistent-Antwort
  text: 'gpt-5-mini',       // Text/Brief erstellen: bessere Qualität
  weekplan: 'gpt-5-mini',   // Wochenplanung
  scan: 'gpt-5-mini',       // Dokument analysieren (multimodal)
  invoice: 'gpt-5-mini',    // Rechnung/Bild analysieren (multimodal)
};
// Credit-Kosten je Operation (serverseitig = fälschungssicher, Client kann sie nicht drücken)
const OP_COST: Record<string, number> = { question: 1, text: 2, voice: 2, scan: 5, invoice: 10, weekplan: 5, transcribe: 2, tts: 1 };
// Vorstart: „alles freigeschaltet" → angemeldete Nutzer dürfen die KI ohne Premium nutzen.
// MUSS zum Client-Flag ENFORCE_TIERS passen. Auf true stellen, sobald Play-Billing live ist (dann greifen Premium + Credits).
const ENFORCE_TIERS = false;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'auth_required' }, 401);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) return json({ error: 'server_not_configured' }, 500);

  // 1) Nutzer aus dem JWT bestimmen
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: ures, error: uerr } = await userClient.auth.getUser();
  if (uerr || !ures?.user) return json({ error: 'auth_invalid' }, 401);
  const uid = ures.user.id;

  // 2) Anfrage validieren & begrenzen
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const op = String(body?.op || '');

  // 3) Kontingent serverseitig verbrauchen (atomar) – nur wenn ENFORCE_TIERS aktiv ist. Gilt für Chat UND Audio.
  //    Im Vorstart (ENFORCE_TIERS=false) ist die KI für jede angemeldete Person freigeschaltet.
  let usage: { ai_used: number; ai_limit: number } = { ai_used: 0, ai_limit: 1000000 };
  if (ENFORCE_TIERS) {
    const cost = OP_COST[op] || 1;   // Credits je nach Operation
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: consumed, error: cerr } = await admin.rpc('consume_ai', { p_user: uid, p_n: cost });
    if (cerr) return json({ error: 'quota_error' }, 500);
    if (!consumed?.ok) {
      // reason: not_premium | quota_exceeded | no_profile
      return json({ error: consumed?.reason || 'quota', ai_used: consumed?.ai_used, ai_limit: consumed?.ai_limit }, 402);
    }
    usage = { ai_used: consumed.ai_used, ai_limit: consumed.ai_limit };
  }

  // 4a) Sprache → Text (Transkription, gpt-4o-mini-transcribe). Client schickt { op:'transcribe', audio:<base64>, mime }
  if (op === 'transcribe') {
    const b64 = String(body?.audio || '');
    if (!b64) return json({ error: 'bad_request' }, 400);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const mime = String(body?.mime || 'audio/webm');
    const ext = mime.includes('mp4') || mime.includes('m4a') ? 'mp4' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime }), `audio.${ext}`);
    form.append('model', 'gpt-4o-mini-transcribe');
    form.append('language', 'de');
    form.append('response_format', 'json');
    const tr = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form });
    const td = await tr.json().catch(() => ({}));
    if (!tr.ok) return json({ error: 'ai_failed', detail: (td as any)?.error?.message || '' }, tr.status);
    return json({ text: (td as any)?.text || '', ai_used: usage.ai_used, ai_limit: usage.ai_limit }, 200);
  }

  // 4b) Text → Sprache (TTS, gpt-4o-mini-tts). Client schickt { op:'tts', text, voice? } → { audio:<base64 mp3>, mime }
  if (op === 'tts') {
    const input = String(body?.text || '').slice(0, 1500);
    if (!input) return json({ error: 'bad_request' }, 400);
    const voice = /^(alloy|echo|fable|onyx|nova|shimmer|coral|sage|ash|ballad|verse)$/.test(String(body?.voice || '')) ? String(body.voice) : 'nova';
    const sr = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', input, voice, response_format: 'mp3', instructions: 'Sprich auf Deutsch, warm, freundlich und natürlich – wie eine hilfsbereite Freundin, nicht wie eine Werbestimme.' }),
    });
    if (!sr.ok) { const se = await sr.json().catch(() => ({})); return json({ error: 'ai_failed', detail: (se as any)?.error?.message || '' }, sr.status); }
    const buf = new Uint8Array(await sr.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return json({ audio: btoa(bin), mime: 'audio/mpeg', ai_used: usage.ai_used, ai_limit: usage.ai_limit }, 200);
  }

  // 4c) Chat (Standard). GPT-5-/o-Modelle: max_completion_tokens + minimales Reasoning.
  const model = OP_MODEL[op] || (ALLOWED_MODELS.includes(body?.model) ? body.model : DEFAULT_MODEL);
  const max_tokens = Math.min(Math.max(1, Number(body?.max_tokens) || 1024), 4000);
  const inMsgs = Array.isArray(body?.messages) ? body.messages : null;
  if (!inMsgs) return json({ error: 'bad_request' }, 400);
  const messages = body.system ? [{ role: 'system', content: body.system }, ...inMsgs] : inMsgs;
  const isReasoning = /^(gpt-5|o[0-9])/.test(model);
  const tokenParam = isReasoning ? { max_completion_tokens: Math.max(max_tokens, 800), reasoning_effort: 'minimal' } : { max_tokens };
  const ar = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages, ...tokenParam }),
  });
  const data = await ar.json();
  if (!ar.ok) return json({ error: 'ai_failed', detail: data?.error?.message || '' }, ar.status);
  const text = data?.choices?.[0]?.message?.content || '';
  return json({ content: [{ type: 'text', text }], ai_used: usage.ai_used, ai_limit: usage.ai_limit }, 200);
});
