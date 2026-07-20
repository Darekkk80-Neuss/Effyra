-- ============================================================
-- Effyra – Betriebsüberwachung der Cron-Jobs
-- Im Supabase SQL-Editor komplett ausführen ("Run"). Mehrfach ausführbar.
-- ============================================================
--
-- WARUM
-- pg_cron ruft die Edge Functions über net.http_post auf – das ist
-- fire-and-forget. Der Cron-Lauf gilt als ERFOLGREICH, sobald die Request-ID
-- vergeben ist. Die tatsächliche HTTP-Antwort landet in net._http_response und
-- wurde bisher nirgends ausgewertet.
--
-- Konsequenz: cron.job_run_details zeigt grün, während die Function seit Wochen
-- 403 (falsches CRON_SECRET), 500 (fehlende RPC) oder 401 (Deploy ohne
-- --no-verify-jwt) zurückgibt. Der Ausfall wird erst durch Nutzerbeschwerden
-- über fehlende Erinnerungen sichtbar.
--
-- Diese Datei macht daraus eine Abfrage. Sie ersetzt kein Alerting, aber sie
-- verwandelt „unsichtbar" in „eine Abfrage entfernt".

-- ------------------------------------------------------------
-- Gesundheitsübersicht
-- ------------------------------------------------------------
create or replace function public.cron_health(p_hours int default 24)
returns table (
  job          text,
  zeitplan     text,
  aktiv        boolean,
  letzter_lauf timestamptz,
  laeufe       bigint,
  fehlschlaege bigint
)
language plpgsql security definer set search_path = public, cron as $fn$
begin
  return query
  select j.jobname::text,
         j.schedule::text,
         j.active,
         max(d.start_time),
         count(d.runid),
         count(*) filter (where d.status <> 'succeeded')
    from cron.job j
    left join cron.job_run_details d
           on d.jobid = j.jobid
          and d.start_time > now() - make_interval(hours => p_hours)
   where j.jobname like 'effyra%'
   group by j.jobname, j.schedule, j.active
   order by j.jobname;
end; $fn$;

-- ------------------------------------------------------------
-- HTTP-Antworten der Function-Aufrufe
-- ------------------------------------------------------------
-- Das ist die eigentlich wichtige Sicht: hier steht, ob die Function den Aufruf
-- ANGENOMMEN hat. Alles ausser 2xx bedeutet, dass der Job zwar lief, aber nichts
-- bewirkt hat.
--
-- net._http_response wird von pg_net gepflegt und nach einigen Stunden
-- automatisch geleert – die Sicht zeigt also nur das jüngste Fenster.
create or replace function public.cron_http_health(p_hours int default 24)
returns table (status text, anzahl bigint, letzte timestamptz, beispiel text)
language plpgsql security definer set search_path = public, net as $fn$
begin
  return query
  select case
           when r.timed_out then 'timeout'
           when r.error_msg is not null then 'fehler'
           when r.status_code between 200 and 299 then 'ok (' || r.status_code || ')'
           else 'HTTP ' || r.status_code
         end::text,
         count(*),
         max(r.created),
         left(coalesce(r.error_msg, r.content, ''), 120)::text
    from net._http_response r
   where r.created > now() - make_interval(hours => p_hours)
   group by 1, 4
   order by 2 desc;
exception when undefined_table or insufficient_privilege then
  -- pg_net nicht installiert oder Sicht nicht lesbar: leeres Ergebnis statt Fehler.
  return;
end; $fn$;

revoke execute on function public.cron_health(int)      from public, anon, authenticated;
revoke execute on function public.cron_http_health(int) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- SO PRÜFST DU DEN BETRIEB (beides regelmässig ansehen)
-- ============================================================
--
--   select * from public.cron_health();
--     -> Laufen alle vier Jobs? effyra-due (*/15), effyra-morning (0 5),
--        effyra-overdue (0 *), effyra-weather (*/30).
--        fehlschlaege > 0 heisst: pg_cron selbst kam nicht durch.
--
--   select * from public.cron_http_health();
--     -> Steht hier etwas anderes als "ok (200)", laufen die Jobs zwar, aber
--        die Functions weisen sie ab. Typische Ursachen:
--          403  CRON_SECRET stimmt nicht (Secret rotiert, Cron nicht angepasst)
--          401  Function ohne --no-verify-jwt deployt
--          500  fehlende RPC (z. B. supabase-due-check.sql nicht eingespielt)
--
-- Ein Lauf, der 0 Pushes verschickt, ist NICHT automatisch ein Fehler –
-- er kann schlicht bedeuten, dass gerade nichts fällig war.
