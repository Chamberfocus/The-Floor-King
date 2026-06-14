-- Floor King CRM — Profit Intelligence: real job costing
-- Captures what jobs ACTUALLY cost (subcontractor payouts) so profit is true,
-- and a small settings row so the CRM knows what "good" looks like (target margin).
-- Run in Supabase: SQL Editor -> paste -> Run. Safe to re-run.

-- 1) Subcontractor / crew payouts per job ------------------------------------
-- Flooring labor is paid flat per job (or per sq ft / sq yd). This is the cost
-- the CRM was blind to before, which made job profit a fantasy.
create table if not exists public.job_labor (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  payee       text,                              -- who got paid (crew / sub name)
  basis       text not null default 'flat',      -- 'flat' | 'per_sqft' | 'per_sqyd'
  rate        numeric(12, 2),                    -- $ per unit when basis is per_*
  area        numeric(12, 2),                    -- sqft/sqyd when basis is per_*
  amount      numeric(12, 2) not null default 0, -- the actual payout (source of truth)
  paid        boolean not null default false,
  paid_on     date,
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists job_labor_job_idx on public.job_labor (job_id);
create index if not exists job_labor_paid_idx on public.job_labor (paid, paid_on);

drop trigger if exists job_labor_set_updated_at on public.job_labor;
create trigger job_labor_set_updated_at
  before update on public.job_labor
  for each row execute function public.set_updated_at();

alter table public.job_labor enable row level security;

-- Staff: full access.
drop policy if exists job_labor_staff on public.job_labor;
create policy job_labor_staff on public.job_labor
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.job_labor to authenticated;

-- 2) Business settings (single row) ------------------------------------------
-- What the profit brain measures against: target gross margin and a monthly
-- revenue goal. Admin-managed; everyone on staff can read.
create table if not exists public.business_settings (
  id                      text primary key default 'default',
  target_gross_margin_pct numeric not null default 40,
  monthly_revenue_goal    numeric not null default 0,
  updated_at              timestamptz not null default now()
);
insert into public.business_settings (id) values ('default')
  on conflict (id) do nothing;

alter table public.business_settings enable row level security;
drop policy if exists business_settings_read on public.business_settings;
create policy business_settings_read on public.business_settings
  for select to authenticated using (public.my_role() <> 'customer');
drop policy if exists business_settings_admin on public.business_settings;
create policy business_settings_admin on public.business_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.business_settings to authenticated;
