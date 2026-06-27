-- Install crews you assign jobs to — including subcontractor crews that have NO
-- app login. Managed under Settings → Install Crews; assignable on a job and
-- linkable to subcontractor payouts.

create table if not exists public.install_crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'subcontractor', -- 'subcontractor' | 'employee'
  phone       text,
  email       text,
  pay_basis   text,                  -- optional default: 'flat' | 'per_sqft' | 'per_sqyd' | 'percent'
  pay_rate    numeric(12, 2),        -- optional default pay rate
  active      boolean not null default true,
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.install_crews enable row level security;
drop policy if exists install_crews_staff on public.install_crews;
create policy install_crews_staff on public.install_crews
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.install_crews to authenticated;

drop trigger if exists set_install_crews_updated_at on public.install_crews;
create trigger set_install_crews_updated_at before update on public.install_crews
  for each row execute function public.set_updated_at();

-- Assign a job to an install crew (alongside the existing app-login assignment).
alter table public.jobs
  add column if not exists assigned_crew_id uuid references public.install_crews (id) on delete set null;
create index if not exists jobs_assigned_crew_idx on public.jobs (assigned_crew_id);

-- Optionally tie a recorded payout to the crew it went to.
alter table public.job_labor
  add column if not exists crew_id uuid references public.install_crews (id) on delete set null;
