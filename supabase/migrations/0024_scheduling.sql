-- Floor King CRM — Phase 20: smart scheduling foundation
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

-- 1) Scheduling settings (single row, admin-managed) --------------------------
create table if not exists public.scheduling_settings (
  id                    text primary key default 'default',
  work_days             text not null default '1,2,3,4,5,6',  -- 0=Sun .. 6=Sat
  day_start             text not null default '09:00',
  day_end               text not null default '17:00',
  estimate_duration_min int  not null default 60,
  travel_buffer_min     int  not null default 30,
  -- installer daily capacities
  cap_carpet_yd         numeric not null default 100,  -- sq yd/day (w/ takeup + furniture)
  cap_lvt_sf            numeric not null default 250,  -- sq ft/day
  cap_laminate_sf       numeric not null default 250,
  cap_hardwood_sf       numeric not null default 175,
  cap_tile_teardown_sf  numeric not null default 100,  -- ceramic tear-out
  cap_subfloor_sheets   numeric not null default 10,
  cap_selflevel_sf      numeric not null default 600,
  updated_at            timestamptz not null default now()
);
insert into public.scheduling_settings (id) values ('default')
  on conflict (id) do nothing;

alter table public.scheduling_settings enable row level security;
drop policy if exists scheduling_settings_read on public.scheduling_settings;
create policy scheduling_settings_read on public.scheduling_settings
  for select to authenticated using (public.my_role() <> 'customer');
drop policy if exists scheduling_settings_admin on public.scheduling_settings;
create policy scheduling_settings_admin on public.scheduling_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.scheduling_settings to authenticated;

-- 2) Material category per estimate line (drives install-day math) -------------
alter table public.estimate_line_items
  add column if not exists category public.product_category;

-- 3) Estimate appointments (smart estimate scheduler) -------------------------
create table if not exists public.appointments (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references public.customers (id) on delete cascade,
  estimate_id    uuid references public.estimates (id) on delete set null,
  salesperson_id uuid references auth.users (id) on delete set null,
  kind           text not null default 'estimate',
  starts_at      timestamptz not null,
  ends_at        timestamptz,
  address        text,
  drive_minutes  int,
  notes          text,
  status         text not null default 'scheduled',
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists appointments_sales_idx
  on public.appointments (salesperson_id, starts_at);

alter table public.appointments enable row level security;
drop policy if exists appointments_staff on public.appointments;
create policy appointments_staff on public.appointments
  for all to authenticated
  using (
    public.is_staff()
    or public.my_role() in ('sales_manager', 'scheduler', 'salesman')
  )
  with check (
    public.is_staff()
    or public.my_role() in ('sales_manager', 'scheduler', 'salesman')
  );
grant select, insert, update, delete on public.appointments to authenticated;
