-- Ordela – Wachstums-/Aktivierungs-Analyse (Admin-Only)
-- ===========================================================================
-- Zweck: sichtbar machen, ob aus Installs echte, aktive Nutzer werden – und
-- welcher Anmeldeweg (Google vs. E-Mail) wie gut zieht. Genau die „55 Installs /
-- 5 Nutzer"-Lücke messbar machen.
--
-- Ausführen: EINMAL im Supabase SQL-Editor (Projekt ocnlrxmosbbtsczjyvxb).
-- Danach jederzeit nur noch abfragen:
--     select * from public.growth_overview;
--     select * from public.growth_weekly;
--     select * from public.growth_sources;
--
-- Sicherheit: Diese Views lesen ALLE Profile (nicht nur das eigene). Sie werden
-- BEWUSST NICHT an anon/authenticated freigegeben – nur der Editor (Rolle
-- postgres, umgeht RLS) darf sie lesen. Damit sieht sie kein App-Nutzer.
-- Es werden nur Kennzahlen (Zählungen/Zeitpunkte) ausgewertet, keine Inhalte
-- aus user_state.data – die bleiben unangetastet.
--
-- Begriffe:
--   angemeldet/Signup  = Zeile in public.profiles mit E-Mail (anonyme Kinder-
--                        Sessions ohne E-Mail werden ausgeschlossen).
--   aktiviert          = hat mindestens einmal Cloud-Sync gehabt
--                        (Zeile in public.user_state vorhanden).
--   aktiv 7 Tage       = user_state.updated_at in den letzten 7 Tagen.
--   KI genutzt (Monat) = profiles.ai_used > 0. ACHTUNG: ai_used wird pro
--                        Kalendermonat auf 0 zurückgesetzt – das ist ein
--                        MONATSwert, kein Lebenszeit-Wert.
--   Premium            = plan='premium' ODER lifetime ODER premium_until>now().
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) Gesamt-Momentaufnahme (eine Zeile)
-- ---------------------------------------------------------------------------
create or replace view public.growth_overview as
with base as (
  select p.id, p.auth_provider, p.plan, p.lifetime, p.premium_until,
         p.ai_used, p.created_at,
         us.updated_at as last_sync
    from public.profiles p
    left join public.user_state us on us.user_id = p.id
   where p.email is not null            -- anonyme Kinder-Sessions raus
)
select
  count(*)                                                            as nutzer_gesamt,
  count(*) filter (where auth_provider = 'google')                   as google,
  count(*) filter (where auth_provider = 'email' or auth_provider is null) as email,
  count(*) filter (where last_sync is not null)                      as aktiviert,
  count(*) filter (where last_sync > now() - interval '7 days')      as aktiv_7t,
  count(*) filter (where last_sync > now() - interval '30 days')     as aktiv_30t,
  count(*) filter (where ai_used > 0)                                as ki_genutzt_monat,
  count(*) filter (where plan = 'premium' or lifetime
                        or premium_until > now())                    as premium,
  count(*) filter (where created_at > now() - interval '7 days')     as signups_7t,
  count(*) filter (where created_at > now() - interval '30 days')    as signups_30t,
  -- Aktivierungsquote in % (aktiviert / Signups), auf 1 Stelle gerundet
  round(100.0 * count(*) filter (where last_sync is not null)
             / nullif(count(*), 0), 1)                               as aktivierung_pct
from base;

-- ---------------------------------------------------------------------------
-- 2) Wöchentliche Kohorten (letzte 16 Wochen) – zeigt den Trend nach Änderungen
--    (Google-Login, Gastmodus, neue Store-Listings) ab dem jeweiligen Datum.
-- ---------------------------------------------------------------------------
create or replace view public.growth_weekly as
with base as (
  select p.id, p.auth_provider, p.plan, p.lifetime, p.premium_until,
         p.ai_used, p.created_at,
         us.updated_at as last_sync
    from public.profiles p
    left join public.user_state us on us.user_id = p.id
   where p.email is not null
     and p.created_at > now() - interval '16 weeks'
)
select
  date_trunc('week', created_at)::date                               as woche_ab,
  count(*)                                                            as signups,
  count(*) filter (where auth_provider = 'google')                   as google,
  count(*) filter (where auth_provider = 'email' or auth_provider is null) as email,
  count(*) filter (where last_sync is not null)                      as aktiviert,
  count(*) filter (where ai_used > 0)                                as ki_genutzt,
  count(*) filter (where plan = 'premium' or lifetime
                        or premium_until > now())                    as premium,
  round(100.0 * count(*) filter (where last_sync is not null)
             / nullif(count(*), 0), 0)                               as aktivierung_pct
from base
group by 1
order by 1 desc;

-- ---------------------------------------------------------------------------
-- 3) Herkunft der Anmeldungen (First-Party-Attribution aus dem Konto-Metadaten).
--    Zeigt, welche Kampagne/Quelle (utm_source) wie viele Signups gebracht hat.
--    Liest auth.users – im SQL-Editor (Rolle postgres) erlaubt.
-- ---------------------------------------------------------------------------
create or replace view public.growth_sources as
select
  coalesce(nullif(u.raw_user_meta_data #>> '{attribution,utm_source}', ''),
           '(direkt / unbekannt)')                                   as quelle,
  coalesce(nullif(u.raw_user_meta_data #>> '{attribution,utm_medium}', ''),
           '–')                                                      as medium,
  coalesce(nullif(u.raw_user_meta_data #>> '{attribution,utm_campaign}', ''),
           '–')                                                      as kampagne,
  count(*)                                                           as signups,
  max(u.created_at)::date                                            as letzter_signup
from auth.users u
where u.email is not null
group by 1, 2, 3
order by signups desc;

-- Kein GRANT an anon/authenticated: nur der SQL-Editor (postgres) sieht diese Views.
revoke all on public.growth_overview from anon, authenticated;
revoke all on public.growth_weekly   from anon, authenticated;
revoke all on public.growth_sources  from anon, authenticated;
