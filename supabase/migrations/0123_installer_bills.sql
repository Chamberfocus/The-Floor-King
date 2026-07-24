-- 0123 — Installer bills (subcontractor labor billing + estimate-vs-actual).
-- Additive only: no existing column is dropped or altered. Run in Supabase.
-- Safe to re-run.

-- 1) Job labor snapshot + actuals --------------------------------------------
--   estimated_labor_cost: written ONCE when an estimate is approved (job created
--     from it). Never touched again by the bill feature.
--   actual_labor_cost:    written only when an installer bill is approved.
--   labor_variance:       actual_labor_cost − estimated_labor_cost, written at
--     the same time as actual_labor_cost.
alter table public.jobs
  add column if not exists estimated_labor_cost numeric(12, 2),
  add column if not exists actual_labor_cost    numeric(12, 2),
  add column if not exists labor_variance        numeric(12, 2);

-- 2) Installer bills ---------------------------------------------------------
create table if not exists public.installer_bills (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs (id) on delete cascade,
  installer_id uuid references auth.users (id) on delete set null,
  status       text not null default 'draft'
                 check (status in ('draft', 'approved', 'paid')),
  subtotal     numeric(12, 2) not null default 0,
  adjustments  numeric(12, 2) not null default 0,
  total        numeric(12, 2) not null default 0,
  notes        text,
  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  paid_at      timestamptz
);
create index if not exists installer_bills_job_idx on public.installer_bills (job_id);

-- 3) Installer bill line items -----------------------------------------------
create table if not exists public.installer_bill_line_items (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.installer_bills (id) on delete cascade,
  description   text not null default '',
  quantity      numeric(12, 2),
  unit          text,
  rate          numeric(12, 2),
  line_total    numeric(12, 2) not null default 0,
  source        text not null default 'from_work_order'
                  check (source in ('from_work_order', 'manually_added')),
  is_modified   boolean not null default false,
  change_reason text,
  position      int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists installer_bill_line_items_bill_idx
  on public.installer_bill_line_items (bill_id, position);

-- 4) RLS: staff-only (installer pay is internal, like job_labor) -------------
alter table public.installer_bills enable row level security;
drop policy if exists installer_bills_staff on public.installer_bills;
create policy installer_bills_staff on public.installer_bills
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

alter table public.installer_bill_line_items enable row level security;
drop policy if exists installer_bill_line_items_staff on public.installer_bill_line_items;
create policy installer_bill_line_items_staff on public.installer_bill_line_items
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.installer_bills to authenticated;
grant select, insert, update, delete on public.installer_bill_line_items to authenticated;
