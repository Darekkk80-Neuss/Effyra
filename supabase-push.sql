-- ============================================================
-- Effyra – Web-Push-Abos (Hintergrund-Benachrichtigungen)
-- Einmalig im Supabase SQL-Editor ausführen ("Run").
-- Kann gefahrlos mehrfach ausgeführt werden.
-- ============================================================

create table if not exists public.push_subscriptions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  sub        jsonb not null,               -- vollständiges PushSubscription-JSON
  updated_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

-- Nutzer verwalten ausschließlich ihre eigenen Abos.
-- (Die Edge Function push-send liest fremde Abos über den Service-Role-Key = RLS umgangen.)
drop policy if exists "push own subs" on public.push_subscriptions;
create policy "push own subs" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
