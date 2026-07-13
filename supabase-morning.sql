-- ============================================================
-- Effyra – Morgen-Briefing-Push (täglicher Cron)
-- Voraussetzung: supabase-push.sql (Tabelle push_subscriptions) wurde ausgeführt.
-- Einmalig im Supabase SQL-Editor ausführen ("Run"). Mehrfach ausführbar.
-- ============================================================

-- 1) Opt-in-Spalte pro Gerät (die App setzt sie auf true, wenn der Nutzer
--    „☀️ Tagesbriefing morgens als Push" aktiviert).
alter table public.push_subscriptions
  add column if not exists morning boolean not null default false;

-- 2) Erweiterungen für den Zeitplan (auf Supabase im Schema "extensions" verfügbar).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3) Täglichen Aufruf einrichten.
--    Zeit ist UTC: 05:00 UTC = 07:00 Sommerzeit / 06:00 Winterzeit in Deutschland.
--    <CRON_SECRET> unten durch DEIN Geheimnis ersetzen – IDENTISCH zum Supabase-Secret
--    CRON_SECRET (supabase secrets set CRON_SECRET=...). Nicht mit echtem Wert committen!
do $$
begin
  perform cron.unschedule('effyra-morning');
exception when others then null;   -- Job existierte noch nicht
end $$;

select cron.schedule(
  'effyra-morning',
  '0 5 * * *',
  $cron$
    select net.http_post(
      url     := 'https://ocnlrxmosbbtsczjyvxb.supabase.co/functions/v1/morning-push',
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
      body    := '{}'::jsonb
    );
  $cron$
);

-- Kontrolle:
--   select jobname, schedule, active from cron.job where jobname = 'effyra-morning';
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='effyra-morning') order by start_time desc limit 5;
-- Deaktivieren:
--   select cron.unschedule('effyra-morning');
