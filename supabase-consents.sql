-- Effyra – Einwilligungs-Log (Art. 5 Abs. 2 DSGVO Rechenschaftspflicht)
-- Im Supabase SQL-Editor ausführen. Der Client schreibt hier per syncConsentServer().
create table if not exists public.consents (
  user_id    uuid not null references auth.users(id) on delete cascade,
  consent_id text not null,                 -- z. B. 'ai', 'push', 'terms'
  status     text not null,                 -- 'granted' | 'denied'
  version    text,                          -- Versionsstand des Zwecks
  ts         timestamptz not null default now(),
  primary key (user_id, consent_id)
);
alter table public.consents enable row level security;
drop policy if exists "own consents" on public.consents;
create policy "own consents" on public.consents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
notify pgrst, 'reload schema';
