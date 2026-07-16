// Effyra – Unwetter-Push (Supabase Edge Function, per Cron)
// ----------------------------------------------------------------------------
// Prüft für jedes Gerät mit aktiviertem Warn-Push (push_subscriptions.warn = true)
// die amtlichen DWD-Warnungen (Bright Sky) für den gespeicherten Standort und
// sendet NUR bei einer NEUEN Warnung einen Push – auch bei geschlossener App.
//
// EINRICHTUNG:
//   1) Spalten ergänzen (einmalig, SQL-Editor):
//        alter table public.push_subscriptions add column if not exists warn boolean default false;
//        alter table public.push_subscriptions add column if not exists warn_lat double precision;
//        alter table public.push_subscriptions add column if not exists warn_lon double precision;
//        alter table public.push_subscriptions add column if not exists warn_last text;
//   2) Secrets: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (wie push-send) sind bereits gesetzt.
//   3) Deploy:  supabase functions deploy weather-push --no-verify-jwt
//   4) Cron (z. B. alle 30 Min) in Supabase → Database → Cron/pg_cron ODER ein
//      externer Scheduler, der diese Function-URL aufruft.
// ----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

Deno.serve(async () => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC');
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE');
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:effyra@example.com';
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'push_not_configured' }, 500);
  (webpush as any).setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('endpoint,sub,warn_lat,warn_lon,warn_last')
    .eq('warn', true);
  if (error) return json({ error: 'db', detail: error.message }, 500);

  const SEV = new Set(['moderate', 'severe', 'extreme']);   // reine 'minor'-Hinweise nicht pushen
  const ICON: Record<string, string> = { moderate: '⚠️', severe: '⛈️', extreme: '🚨' };
  let checked = 0, sent = 0;

  for (const s of subs || []) {
    if (s.warn_lat == null || s.warn_lon == null) continue;
    checked++;
    try {
      const r = await fetch('https://api.brightsky.dev/alerts?lat=' + s.warn_lat + '&lon=' + s.warn_lon).then(x => x.json());
      const alerts = ((r && r.alerts) || []).filter((a: any) => SEV.has(String(a.severity || '').toLowerCase()));
      if (!alerts.length) continue;
      const a = alerts[0];
      const key = (a.id || a.event_de || 'w') + '|' + (a.expires || '');
      if (s.warn_last === key) continue;   // bereits gepusht → nichts tun

      const payload = JSON.stringify({
        title: (ICON[String(a.severity).toLowerCase()] || '⚠️') + ' ' + (a.event_de || a.event_en || 'Unwetterwarnung'),
        body: String(a.headline_de || a.description_de || 'Amtliche Warnung des Deutschen Wetterdienstes.').slice(0, 180),
        url: '/',
      });
      await (webpush as any).sendNotification(s.sub, payload);
      await admin.from('push_subscriptions').update({ warn_last: key }).eq('endpoint', s.endpoint);
      sent++;
    } catch (_e) { /* ungültiges Abo o. Ä. → überspringen */ }
  }
  return json({ ok: true, checked, sent });
});
