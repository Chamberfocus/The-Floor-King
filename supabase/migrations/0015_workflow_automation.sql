-- Floor King CRM — Phase 11: qualifying, backorders, scheduled-email timing
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

-- Configurable qualifying questions
create table if not exists public.qualifying_questions (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  help       text,
  position   int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.qualifying_questions enable row level security;
drop policy if exists qq_staff_all on public.qualifying_questions;
create policy qq_staff_all on public.qualifying_questions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists qq_read on public.qualifying_questions;
create policy qq_read on public.qualifying_questions
  for select to authenticated using (true);
grant select, insert, update, delete on public.qualifying_questions to authenticated;

do $$ begin
  if not exists (select 1 from public.qualifying_questions) then
    insert into public.qualifying_questions (label, position) values
      ('What rooms / areas are they looking to do?', 10),
      ('What product are they interested in (carpet, LVP, hardwood…)?', 20),
      ('What is their budget range?', 30),
      ('What is their timeline?', 40),
      ('Are they the homeowner / decision maker?', 50),
      ('Confirm how they heard about us (lead source)', 60),
      ('Insurance, cash, or financing?', 70);
  end if;
end $$;

-- Customer qualification flag
alter table public.customers add column if not exists qualified boolean;

-- Estimate timing (for the 2-hour thank-you scheduler)
alter table public.estimates add column if not exists sent_at timestamptz;
alter table public.estimates add column if not exists thankyou_sent_at timestamptz;

-- Purchase order backorder tracking
alter table public.purchase_orders add column if not exists eta_date date;
alter table public.purchase_orders add column if not exists backordered boolean not null default false;

-- Job reminder timing (for the day-before reminder scheduler)
alter table public.jobs add column if not exists reminder_sent_at timestamptz;
