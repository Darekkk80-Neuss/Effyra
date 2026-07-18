-- ============================================================
-- Effyra – Fälligkeits-Erinnerungen: Log-Tabelle + Cron (alle 15 Min)
-- SELBST-KONFIGURIEREND: das CRON_SECRET wird automatisch aus einem
-- bestehenden Effyra-Cron übernommen – du musst nichts eintippen.
-- Voraussetzung: Edge Function "due-reminder" ist deployt; supabase-push.sql
-- (push_subscriptions) und supabase-sync.sql (user_state) wurden ausgeführt.
-- Im Supabase SQL-Editor komplett ausführen ("Run"). Mehrfach ausführbar.
-- ============================================================

-- 1) Log-Tabelle (Idempotenz: jede Erinnerung genau einmal je Nutzer)
create table if not exists public.reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  rk      text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, rk)
);
create index if not exists reminder_log_sent_idx on public.reminder_log(sent_at);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;   -- nur service_role (Edge Function)

-- 2) Zeitplan (alle 15 Minuten). pg_cron + pg_net sind auf Supabase verfügbar.
create extension if not exists pg_cron;

-- 2a) evtl. vorhandenen (auch den kaputten Platzhalter-)Job entfernen
do $$ begin perform cron.unschedule('effyra-due'); exception when others then null; end $$;

-- 2b) Secret automatisch aus einem korrekt konfigurierten Cron übernehmen und neu planen
do $$
declare
  v_secret text;
begin
  select (regexp_matches(command, $re$x-cron-secret'\s*,\s*'([^']+)'$re$))[1]
    into v_secret
    from cron.job
   where command like '%x-cron-secret%'
     and command not like '%<CRON_SECRET>%'      -- kaputten Platzhalter überspringen
   limit 1;

  if v_secret is null then
    raise exception 'Kein echtes CRON_SECRET in bestehenden Crons gefunden. Bitte zuerst supabase-morning.sql oder supabase-overdue.sql mit deinem Secret ausfuehren – dann diese Datei erneut laufen lassen. (Alternativ das Secret manuell im format(...) unten eintragen.)';
  end if;

  perform cron.schedule(
    'effyra-due',
    '*/15 * * * *',
    format($f$select net.http_post(
      url     := 'https://ocnlrxmosbbtsczjyvxb.supabase.co/functions/v1/due-reminder',
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '%s'),
      body    := '{}'::jsonb
    );$f$, v_secret)
  );
  raise notice 'effyra-due geplant (alle 15 Min) mit uebernommenem CRON_SECRET.';
end $$;

-- Kontrolle:
--   select jobname, schedule, active from cron.job where jobname = 'effyra-due';
--   select command from cron.job where jobname = 'effyra-due';   -- Secret sollte NICHT <CRON_SECRET> sein
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='effyra-due') order by start_time desc limit 5;
-- Deaktivieren:
--   select cron.unschedule('effyra-due');
