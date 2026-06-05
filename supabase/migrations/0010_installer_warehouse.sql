-- Floor King CRM — Phase 6: Installer board + Warehouse
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

-- 1) New 'warehouse' role (added to existing enum) ---------------------------
-- NOTE: we compare roles via ::text elsewhere so we never use this value as an
-- enum literal in the same transaction it is added (avoids "unsafe use" errors).
alter type public.user_role add value if not exists 'warehouse';

-- 2) New enums ---------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'job_delivery') then
    create type public.job_delivery as enum ('cash_carry', 'deliver', 'deliver_acclimate');
  end if;
  if not exists (select 1 from pg_type where typname = 'warehouse_status') then
    create type public.warehouse_status as enum
      ('pending', 'staged', 'out_for_delivery', 'delivered', 'picked_up');
  end if;
  if not exists (select 1 from pg_type where typname = 'job_application_status') then
    create type public.job_application_status as enum ('applied', 'accepted', 'declined');
  end if;
end $$;

-- 3) Job columns for warehouse + the open board ------------------------------
alter table public.jobs
  add column if not exists delivery_type public.job_delivery not null default 'deliver';
alter table public.jobs
  add column if not exists warehouse_status public.warehouse_status not null default 'pending';
alter table public.jobs
  add column if not exists open_for_claim boolean not null default false;

-- 4) Installer applications to open jobs -------------------------------------
create table if not exists public.job_applications (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs (id) on delete cascade,
  installer_id uuid not null references auth.users (id) on delete cascade,
  status       public.job_application_status not null default 'applied',
  note         text,
  created_at   timestamptz not null default now(),
  unique (job_id, installer_id)
);
create index if not exists job_applications_job_idx on public.job_applications (job_id);
create index if not exists job_applications_installer_idx on public.job_applications (installer_id);

alter table public.job_applications enable row level security;

-- 5) RLS ---------------------------------------------------------------------
-- Crew (installers): see jobs assigned to them OR open on the board.
drop policy if exists jobs_crew_read on public.jobs;
create policy jobs_crew_read on public.jobs
  for select to authenticated
  using (assigned_to = auth.uid() or open_for_claim = true);

-- Warehouse: read all jobs + update (staging status / delivery type).
drop policy if exists jobs_warehouse_read on public.jobs;
create policy jobs_warehouse_read on public.jobs
  for select to authenticated
  using (public.user_role(auth.uid())::text = 'warehouse');
drop policy if exists jobs_warehouse_update on public.jobs;
create policy jobs_warehouse_update on public.jobs
  for update to authenticated
  using (public.user_role(auth.uid())::text = 'warehouse')
  with check (public.user_role(auth.uid())::text = 'warehouse');

-- Warehouse: read the materials scope + delivery addresses.
drop policy if exists estimate_options_warehouse_read on public.estimate_options;
create policy estimate_options_warehouse_read on public.estimate_options
  for select to authenticated
  using (public.user_role(auth.uid())::text = 'warehouse');
drop policy if exists estimate_line_items_warehouse_read on public.estimate_line_items;
create policy estimate_line_items_warehouse_read on public.estimate_line_items
  for select to authenticated
  using (public.user_role(auth.uid())::text = 'warehouse');
drop policy if exists customers_warehouse_read on public.customers;
create policy customers_warehouse_read on public.customers
  for select to authenticated
  using (public.user_role(auth.uid())::text = 'warehouse');

-- Applications: staff see all; installers manage their own.
drop policy if exists job_applications_staff_all on public.job_applications;
create policy job_applications_staff_all on public.job_applications
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists job_applications_installer_own on public.job_applications;
create policy job_applications_installer_own on public.job_applications
  for all to authenticated
  using (installer_id = auth.uid()) with check (installer_id = auth.uid());

grant select, insert, update, delete on public.job_applications to authenticated;
