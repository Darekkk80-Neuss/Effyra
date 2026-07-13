// Effyra – Sanfte Erinnerung an überfällige, zugewiesene Familienaufgaben (per Cron)
// ---------------------------------------------------------------------------------
// Läuft STÜNDLICH (pg_cron), agiert aber nur, wenn es in Europa/Berlin gerade 9 Uhr ist
// (DST-sicher, kein Sommer-/Winter-Drift). Für jede überfällige, einer Person mit Konto
// zugewiesene, noch offene Familienaufgabe wird – gestaffelt nach Überfälligkeit
// (1 / 3 / 7 Tage) – ein FREUNDLICHER Push an die zuständige Person geschickt.
// Bewusst kein Nörgeln: nur an diesen drei Meilensteinen, und mehrere fällige Aufgaben
// einer Person werden zu EINER Nachricht zusammengefasst. Der Ton lädt zum bewussten
// Neu-Bewerten ein (verschieben/löschen), statt zu ermahnen.
//
// Datenschutz: Es werden nur bereits zum Sync freigegebene Familiendaten (families.data)
// und die Push-Abos gelesen; die eigentliche Verarbeitung bleibt serverseitig, es werden
// keine Inhalte protokolliert.
//
// Sicherheit: fail-closed – nur mit korrektem CRON_SECRET-Header ausführbar.
// Deploy:  supabase functions deploy overdue-reminder --no-verify-jwt
//
// Benötigte Secrets (supabase secrets set ...):
//   CRON_SECRET   (identisch zum pg_cron-Header)
//   VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (wie bei push-send)
// Automatisch vorhanden: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
}

// Datum als UTC-Mitternacht → taggenaue Differenzen, zeitzonenneutral.
function dayNum(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

const MILESTONES = [1, 3, 7];

// Eine überfällige Aufgabe (freundlich, mit Aufgaben-Titel).
const SINGLE: Record<number, { title: string; body: (t: string) => string }> = {
  1: { title: '🌟 Sanfte Erinnerung', body: (t) => '„' + t + '“ von gestern ist noch offen. Vielleicht findest du heute einen passenden Moment dafür.' },
  3: { title: '💙 Ganz ohne Druck', body: (t) => '„' + t + '“ begleitet dich schon ein paar Tage. Falls es nicht mehr relevant ist, kannst du es auch löschen oder verschieben.' },
  7: { title: '🗂️ Kurzer Blick?', body: (t) => '„' + t + '“ ist schon länger offen. Vielleicht lohnt sich ein kurzer Blick, ob es noch aktuell ist.' },
};

// Mehrere überfällige Aufgaben derselben Person → zusammengefasst (Ton = höchster Meilenstein).
const MULTI: Record<number, { title: string; body: (n: number) => string }> = {
  1: { title: '🌟 Sanfte Erinnerung', body: (n) => n + ' Aufgaben von den letzten Tagen sind noch offen. Vielleicht findest du heute für eine davon einen Moment.' },
  3: { title: '💙 Ganz ohne Druck', body: (n) => n + ' Aufgaben begleiten dich schon eine Weile. Was nicht mehr passt, darfst du löschen oder verschieben.' },
  7: { title: '🗂️ Kurzer Blick?', body: (n) => n + ' Aufgaben sind schon länger offen. Ein kurzer Blick lohnt sich vielleicht, was davon noch aktuell ist.' },
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Fail-closed: ohne gesetztes & passendes Secret keine Ausführung.
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'forbidden' }, 403);

  // Nur um 9 Uhr deutscher Zeit handeln. Cron feuert stündlich; ?force=1 nur zum Testen.
  const force = new URL(req.url).searchParams.get('force') === '1';
  let berlinHour = -1;
  try {
    berlinHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(new Date()));
  } catch (_) { /* ICU sollte vorhanden sein */ }
  if (!force && berlinHour !== 9) return json({ ok: true, skipped: 'not_9am_berlin', berlinHour }, 200);

  // Heutiges Datum in Berlin (YYYY-MM-DD) für die Überfälligkeits-Berechnung.
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const today = dayNum(todayIso);
  if (today == null) return json({ error: 'date_error' }, 500);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC');
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE');
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:effyra@example.com';
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'push_not_configured' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE);

  // Alle Familien-Blobs + alle Push-Abos laden (Service-Role, umgeht RLS).
  const { data: fams, error: fe } = await admin.from('families').select('data');
  if (fe) return json({ error: 'db_error', detail: fe.message }, 500);
  const { data: allSubs, error: se } = await admin.from('push_subscriptions').select('user_id,endpoint,sub');
  if (se) return json({ error: 'db_error', detail: se.message }, 500);

  // Push-Abos nach user_id gruppieren.
  const subsByUser = new Map<string, any[]>();
  for (const s of (allSubs || []) as any[]) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id)!.push(s);
  }

  // Qualifizierende Aufgaben je zuständiger authId sammeln.
  //   perUser: authId -> { level (höchster erreichter Meilenstein), titles[] }
  const perUser = new Map<string, { level: number; titles: string[] }>();
  for (const f of (fams || []) as any[]) {
    const d = f.data || {};
    const members = Array.isArray(d.members) ? d.members : [];
    const tasks = Array.isArray(d.tasks) ? d.tasks : [];
    const authById = new Map<string, string>();
    for (const m of members) { if (m && m.id && m.authId) authById.set(String(m.id), String(m.authId)); }
    for (const t of tasks) {
      if (!t || t.done || !t.assignee || !t.due) continue;         // nur offene, terminierte, zugewiesene Aufgaben
      const due = dayNum(String(t.due));
      if (due == null) continue;
      const overdue = Math.round((today - due) / 86400000);
      if (MILESTONES.indexOf(overdue) < 0) continue;               // ausschließlich an Tag 1 / 3 / 7
      // Zielperson: die/der Zuständige, sofern push-fähig; sonst die/der Erstellende (Manager, z. B. Elternteil).
      // t.by ist bereits eine authId (famSelfId), t.assignee eine Member-ID.
      const assigneeAuth = authById.get(String(t.assignee));
      let target = (assigneeAuth && subsByUser.has(assigneeAuth)) ? assigneeAuth : '';
      if (!target && t.by && subsByUser.has(String(t.by))) target = String(t.by);
      if (!target) continue;                                       // niemand mit Gerät → kein Push möglich
      const cur = perUser.get(target) || { level: 0, titles: [] };
      cur.titles.push(String(t.title || 'Aufgabe'));
      if (overdue > cur.level) cur.level = overdue;
      perUser.set(target, cur);
    }
  }

  (webpush as any).setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  let sent = 0, dead = 0, users = 0;
  for (const [authId, info] of perUser) {
    const subs = subsByUser.get(authId);
    if (!subs || !subs.length) continue;
    const n = info.titles.length;
    const lvl = info.level;                                        // 1, 3 oder 7
    const spec = n === 1 ? SINGLE[lvl] : MULTI[lvl];
    if (!spec) continue;
    const body = n === 1 ? (spec as any).body(info.titles[0]) : (spec as any).body(n);
    const payload = JSON.stringify({ title: spec.title, body, tag: 'effyra-overdue', url: './?fam=1' });
    users++;
    for (const s of subs) {
      try { await (webpush as any).sendNotification(s.sub, payload); sent++; }
      catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {                        // Abo tot → aufräumen
          await admin.from('push_subscriptions').delete().eq('user_id', authId).eq('endpoint', s.endpoint);
          dead++;
        }
      }
    }
  }
  return json({ ok: true, users, sent, dead, berlinHour }, 200);
});
