-- ============================================================
-- Effyra – Fälligkeits-Erinnerungen: Log-Tabelle (Idempotenz) + Cron
-- Voraussetzung:
--   • supabase-push.sql (Tabelle push_subscriptions) ausgeführt
--   • supabase-sync.sql (Tabelle user_state) ausgeführt
--   • Edge Function "due-reminder" deployt  (supabase functions deploy due-reminder --no-verify-jwt)
--   • Secret CRON_SECRET gesetzt (identisch zum Header unten), sowie VAPID_* (wie push-send)
-- Einmalig im Supabase SQL-Editor ausführen ("Run"). Mehrfach ausführbar.
-- ============================================================

-- 1) Log-Tabelle: verhindert doppelte Erinnerungen (jede rk genau einmal je Nutzer).
--    rk-Beispiele: 'e:<eventId>:2026-07-20T15:00'  |  't:<taskId>:2026-07-20'
create table if not exists public.reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  rk      text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, rk)
);
create index if not exists reminder_log_sent_idx on public.reminder_log(sent_at);

-- Nur die Edge Function (service_role) greift zu; kein Client-Zugriff.
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

-- 2) Zeitplan (alle 15 Minuten). pg_cron + pg_net sind auf Supabase verfügbar.
create extension if not exists pg_cron;

do $$ begin perform cron.unschedule('effyra-due'); exception when others then null; end $$;

select cron.schedule(
  'effyra-due',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://ocnlrxmosbbtsczjyvxb.supabase.co/functions/v1/due-reminder',
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
      body    := '{}'::jsonb
    );
  $cron$
);

-- Kontrolle:
--   select jobname, schedule, active from cron.job where jobname = 'effyra-due';
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='effyra-due') order by start_time desc limit 5;
-- Deaktivieren:
--   select cron.unschedule('effyra-due');
