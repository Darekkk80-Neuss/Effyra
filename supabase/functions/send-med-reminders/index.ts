// Effyra – send-med-reminders (Supabase Edge Function)
// Sendet Web-Push-Benachrichtigungen für fällige Medikamenten-Dosen – auch bei
// geschlossener App. Per Cron alle paar Minuten aufrufen (siehe BACKEND.md,
// Phase 3). Dedup über public.med_reminder_log.
//
// Benötigte Secrets:
//   VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (z. B. mailto:du@example.com)
// Automatisch vorhanden: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Deploy:  supabase functions deploy send-med-reminders

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// Dosen, die höchstens so viele Minuten überfällig sind, werden noch gesendet.
// (Verhindert, dass beim ersten Lauf nach dem Aktivieren der ganze Tag nachgefeuert wird.)
const WINDOW_MIN = 20;

const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function nowInTz(tz: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  const wd = WD[p.weekday] ?? 0;
  const minutes = parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
  const dateISO = `${p.year}-${p.month}-${p.day}`;
  return { wd, minutes, dateISO };
}
function slotDue(timeStr: string, nowMin: number) {
  const [h, m] = timeStr.split(':').map(Number);
  const diff = nowMin - (h * 60 + m);
  return diff >= 0 && diff <= WINDOW_MIN;
}

Deno.serve(async () => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC')!;
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE')!;
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@effyra.app';
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: schedules } = await admin.from('med_schedules').select('user_id, meds, tz');
  let sent = 0;

  for (const row of schedules ?? []) {
    const { wd, minutes, dateISO } = nowInTz(row.tz || 'Europe/Berlin');
    const meds = Array.isArray(row.meds) ? row.meds : [];

    const due: { key: string; title: string; body: string }[] = [];
    for (const m of meds) {
      const onDay = m.days === 'daily' || (Array.isArray(m.days) && m.days.includes(wd));
      if (!onDay) continue;
      for (const s of (m.slots || [])) {
        if (!s.time || !slotDue(s.time, minutes)) continue;
        due.push({
          key: `${dateISO}|${m.id}|${s.slot}`,
          title: `💊 ${m.name}${m.dose ? ' · ' + m.dose : ''}`,
          body: `${m.person || ''} · ${s.time} Uhr`,
        });
      }
    }
    if (!due.length) continue;

    const { data: subs } = await admin
      .from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', row.user_id);
    if (!subs || !subs.length) continue;

    for (const d of due) {
      // Dedup: nur senden, wenn dieser Dosis-Schlüssel heute noch nicht protokolliert wurde
      const { error: logErr } = await admin.from('med_reminder_log')
        .insert({ user_id: row.user_id, day: dateISO, dose_key: d.key });
      if (logErr) continue; // unique-Konflikt = bereits gesendet

      const payload = JSON.stringify({ title: d.title, body: d.body, tag: d.key, url: './' });
      for (const s of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
          );
          sent++;
        } catch (err) {
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'content-type': 'application/json' } });
});
