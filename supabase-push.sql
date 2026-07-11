-- ============================================================
-- Effyra – Phase 3: Web-Push für Medikamenten-Erinnerungen
-- Im Supabase SQL-Editor komplett ausführen ("Run"). Mehrfach ausführbar.
-- Voraussetzung: supabase-setup.sql (profiles + auth) ist eingerichtet.
-- Danach: Function `send-med-reminders` deployen + per Cron alle paar Minuten
-- aufrufen (siehe BACKEND.md, Phase 3).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Push-Abos je Nutzer (ein Gerät = ein Endpoint)
-- ------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;

-- Nutzer sehen/verwalten nur ihre eigenen Abos
do $$ begin
  create policy push_sub_owner on public.push_subscriptions
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 2) Medikamenten-Plan je Nutzer (als JSONB) + Zeitzone
--    meds: [{ id, name, dose, person, days:'daily'|[0..6], slots:[{slot,time}] }]
-- ------------------------------------------------------------
create table if not exists public.med_schedules (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  meds       jsonb not null default '[]'::jsonb,
  tz         text  not null default 'Europe/Berlin',
  updated_at timestamptz not null default now()
);
alter table public.med_schedules enable row level security;
do $$ begin
  create policy med_sched_owner on public.med_schedules
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 3) Versand-Protokoll (verhindert Doppel-Pushes je Dosis/Tag)
-- ------------------------------------------------------------
create table if not exists public.med_reminder_log (
  user_id  uuid not null references auth.users(id) on delete cascade,
  day      date not null,
  dose_key text not null,          -- 'YYYY-MM-DD|medId|slot'
  sent_at  timestamptz not null default now(),
  primary key (user_id, dose_key)
);
alter table public.med_reminder_log enable row level security;
-- Kein Client-Zugriff nötig; nur die Function (service_role) schreibt hier.

-- ------------------------------------------------------------
-- 4) RPCs für den Client (nur eigene Daten)
-- ------------------------------------------------------------
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
end; $$;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant  execute on function public.save_push_subscription(text, text, text) to authenticated;

create or replace function public.save_med_schedule(p_meds jsonb, p_tz text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.med_schedules (user_id, meds, tz, updated_at)
  values (auth.uid(), coalesce(p_meds, '[]'::jsonb), coalesce(p_tz, 'Europe/Berlin'), now())
  on conflict (user_id) do update set meds = excluded.meds, tz = excluded.tz, updated_at = now();
end; $$;
revoke execute on function public.save_med_schedule(jsonb, text) from public, anon;
grant  execute on function public.save_med_schedule(jsonb, text) to authenticated;

-- Erinnerungen abschalten: Plan + Abos des Nutzers entfernen (keine Pushes mehr)
create or replace function public.clear_med_schedule()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.med_schedules   where user_id = auth.uid();
  delete from public.push_subscriptions where user_id = auth.uid();
end; $$;
revoke execute on function public.clear_med_schedule() from public, anon;
grant  execute on function public.clear_med_schedule() to authenticated;

-- PostgREST-Schema-Cache aktualisieren
notify pgrst, 'reload schema';

-- ============================================================
-- Fertig. Weiter mit der Edge Function `send-med-reminders` (VAPID) und dem
-- Cron-Job, der sie alle paar Minuten aufruft – siehe BACKEND.md, Phase 3.
-- ============================================================
