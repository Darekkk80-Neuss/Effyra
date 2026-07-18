// Effyra – Fälligkeits-Erinnerungen (per Cron, serverseitig)
//   • Termine (events mit Datum+Uhrzeit): ~30 Minuten vorher
//   • Aufgaben (tasks mit Fälligkeitsdatum, offen): am Morgen des Fälligkeitstags (ab 8 Uhr lokal)
// Liest die im KLARTEXT synchronisierten tasks/events aus user_state.data und sendet Web-Push.
// Idempotent über reminder_log (jede Erinnerung genau einmal). Zeitzone pro Nutzer aus data.tz.
//
// Sicherheit: fail-closed – nur mit korrektem CRON_SECRET-Header ausführbar.
// Deploy:  supabase functions deploy due-reminder --no-verify-jwt
// Benötigte Secrets: CRON_SECRET, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (wie push-send)
// Automatisch vorhanden: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}

// Aktuelle Wanduhr-Zeit in einer Zeitzone als 'YYYY-MM-DDTHH:MM'
function wallClock(d: Date, tz: string): string {
  try {
    const p: any = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).reduce((a: any, x: any) => (a[x.type] = x.value, a), {});
    const hh = p.hour === '24' ? '00' : p.hour;
    return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`;
  } catch { return ''; }
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
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:info@gonsoft-labs.de';
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'push_not_configured' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE);

  // Push-Abos je Nutzer (nur diese Nutzer sind relevant)
  const { data: allSubs, error: se } = await admin.from('push_subscriptions').select('user_id,endpoint,sub');
  if (se) return json({ error: 'db_error', detail: se.message }, 500);
  const subsByUser = new Map<string, any[]>();
  for (const s of (allSubs || []) as any[]) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id)!.push(s);
  }
  if (!subsByUser.size) return json({ ok: true, sent: 0 }, 200);

  const userIds = [...subsByUser.keys()];
  const { data: states, error: ue } = await admin
    .from('user_state').select('user_id,data').in('user_id', userIds);
  if (ue) return json({ error: 'db_error', detail: ue.message }, 500);

  (webpush as any).setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const now = new Date();

  type Rem = { user_id: string; rk: string; title: string; body: string };
  const candidates: Rem[] = [];

  // Push-Texte in der Sprache des Empfängers (profile.lang aus dem Sync-Snapshot)
  const L: Record<string, Record<string, string>> = {
    soon:  { de: '⏰ Gleich: ', en: '⏰ Coming up: ', fr: '⏰ Bientôt : ', es: '⏰ Pronto: ', it: '⏰ Tra poco: ', pl: '⏰ Wkrótce: ' },
    at:    { de: 'Um ', en: 'At ', fr: 'À ', es: 'A las ', it: 'Alle ', pl: 'O ' },
    clock: { de: ' Uhr', en: '', fr: '', es: '', it: '', pl: '' },
    inMin: { de: ' · in etwa {n} Min.', en: ' · in about {n} min', fr: ' · dans env. {n} min', es: ' · en unos {n} min', it: ' · tra circa {n} min', pl: ' · za ok. {n} min' },
    dueT:  { de: '📋 Heute fällig', en: '📋 Due today', fr: '📋 À faire aujourd’hui', es: '📋 Vence hoy', it: '📋 In scadenza oggi', pl: '📋 Termin dziś' },
    event: { de: 'Termin', en: 'Appointment', fr: 'Rendez-vous', es: 'Cita', it: 'Appuntamento', pl: 'Termin' },
    task:  { de: 'Aufgabe', en: 'Task', fr: 'Tâche', es: 'Tarea', it: 'Attività', pl: 'Zadanie' },
  };
  const tr = (key: string, lang: string) => (L[key] && (L[key][lang] || L[key].de)) || '';

  for (const st of (states || []) as any[]) {
    const d = st.data || {};
    const lang = (d.profile && typeof d.profile.lang === 'string' && /^(de|en|fr|es|it|pl)$/.test(d.profile.lang)) ? d.profile.lang : 'de';
    const tz = (typeof d.tz === 'string' && d.tz) ? d.tz : 'Europe/Berlin';
    const nowLocal = wallClock(now, tz);                       // 'YYYY-MM-DDTHH:MM'
    if (!nowLocal) continue;
    const nowMs = Date.parse(nowLocal + ':00Z');               // beide Seiten als „UTC" → Wanduhr-Differenz
    const nowDate = nowLocal.slice(0, 10);
    const nowHour = parseInt(nowLocal.slice(11, 13), 10);

    // --- Termine: ~30 Minuten vorher ---
    for (const ev of (Array.isArray(d.events) ? d.events : [])) {
      if (!ev || !ev.date || !ev.time || !/^\d{1,2}:\d{2}$/.test(String(ev.time))) continue;
      const startMs = Date.parse(ev.date + 'T' + String(ev.time).padStart(5, '0') + ':00Z');
      if (isNaN(startMs)) continue;
      const min = (startMs - nowMs) / 60000;
      if (min > 0 && min <= 30) {                              // in den nächsten 30 Min, noch nicht begonnen
        candidates.push({
          user_id: st.user_id,
          rk: 'e:' + (ev.id || ev.title) + ':' + ev.date + 'T' + ev.time,
          title: tr('soon', lang) + String(ev.title || tr('event', lang)),
          body: tr('at', lang) + ev.time + tr('clock', lang) + (ev.note ? ' · ' + String(ev.note).slice(0, 80) : '') + tr('inMin', lang).replace('{n}', String(Math.round(min))),
        });
      }
    }

    // --- Aufgaben: am Morgen des Fälligkeitstags (8–22 Uhr lokal) ---
    for (const t of (Array.isArray(d.tasks) ? d.tasks : [])) {
      if (!t || t.done || !t.due) continue;
      if (String(t.due) === nowDate && nowHour >= 8 && nowHour < 22) {
        candidates.push({
          user_id: st.user_id,
          rk: 't:' + (t.id || t.title) + ':' + t.due,
          title: tr('dueT', lang),
          body: String(t.title || tr('task', lang)).replace(/^[🛒📝🔔]\s*/, '') + (t.time ? ' · ' + t.time + tr('clock', lang) : ''),
        });
      }
    }
  }

  if (!candidates.length) return json({ ok: true, sent: 0 }, 200);

  let sent = 0, dead = 0, dup = 0;
  for (const c of candidates) {
    // Idempotenz: nur senden, wenn die Erinnerung neu ist (PK-Konflikt = schon gesendet)
    const { data: ins, error: ie } = await admin
      .from('reminder_log').insert({ user_id: c.user_id, rk: c.rk }).select('rk');
    if (ie || !ins || !ins.length) { dup++; continue; }
    const payload = JSON.stringify({ title: c.title, body: c.body, tag: 'effyra-due', url: './' });
    for (const s of (subsByUser.get(c.user_id) || [])) {
      try { await (webpush as any).sendNotification(s.sub, payload); sent++; }
      catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {                    // totes Abo → aufräumen
          await admin.from('push_subscriptions').delete().eq('user_id', s.user_id).eq('endpoint', s.endpoint);
          dead++;
        }
      }
    }
  }

  // Aufräumen: Log-Einträge älter als 30 Tage entfernen
  try { await admin.from('reminder_log').delete().lt('sent_at', new Date(Date.now() - 30 * 864e5).toISOString()); } catch { /* egal */ }

  return json({ ok: true, sent, dead, dup }, 200);
});
