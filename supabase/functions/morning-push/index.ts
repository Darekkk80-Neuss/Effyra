// Effyra – Morgen-Briefing-Push (per Cron, serverseitig)
// Wird täglich von pg_cron aufgerufen und schickt allen Geräten mit dem Opt-in
// (push_subscriptions.morning = true) einen generischen „Guten Morgen"-Push.
// Der eigentliche, personalisierte Tagesüberblick wird beim Öffnen der App
// clientseitig aus den lokalen Daten berechnet (local-first / Datenschutz).
//
// Sicherheit: fail-closed – nur mit korrektem CRON_SECRET-Header ausführbar.
// Deploy:  supabase functions deploy morning-push --no-verify-jwt
//
// Benötigte Secrets (supabase secrets set ...):
//   CRON_SECRET     (geteimes Geheimnis, identisch im pg_cron-Aufruf)
//   VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (wie bei push-send)
// Automatisch vorhanden: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Fail-closed: ohne gesetztes & passendes Secret keine Ausführung.
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'forbidden' }, 403);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC');
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE');
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:effyra@example.com';
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'push_not_configured' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('user_id,endpoint,sub')
    .eq('morning', true);
  if (error) return json({ error: 'db_error', detail: error.message }, 500);
  if (!subs || !subs.length) return json({ ok: true, sent: 0 }, 200);

  (webpush as any).setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const payload = JSON.stringify({
    title: '☀️ Guten Morgen!',
    body: 'Dein Tagesüberblick wartet in Effyra – Termine, Aufgaben, Medikamente und Fristen auf einen Blick.',
    tag: 'effyra-morning',
    url: './',
  });

  let sent = 0, dead = 0;
  for (const s of subs as any[]) {
    try { await (webpush as any).sendNotification(s.sub, payload); sent++; }
    catch (e: any) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) {   // Abo tot → aufräumen
        await admin.from('push_subscriptions').delete().eq('user_id', s.user_id).eq('endpoint', s.endpoint);
        dead++;
      }
    }
  }
  return json({ ok: true, sent, dead }, 200);
});
