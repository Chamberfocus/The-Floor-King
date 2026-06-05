-- Floor King CRM — Phase 3: Jobs & Work Orders
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

-- 1) Enum --------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type public.job_status as enum
      ('unscheduled', 'scheduled', 'in_progress', 'completed', 'cancelled');
  end if;
end $$;

-- 2) Jobs --------------------------------------------------------------------
create table if not exists public.jobs (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers (id) on delete cascade,
  estimate_id    uuid references public.estimates (id) on delete set null,
  option_id      uuid references public.estimate_options (id) on delete set null,
  title          text,
  status         public.job_status not null default 'unscheduled',
  scheduled_date date,
  scheduled_end  date,
  assigned_to    uuid references auth.users (id) on delete set null,
  site_street    text,
  site_city      text,
  site_state     text,
  site_zip       text,
  notes          text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists jobs_customer_idx on public.jobs (customer_id, created_at desc);
create index if not exists jobs_status_idx on public.jobs (status);
create index if not exists jobs_scheduled_idx on public.jobs (scheduled_date);
create index if not exists jobs_assigned_idx on public.jobs (assigned_to);

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- 3) Row-Level Security ------------------------------------------------------
alter table public.jobs enable row level security;

-- Staff: full access.
drop policy if exists jobs_staff_all on public.jobs;
create policy jobs_staff_all on public.jobs
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Crew: see and update only the jobs assigned to them (status, notes from field).
drop policy if exists jobs_crew_read on public.jobs;
create policy jobs_crew_read on public.jobs
  for select to authenticated
  using (assigned_to = auth.uid());

drop policy if exists jobs_crew_update on public.jobs;
create policy jobs_crew_update on public.jobs
  for update to authenticated
  using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());

grant select, insert, update, delete on public.jobs to authenticated;
