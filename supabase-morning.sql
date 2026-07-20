-- ============================================================
-- Effyra – Morgen-Briefing-Push (täglicher Cron, 5:00 UTC)
-- SELBST-KONFIGURIEREND: das CRON_SECRET wird automatisch aus einem
-- bestehenden Effyra-Cron übernommen – du musst nichts eintippen.
-- Voraussetzung: supabase-push.sql (push_subscriptions), Function "morning-push"
-- ist deployt. Im Supabase SQL-Editor ausführen ("Run"). Mehrfach ausführbar.
-- ============================================================
--
-- WARUM UMGEBAUT
-- Diese Datei enthielt den Platzhalter '<CRON_SECRET>' im Klartext und erwartete,
-- dass er von Hand ersetzt wird. Wurde das vergessen, schickte der Job wörtlich
-- die Zeichenkette '<CRON_SECRET>' – die Function antwortete mit 403, der
-- Morgen-Push kam NIE an, und cron.job_run_details meldete trotzdem
-- „succeeded" (pg_net ist fire-and-forget, der Lauf gilt als erfolgreich,
-- sobald die Request-ID vergeben ist). Genau dieser Fehler stand am 20.07.2026
-- in cron_http_health(). Jetzt wird das Secret aus einem funktionierenden Job
-- übernommen – dasselbe Muster wie in supabase-due-reminder.sql.

-- 1) Opt-in-Spalte pro Gerät (die App setzt sie auf true, wenn der Nutzer
--    „☀️ Tagesbriefing morgens als Push" aktiviert).
alter table public.push_subscriptions
  add column if not exists morning boolean not null default false;

-- Partieller Index: der Cron filtert auf morning = true.
create index if not exists push_subscriptions_morning_idx
  on public.push_subscriptions (user_id) where morning;

-- 2) Erweiterungen für den Zeitplan
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3) Alten Job entfernen (auch einen mit unersetztem Platzhalter)
do $$ begin perform cron.unschedule('effyra-morning'); exception when others then null; end $$;

-- 4) Neu planen mit übernommenem Secret.
--    Zeit ist UTC: 05:00 UTC = 07:00 Sommerzeit / 06:00 Winterzeit in Deutschland.
do $$
declare v_secret text;
begin
  select (regexp_matches(command, $re$x-cron-secret'\s*,\s*'([^']+)'$re$))[1]
    into v_secret
    from cron.job
   where command like '%x-cron-secret%'
     and command not like '%<CRON_SECRET>%'      -- kaputten Platzhalter überspringen
   limit 1;

  if v_secret is null then
    raise exception 'Kein echtes CRON_SECRET in bestehenden Crons gefunden. Bitte zuerst supabase-due-reminder.sql ausfuehren – dann diese Datei erneut laufen lassen.';
  end if;

  -- timeout_milliseconds: pg_net wartet standardmäßig nur 5 s und meldet dann
  -- „timeout", obwohl die Function noch läuft. Die Rückmeldung geht damit
  -- verloren, und cron_http_health() zeigt einen Fehler, der keiner ist.
  perform cron.schedule(
    'effyra-morning',
    '0 5 * * *',
    format($f$select net.http_post(
      url     := 'https://ocnlrxmosbbtsczjyvxb.supabase.co/functions/v1/morning-push',
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '%s'),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );$f$, v_secret)
  );
  raise notice 'effyra-morning geplant (taeglich 5:00 UTC) mit uebernommenem CRON_SECRET.';
end $$;

-- Kontrolle:
--   select command from cron.job where jobname = 'effyra-morning';   -- darf NICHT <CRON_SECRET> enthalten
--   select * from public.cron_http_health();
