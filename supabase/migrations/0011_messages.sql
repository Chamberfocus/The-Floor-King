-- Floor King CRM — Phase 7: Per-customer messaging (team-private + client)
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'message_channel') then
    -- internal = team only (never visible to the customer); client = with customer
    create type public.message_channel as enum ('internal', 'client');
  end if;
end $$;

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  channel     public.message_channel not null,
  author_id   uuid references auth.users (id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists messages_customer_idx
  on public.messages (customer_id, created_at);

alter table public.messages enable row level security;

-- Staff: full access to both channels.
drop policy if exists messages_staff_all on public.messages;
create policy messages_staff_all on public.messages
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Customer: can ONLY ever see/write the client channel for their own record.
-- (Internal/team messages are invisible to customers at the database level.)
drop policy if exists messages_customer_read on public.messages;
create policy messages_customer_read on public.messages
  for select to authenticated
  using (channel = 'client' and customer_id = public.my_customer_id());

drop policy if exists messages_customer_write on public.messages;
create policy messages_customer_write on public.messages
  for insert to authenticated
  with check (
    channel = 'client'
    and customer_id = public.my_customer_id()
    and author_id = auth.uid()
  );

grant select, insert, update, delete on public.messages to authenticated;
