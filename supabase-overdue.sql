-- ============================================================
-- Effyra – Sanfte Erinnerung an überfällige Familienaufgaben (Cron)
-- Voraussetzung: supabase-push.sql (push_subscriptions) und supabase-family.sql
--   (families) wurden ausgeführt; Edge Function "overdue-reminder" ist deployt.
-- Einmalig im Supabase SQL-Editor ausführen ("Run"). Mehrfach ausführbar.
-- ============================================================

-- Zeitplan-Erweiterungen (auf Supabase im Schema "extensions" verfügbar).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Stündlicher Aufruf. Die Funktion selbst agiert NUR, wenn es in Europa/Berlin
-- gerade 9:00 Uhr ist (DST-sicher, exakt 9 Uhr sommers wie winters). Die 23
-- übrigen Aufrufe kehren sofort ohne Wirkung zurück.
-- <CRON_SECRET> unten durch DEIN Geheimnis ersetzen – IDENTISCH zum Supabase-Secret
-- CRON_SECRET (supabase secrets set CRON_SECRET=...). Nicht mit echtem Wert committen!
do $$
begin
  perform cron.unschedule('effyra-overdue');
exception when others then null;   -- Job existierte noch nicht
end $$;

select cron.schedule(
  'effyra-overdue',
  '0 * * * *',
  $cron$
    select net.http_post(
      url     := 'https://ocnlrxmosbbtsczjyvxb.supabase.co/functions/v1/overdue-reminder',
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
      body    := '{}'::jsonb
    );
  $cron$
);

-- Kontrolle:
--   select jobname, schedule, active from cron.job where jobname = 'effyra-overdue';
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='effyra-overdue') order by start_time desc limit 5;
-- Deaktivieren:
--   select cron.unschedule('effyra-overdue');
