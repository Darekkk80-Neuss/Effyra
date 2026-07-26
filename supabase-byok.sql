-- ============================================================================
-- Ordela – Freischaltung „eigener KI-Schlüssel" (bring your own key)
-- ----------------------------------------------------------------------------
-- Der Nutzer hinterlegt seinen EIGENEN OpenAI-Schlüssel und rechnet die Nutzung
-- direkt mit OpenAI ab. Kostenpflichtig ist bei uns nur die MÖGLICHKEIT dazu:
--
--   effyra_byok_monthly   1,99 €  / Monat   (Abo, verlängert sich)
--   effyra_byok_lifetime  24,99 € einmalig  (dauerhaft für dieses Konto)
--
-- Vor dem 24.07.2026 war das gratis – deshalb bringt diese Datei die Spalten,
-- die Freischaltung und die Statusabfrage mit.
--
-- REIHENFOLGE: diese Datei ZUERST ausführen, danach supabase-trial-and-play.sql
-- (dort greift grant_play_purchase auf die hier angelegten Spalten zu).
-- ============================================================================

-- 1) Spalten am Profil ------------------------------------------------------
alter table public.profiles add column if not exists byok_until    timestamptz;
alter table public.profiles add column if not exists byok_lifetime boolean not null default false;

comment on column public.profiles.byok_until    is 'Eigener KI-Schluessel freigeschaltet bis (Monatsabo effyra_byok_monthly)';
comment on column public.profiles.byok_lifetime is 'Eigener KI-Schluessel dauerhaft freigeschaltet (Einmalkauf effyra_byok_lifetime)';

-- 2) Freischaltung ----------------------------------------------------------
-- Wird aus grant_play_purchase aufgerufen (service_role). Getrennte Funktion,
-- damit die grosse grant-Funktion nur eine Zeile je SKU braucht.
create or replace function public.grant_byok(p_user uuid, p_lifetime boolean, p_days int default 32)
returns json
language plpgsql
security definer set search_path = public
as $$
begin
  if p_lifetime then
    update public.profiles set byok_lifetime = true where id = p_user;
    return json_build_object('ok', true, 'kind', 'byok_lifetime');
  end if;
  -- Verlaengerung ab dem SPAETEREN von jetzt/bisherigem Ende: eine Verlaengerung
  -- vor Ablauf darf die Restlaufzeit nicht verschlucken.
  update public.profiles
     set byok_until = greatest(coalesce(byok_until, now()), now()) + make_interval(days => p_days)
   where id = p_user;
  return json_build_object('ok', true, 'kind', 'byok_monthly');
end;
$$;
revoke all on function public.grant_byok(uuid, boolean, int) from public, anon, authenticated;

-- 3) Entzug (Erstattung / Storno) -------------------------------------------
create or replace function public.revoke_byok(p_user uuid, p_lifetime boolean)
returns json
language plpgsql
security definer set search_path = public
as $$
begin
  if p_lifetime then
    update public.profiles set byok_lifetime = false where id = p_user;
  else
    update public.profiles set byok_until = null where id = p_user;
  end if;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.revoke_byok(uuid, boolean) from public, anon, authenticated;

-- 4) Statusabfrage für den Client -------------------------------------------
-- Eigener RPC statt Erweiterung von get_entitlements: haelt die grosse Funktion
-- unangetastet. Liefert nur die eigenen Werte (auth.uid()).
create or replace function public.byok_status()
returns json
language plpgsql
security definer set search_path = public
as $$
declare uid uuid := auth.uid(); p public.profiles%rowtype;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into p from public.profiles where id = uid;
  if not found then return json_build_object('lifetime', false, 'until', null); end if;
  return json_build_object(
    'lifetime', coalesce(p.byok_lifetime, false),
    -- abgelaufene Laufzeit gar nicht erst zurueckgeben
    'until', case when p.byok_until is not null and p.byok_until > now() then p.byok_until else null end
  );
end;
$$;
grant execute on function public.byok_status() to authenticated;

-- Kontrolle:
--   select public.byok_status();
--   select id, byok_until, byok_lifetime from public.profiles where id = auth.uid();
