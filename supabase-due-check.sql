-- ============================================================
-- Effyra – Fälligkeitsprüfung IN DER DATENBANK
-- Im Supabase SQL-Editor komplett ausführen ("Run"). Mehrfach ausführbar.
-- Voraussetzung: supabase-due-reminder.sql (reminder_log), supabase-push.sql
-- (push_subscriptions) und supabase-sync.sql (user_state) wurden ausgeführt.
-- Danach: supabase functions deploy due-reminder --no-verify-jwt
-- ============================================================
--
-- WARUM ES DAS GIBT
-- Vorher lud die Edge Function die Aufgaben und Termine ALLER Nutzer mit
-- Push-Abo in den Speicher EINER Invocation und filterte dort. Edge Functions
-- haben 256 MB Speicher und 2 s CPU-Zeit – beides plan-unabhängig und nicht
-- erhöhbar. Bei ~15 KB Aufgaben/Termine je Nutzer war damit um die 10.000
-- Push-Abos Schluss; danach wären die Erinnerungen still ausgefallen.
--
-- Jetzt filtert Postgres und liefert nur die tatsächlich fälligen Zeilen.
-- ACHTUNG: gelesen wird weiterhin der data-Blob JEDES Nutzers mit Push-Abo.
-- Das behebt die 256-MB-Wand, verschiebt die Grenze aber nur. Ab etwa 50.000
-- Nutzern braucht es eine gepflegte Spalte user_state.next_due_at mit Index,
-- damit nur noch die wirklich in Frage kommenden Zeilen gelesen werden.
--
-- Die Funktion übernimmt zusätzlich die Idempotenz: der Eintrag in reminder_log
-- passiert im selben Statement, zurückgegeben werden NUR die dabei wirklich neu
-- angelegten Zeilen. Damit wird jede Erinnerung genau einmal verschickt.

-- ------------------------------------------------------------
-- Robustheit gegen kaputte Werte im Sync-Blob
-- ------------------------------------------------------------
-- Ein einziger ungültiger Datensatz darf NICHT den ganzen Lauf abbrechen –
-- sonst bekämen alle Nutzer keine Erinnerungen mehr, alle 15 Minuten erneut.
-- Die alte TS-Fassung übersprang solche Einträge einfach (isNaN-Prüfung).
--
-- Bewusst OHNE exception-Block: der öffnet je Aufruf eine Subtransaktion, und
-- bei einer Prüfung pro Termin/Aufgabe wären das schnell Hunderttausende.
-- Ein Formregex allein reicht nicht – '2026-02-30' und '2026-04-31' bestehen
-- ihn, brechen aber beim Cast. Deshalb zusätzlich die Monatslänge prüfen.
-- WICHTIG: CASE statt AND. PostgreSQL wertet AND nicht garantiert von links
-- nach rechts aus – der Planner sortiert Bedingungen nach Kosten. Da diese
-- Funktion als "language sql immutable" inlined wird, könnte der Vergleich
-- rechts also VOR dem Regex laufen. Bei p='' oder '2026-08-0X' wirft dann
-- substring(...)::int, und der ganze Lauf bricht ab – genau der Fehler, den
-- diese Funktion verhindern soll. CASE wertet nur den gewählten Zweig aus.
--
-- Der Tagesvergleich läuft zusätzlich rein textuell: das Regex erzwingt zwei
-- nullgepaddete Ziffern, damit ist '09' <= '29' gleichbedeutend mit 9 <= 29 –
-- und kann im Gegensatz zum Cast nie werfen.
create or replace function public.valid_date(p text)
returns boolean language sql immutable as $fn$
  select case
    when p !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then false
    else substring(p, 9, 2) <= case substring(p, 6, 2)
           when '02' then case when (substring(p, 1, 4)::int % 4 = 0 and substring(p, 1, 4)::int % 100 <> 0)
                                 or substring(p, 1, 4)::int % 400 = 0
                          then '29' else '28' end
           when '04' then '30'
           when '06' then '30'
           when '09' then '30'
           when '11' then '30'
           else '31' end
  end;
$fn$;

-- Uhrzeit: strenger als '\d{1,2}:\d{2}' – '25:99' bestand das und brach beim Cast.
create or replace function public.valid_time(p text)
returns boolean language sql immutable as $fn$
  select p ~ '^([01]?\d|2[0-3]):[0-5]\d$';
$fn$;

-- Zeitzone des Nutzers absichern: ein ungültiger Wert würde sonst die gesamte
-- Abfrage abbrechen. Hier ist der exception-Block vertretbar, weil er nur
-- einmal je NUTZER läuft, nicht je Termin.
create or replace function public.tz_or_default(p text)
returns text language plpgsql stable as $fn$
begin
  perform now() at time zone coalesce(nullif(p, ''), 'Europe/Berlin');
  return coalesce(nullif(p, ''), 'Europe/Berlin');
exception when others then
  return 'Europe/Berlin';
end;
$fn$;

-- ------------------------------------------------------------
-- Fällige Erinnerungen ermitteln und als gesendet vormerken
-- ------------------------------------------------------------
create or replace function public.due_reminders()
returns table (
  user_id uuid,
  rk      text,
  kind    text,
  lang    text,
  title   text,
  tm      text,
  note    text,
  minutes int
)
language sql volatile security definer set search_path = public as $fn$
with u as (
  select st.user_id as uid,
         public.tz_or_default(st.data->>'tz') as tz,
         case when st.data->'profile'->>'lang' ~ '^(de|en|fr|es|it|pl)$'
              then st.data->'profile'->>'lang'
              else 'de' end as lang,
         -- Typprüfung MUSS hier stehen, nicht im WHERE: jsonb_array_elements
         -- wird in der FROM-Klausel ausgewertet, bevor das WHERE greift. Ist
         -- events/tasks bei einem Nutzer ein Objekt statt eines Arrays
         -- (Altdaten), bricht sonst der komplette Lauf ab.
         case when jsonb_typeof(st.data->'events') = 'array' then st.data->'events' else '[]'::jsonb end as events,
         case when jsonb_typeof(st.data->'tasks')  = 'array' then st.data->'tasks'  else '[]'::jsonb end as tasks
    from public.user_state st
   where exists (select 1 from public.push_subscriptions ps where ps.user_id = st.user_id)
),

-- Termine: Beginn in den nächsten 30 Minuten. Echte Zeitzonenrechnung, damit
-- der Sommer-/Winterzeitwechsel keinen Versatz erzeugt (die alte Wanduhr-
-- Rechnung verlor an Umstellungstagen Erinnerungen).
ev as (
  select u.uid,
         u.lang,
         'e:' || coalesce(nullif(e->>'id', ''), nullif(e->>'title', ''), '?')
              || ':' || (e->>'date') || 'T' || (e->>'time') as rk,
         'event'::text as kind,
         coalesce(nullif(e->>'title', ''), '') as title,
         e->>'time' as tm,
         nullif(e->>'note', '') as note,
         -- ungerundet für den Vergleich, gerundet erst für die Anzeige
         extract(epoch from
           (((e->>'date') || ' ' || lpad(e->>'time', 5, '0'))::timestamp at time zone u.tz) - now()
         ) / 60 as mraw
    from u, lateral jsonb_array_elements(u.events) e
   where public.valid_date(e->>'date')
     and public.valid_time(e->>'time')
),

-- Aufgaben: am Fälligkeitstag, zwischen 8 und 21 Uhr lokaler Zeit.
tk as (
  select u.uid,
         u.lang,
         't:' || coalesce(nullif(t->>'id', ''), nullif(t->>'title', ''), '?')
              || ':' || (t->>'due') as rk,
         'task'::text as kind,
         coalesce(nullif(t->>'title', ''), '') as title,
         nullif(t->>'time', '') as tm,
         null::text as note,
         null::numeric as mraw
    from u, lateral jsonb_array_elements(u.tasks) t
     -- wie die alte JS-Prüfung `if (t.done) continue`: alles ausser den
     -- falsy-Werten gilt als erledigt, nicht nur 'true'
   where coalesce(t->>'done', 'false') in ('false', '0', '')
     -- Textvergleich statt (t->>'due')::date: ein Cast in der WHERE-Klausel
     -- kann bei '2026-02-30' werfen und den ganzen Lauf abbrechen, und auf die
     -- Auswertungsreihenfolge gegenüber valid_date ist kein Verlass. Der
     -- Vergleich gegen das formatierte Tagesdatum ist zugleich exakt die alte
     -- JS-Semantik (String(t.due) === nowDate) – ungültige Werte matchen nie.
     and t->>'due' = to_char((now() at time zone u.tz)::date, 'YYYY-MM-DD')
     and extract(hour from (now() at time zone u.tz)) between 8 and 21
),

-- distinct on: derselbe Schlüssel darf im Lauf nur einmal vorkommen, sonst
-- käme die Erinnerung über den Join unten mehrfach zurück.
-- Alles mit x. qualifiziert – uid/rk wären sonst gegen die OUT-Parameter der
-- returns-table-Deklaration mehrdeutig.
cand as (
  select distinct on (x.uid, x.rk) x.*
    from (
      select * from ev where mraw > 0 and mraw <= 30
      union all
      select * from tk
    ) x
   order by x.uid, x.rk
),

-- Idempotenz: nur was hier NEU eingefügt wird, wurde noch nie verschickt.
ins as (
  insert into public.reminder_log (user_id, rk)
  select c.uid, c.rk from cand c
  on conflict (user_id, rk) do nothing
  returning reminder_log.user_id, reminder_log.rk
)
select c.uid, c.rk, c.kind, c.lang, c.title, c.tm, c.note, round(c.mraw)::int
  from cand c
  join ins i on i.user_id = c.uid and i.rk = c.rk;
$fn$;

-- ------------------------------------------------------------
-- Rückabwicklung, falls die Zustellung nach dem Eintrag scheitert
-- ------------------------------------------------------------
-- due_reminders() markiert die Erinnerungen als gesendet, BEVOR die Edge
-- Function sie verschickt hat. Bricht sie danach ab (z. B. weil die Push-Abos
-- nicht geladen werden konnten), wären die Erinnerungen sonst endgültig
-- verloren – der nächste Lauf würde sie wegen des Logs überspringen.
create or replace function public.due_reminders_undo(p_user uuid[], p_rk text[])
returns int language sql volatile security definer set search_path = public as $fn$
  with weg as (
    delete from public.reminder_log l
     using unnest(p_user, p_rk) as u(user_id, rk)
     where l.user_id = u.user_id and l.rk = u.rk
     returning 1
  )
  select count(*)::int from weg;
$fn$;

revoke execute on function public.due_reminders()                    from public, anon, authenticated;
revoke execute on function public.due_reminders_undo(uuid[], text[]) from public, anon, authenticated;
revoke execute on function public.valid_date(text)                   from public, anon, authenticated;
revoke execute on function public.valid_time(text)                   from public, anon, authenticated;
revoke execute on function public.tz_or_default(text)                from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Kontrolle der Hilfsfunktionen (verändert nichts):
--   select public.valid_date('2026-02-30');   -- false
--   select public.valid_date('2028-02-29');   -- true  (Schaltjahr)
--   select public.valid_date('2026-04-31');   -- false
--   select public.valid_time('25:99');        -- false
--   select public.valid_time('9:05');         -- true
