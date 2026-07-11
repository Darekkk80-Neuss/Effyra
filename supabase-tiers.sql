-- ============================================================
-- Effyra – Phase 2: optimiertes Lizenz-, Rollen- & Credit-Modell
-- Stufen (free/basic/ai/family) + Rollen + Effyra Credits + Stripe.
-- Im Supabase SQL-Editor komplett ausführen ("Run"). Mehrfach ausführbar.
-- Voraussetzung: supabase-setup.sql wurde bereits ausgeführt (profiles-Tabelle).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Neue/aktualisierte Spalten auf profiles
--    tier   : free | basic | ai | family
--    status : FREE_TRIAL | BASIC_LIFETIME | AI_MONTHLY | AI_YEARLY
--             | FAMILY_MONTHLY | FAMILY_YEARLY | EXPIRED
--    role   : OWNER | ADULT_MEMBER | CHILD_MEMBER
--    Credit-Backend (Section 10):
--    ai_used            = CREDIT_USED_CURRENT_PERIOD (verbrauchte Credits)
--    ai_extra           = nachbestellte Boost-Credits im laufenden Zeitraum
--    usage_month        = 'YYYY-MM' – Grundlage für den Monats-Reset
--    credit_reset_date  = CREDIT_RESET_DATE (1. des Folgemonats)
--    has_custom_api_key = HAS_CUSTOM_API_KEY (eigener Schlüssel hinterlegt)
--    family_id          = Gruppen-ID (= id des OWNER) für den Credit-Pool
--    premium_until      = Ablauf des Abos (bei Kündigung -> läuft aus)
--    stripe_customer_id = Stripe-Kunde (für Abo/Portal)
-- ------------------------------------------------------------
alter table public.profiles add column if not exists tier text not null default 'free';
alter table public.profiles add column if not exists status text not null default 'FREE_TRIAL';
alter table public.profiles add column if not exists role text not null default 'OWNER';
alter table public.profiles add column if not exists ai_used int not null default 0;
alter table public.profiles add column if not exists ai_extra int not null default 0;
alter table public.profiles add column if not exists usage_month text;
alter table public.profiles add column if not exists credit_reset_date date;
alter table public.profiles add column if not exists has_custom_api_key boolean not null default false;
alter table public.profiles add column if not exists family_id uuid;
alter table public.profiles add column if not exists premium_until timestamptz;
alter table public.profiles add column if not exists stripe_customer_id text;

-- Werte begrenzen
do $$ begin
  alter table public.profiles add constraint profiles_tier_chk
    check (tier in ('free','basic','ai','family'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_role_chk
    check (role in ('OWNER','ADULT_MEMBER','CHILD_MEMBER'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_status_chk
    check (status in ('FREE_TRIAL','BASIC_LIFETIME','AI_MONTHLY','AI_YEARLY',
                      'FAMILY_MONTHLY','FAMILY_YEARLY','EXPIRED'));
exception when duplicate_object then null; end $$;

-- Migration aus dem alten Modell (medium/premium)
update public.profiles set tier = 'basic'  where tier = 'medium';
update public.profiles set tier = 'ai'     where tier = 'premium';
update public.profiles set tier = 'ai', status = 'AI_YEARLY'
  where plan = 'premium' and tier not in ('ai','family');

-- ------------------------------------------------------------
-- 2) Credit-Kontingent je Stufe (Section 3/4): ai=500, family=1500
-- ------------------------------------------------------------
create or replace function public.tier_credit_limit(p_tier text) returns int
  language sql immutable as $$
    select case p_tier when 'ai' then 500 when 'family' then 1500 else 0 end
  $$;

-- Erster Tag des Folgemonats (Reset-Datum)
create or replace function public.next_reset_date() returns date
  language sql stable as $$
    select (date_trunc('month', now()) + interval '1 month')::date
  $$;

-- KI erlaubt? Nur Erwachsene mit ai/family-Stufe (Section 11)
create or replace function public.ai_enabled(p_tier text, p_role text) returns boolean
  language sql immutable as $$
    select p_role <> 'CHILD_MEMBER' and p_tier in ('ai','family')
  $$;

-- ------------------------------------------------------------
-- 3) Credit-Pool-Helfer
--    ai-Stufe   -> Kontingent pro Person (500 + eigener Boost)
--    family     -> gemeinsamer Pool: 1500 + Boost des OWNER,
--                  Verbrauch = Summe aller erwachsenen Mitglieder
-- ------------------------------------------------------------
-- Gemeinsame Familie eines Nutzers (family_id, ersatzweise eigene id)
create or replace function public.family_key(p_user uuid) returns uuid
  language sql stable as $$
    select coalesce((select family_id from public.profiles where id = p_user), p_user)
  $$;

-- Effektives Limit für einen Nutzer
create or replace function public.credit_limit_for(p_user uuid) returns int
  language plpgsql stable as $$
declare p public.profiles%rowtype; owner_extra int;
begin
  select * into p from public.profiles where id = p_user;
  if not found then return 0; end if;
  if p.tier = 'family' then
    select coalesce(ai_extra,0) into owner_extra
      from public.profiles where id = public.family_key(p_user);
    return 1500 + coalesce(owner_extra,0);
  end if;
  return public.tier_credit_limit(p.tier) + coalesce(p.ai_extra,0);
end; $$;

-- Effektiver Verbrauch für einen Nutzer (family = Summe der Erwachsenen)
create or replace function public.credit_used_for(p_user uuid) returns int
  language plpgsql stable as $$
declare p public.profiles%rowtype; total int;
begin
  select * into p from public.profiles where id = p_user;
  if not found then return 0; end if;
  if p.tier = 'family' then
    select coalesce(sum(ai_used),0) into total
      from public.profiles
     where family_id = public.family_key(p_user)
       and role <> 'CHILD_MEMBER';
    return coalesce(total,0);
  end if;
  return coalesce(p.ai_used,0);
end; $$;

-- ------------------------------------------------------------
-- 4) get_entitlements(): aktuellen Stand holen (Monats-Reset & Abo-Ablauf)
--    Vom angemeldeten Nutzer aufrufbar; liefert JSON.
-- ------------------------------------------------------------
create or replace function public.get_entitlements()
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p public.profiles%rowtype;
  cur_month text := to_char(now(), 'YYYY-MM');
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into p from public.profiles where id = uid;
  if not found then raise exception 'no profile'; end if;

  -- Monatswechsel -> Verbrauch & Boost zurücksetzen (Reset am 1.)
  if p.usage_month is distinct from cur_month then
    update public.profiles
       set usage_month = cur_month, ai_used = 0, ai_extra = 0,
           credit_reset_date = public.next_reset_date()
     where id = uid
     returning * into p;
  end if;

  -- Abgelaufenes Abo -> auf EXPIRED / basic zurückstufen (App bleibt, KI weg)
  if p.tier in ('ai','family') and p.premium_until is not null and p.premium_until < now() then
    update public.profiles
       set tier = 'basic', status = 'EXPIRED'
     where id = uid returning * into p;
  end if;

  return json_build_object(
    'tier',        p.tier,
    'status',      p.status,
    'role',        p.role,
    'ai_enabled',  public.ai_enabled(p.tier, p.role),
    'ai_used',     public.credit_used_for(uid),
    'ai_limit',    public.credit_limit_for(uid),
    'usage_month', cur_month,
    'credit_reset_date', coalesce(p.credit_reset_date, public.next_reset_date()),
    'has_custom_api_key', p.has_custom_api_key,
    'premium_until', p.premium_until
  );
end;
$$;

revoke execute on function public.get_entitlements() from public, anon;
grant  execute on function public.get_entitlements() to authenticated;

-- ------------------------------------------------------------
-- 5) consume_credits(user, cost): Credits verbrauchen – atomar.
--    NUR vom Claude-Proxy (service_role) aufrufbar, nie vom Client.
--    Kosten je Aktion (Section 7): Frage 1, Text 2, Sprachassistent 2,
--    Scan 5, Rechnung 10, Wochenplan 5, Große Analyse 20.
--    Rückgabe JSON: {ok, ai_used, ai_limit, reason?}
-- ------------------------------------------------------------
create or replace function public.consume_credits(p_user uuid, p_cost int default 1)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  p public.profiles%rowtype;
  cur_month text := to_char(now(), 'YYYY-MM');
  lim int; used int; cost int := greatest(1, coalesce(p_cost,1));
begin
  select * into p from public.profiles where id = p_user for update;
  if not found then return json_build_object('ok', false, 'reason', 'no_profile'); end if;

  -- Sicherheitsregel: Kinder können nie KI starten / Credits verbrauchen
  if p.role = 'CHILD_MEMBER' then
    return json_build_object('ok', false, 'reason', 'child_not_allowed');
  end if;

  -- Monatswechsel -> eigenen Verbrauch/Boost zurücksetzen
  if p.usage_month is distinct from cur_month then
    update public.profiles
       set usage_month = cur_month, ai_used = 0, ai_extra = 0,
           credit_reset_date = public.next_reset_date()
     where id = p_user returning * into p;
  end if;

  -- Nur zahlende KI-Stufen mit gültigem Abo
  if p.tier not in ('ai','family')
     or (p.premium_until is not null and p.premium_until < now()) then
    return json_build_object('ok', false, 'reason', 'not_entitled');
  end if;

  lim  := public.credit_limit_for(p_user);
  used := public.credit_used_for(p_user);
  if used + cost > lim then
    return json_build_object('ok', false, 'reason', 'quota_exceeded',
                             'ai_used', used, 'ai_limit', lim);
  end if;

  update public.profiles set ai_used = coalesce(ai_used,0) + cost where id = p_user;
  return json_build_object('ok', true, 'ai_used', used + cost, 'ai_limit', lim);
end;
$$;

revoke execute on function public.consume_credits(uuid, int) from public, anon, authenticated;
-- service_role darf immer; von normalen Nutzern bewusst fern gehalten.

-- ------------------------------------------------------------
-- 6) apply_purchase(user, kind): nach erfolgreicher Stripe-Zahlung.
--    NUR vom Stripe-Webhook (service_role) aufrufbar.
--    kind: basic_lifetime | ai_monthly | ai_yearly
--          | family_monthly | family_yearly | family_boost | topup
-- ------------------------------------------------------------
create or replace function public.apply_purchase(p_user uuid, p_kind text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare cur_month text := to_char(now(), 'YYYY-MM');
begin
  if p_kind = 'basic_lifetime' then
    update public.profiles
       set tier = case when tier in ('ai','family') then tier else 'basic' end,
           status = case when tier in ('ai','family') then status else 'BASIC_LIFETIME' end
     where id = p_user;

  elsif p_kind in ('ai_monthly','ai_yearly') then
    update public.profiles
       set tier = 'ai', status = upper(p_kind), role = coalesce(role,'OWNER'),
           plan = 'premium', premium_since = coalesce(premium_since, now()),
           premium_until = greatest(coalesce(premium_until, now()), now())
                           + case when p_kind = 'ai_yearly' then interval '400 days' else interval '32 days' end,
           usage_month = cur_month, credit_reset_date = public.next_reset_date()
     where id = p_user;

  elsif p_kind in ('family_monthly','family_yearly') then
    update public.profiles
       set tier = 'family', status = upper(p_kind), role = 'OWNER',
           family_id = coalesce(family_id, id),
           plan = 'premium', premium_since = coalesce(premium_since, now()),
           premium_until = greatest(coalesce(premium_until, now()), now())
                           + case when p_kind = 'family_yearly' then interval '400 days' else interval '32 days' end,
           usage_month = cur_month, credit_reset_date = public.next_reset_date()
     where id = p_user;

  elsif p_kind = 'family_boost' then
    -- Boost auf den OWNER des Pools buchen (+1500, bis Zeitraumende)
    update public.profiles
       set ai_extra = coalesce(ai_extra, 0) + 1500,
           usage_month = coalesce(usage_month, cur_month)
     where id = public.family_key(p_user);

  elsif p_kind = 'topup' then
    -- Einzel-Nachbestellung Effyra AI (+500)
    update public.profiles
       set ai_extra = coalesce(ai_extra, 0) + 500,
           usage_month = coalesce(usage_month, cur_month)
     where id = p_user;
  end if;
end;
$$;

revoke execute on function public.apply_purchase(uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 7) Familien-Mitglieder verwalten (nur OWNER, über die Familienzentrale)
--    add_family_member: neues Erwachsenen-/Kinder-Mitglied in den Pool holen.
--    NUR vom Backend (service_role) aufrufbar (Zahlung +3,99 € / +0,99 €).
-- ------------------------------------------------------------
create or replace function public.add_family_member(p_owner uuid, p_member uuid, p_role text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_role not in ('ADULT_MEMBER','CHILD_MEMBER') then
    raise exception 'invalid member role';
  end if;
  update public.profiles
     set tier = 'family', role = p_role,
         family_id = public.family_key(p_owner),
         -- Kinder: keine KI, keine Credits, kein eigener API-Key
         has_custom_api_key = case when p_role = 'CHILD_MEMBER' then false else has_custom_api_key end
   where id = p_member;
end;
$$;
revoke execute on function public.add_family_member(uuid, uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 8) set_stripe_customer(user, customer_id): vom Checkout gesetzt (service_role)
-- ------------------------------------------------------------
create or replace function public.set_stripe_customer(p_user uuid, p_customer text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set stripe_customer_id = p_customer where id = p_user;
end;
$$;
revoke execute on function public.set_stripe_customer(uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 9) Freischalt-Code -> Effyra AI Premium (400 Tage). Kompatibel zum alten Code.
-- ------------------------------------------------------------
create or replace function public.redeem_code(p_code text)
returns text
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_hash  text;
  v_found public.premium_codes%rowtype;
begin
  if auth.uid() is null then return 'not_authenticated'; end if;
  v_hash := encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex');
  select * into v_found from public.premium_codes where code_hash = v_hash;
  if not found then return 'invalid'; end if;
  if v_found.used_by is not null and v_found.used_by <> auth.uid() then return 'already_used'; end if;

  update public.premium_codes set used_by = auth.uid(), used_at = now() where code_hash = v_hash;
  update public.profiles
     set plan = 'premium', tier = 'ai', status = 'AI_YEARLY', role = coalesce(role,'OWNER'),
         premium_since = coalesce(premium_since, now()),
         premium_until = greatest(coalesce(premium_until, now()), now()) + interval '400 days',
         credit_reset_date = public.next_reset_date()
   where id = auth.uid();
  return 'ok';
end;
$$;
revoke execute on function public.redeem_code(text) from public, anon;
grant  execute on function public.redeem_code(text) to authenticated;

-- PostgREST-Schema-Cache aktualisieren
notify pgrst, 'reload schema';

-- ============================================================
-- Fertig. Als Nächstes die Edge Functions deployen (siehe BACKEND.md, Phase 2).
-- Der Claude-Proxy ruft public.consume_credits(user, cost) mit den Credit-Kosten
-- der jeweiligen Aktion (Section 7) auf; der Stripe-Webhook public.apply_purchase.
-- ============================================================
