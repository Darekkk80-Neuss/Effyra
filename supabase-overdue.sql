-- ============================================================
-- Ordela – Sanfte Erinnerung an überfällige Familienaufgaben (Cron, stündlich)
-- SELBST-KONFIGURIEREND: das CRON_SECRET wird automatisch aus einem
-- bestehenden Ordela-Cron übernommen – du musst nichts eintippen.
-- Voraussetzung: supabase-push.sql (push_subscriptions), supabase-family.sql
--   (families); Edge Function "overdue-reminder" ist deployt.
-- Im Supabase SQL-Editor ausführen ("Run"). Mehrfach ausführbar.
-- ============================================================
--
-- WARUM UMGEBAUT
-- Diese Datei enthielt den Platzhalter '<CRON_SECRET>' im Klartext und erwartete,
-- dass er von Hand ersetzt wird. Wurde das vergessen, schickte der Job wörtlich
-- die Zeichenkette '<CRON_SECRET>' und bekam 403 – die Erinnerung kam NIE an,
-- während cron.job_run_details „succeeded" meldete (pg_net ist fire-and-forget).
-- Jetzt wird das Secret aus einem funktionierenden Job übernommen.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Alten Job entfernen (auch einen mit unersetztem Platzhalter)
do $$ begin perform cron.unschedule('effyra-overdue'); exception when others then null; end $$;

-- Stündlicher Aufruf. Die Function agiert NUR, wenn es in Europa/Berlin gerade
-- 9:00 Uhr ist (DST-sicher, exakt 9 Uhr sommers wie winters). Die 23 übrigen
-- Aufrufe kehren sofort ohne Wirkung zurück.
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

  -- timeout_milliseconds: pg_net wartet standardmäßig nur 5 s. Dieser Job geht
  -- alle Familien durch und braucht im 9-Uhr-Lauf deutlich länger – ohne diese
  -- Erhöhung meldet cron_http_health() „timeout", obwohl die Function arbeitet.
  perform cron.schedule(
    'effyra-overdue',
    '0 * * * *',
    format($f$select net.http_post(
      url     := 'https://ocnlrxmosbbtsczjyvxb.supabase.co/functions/v1/overdue-reminder',
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '%s'),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000
    );$f$, v_secret)
  );
  raise notice 'effyra-overdue geplant (stuendlich) mit uebernommenem CRON_SECRET.';
end $$;

-- Kontrolle:
--   select command from cron.job where jobname = 'effyra-overdue';   -- darf NICHT <CRON_SECRET> enthalten
--   select * from public.cron_http_health();
