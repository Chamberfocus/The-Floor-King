-- Floor King CRM — Phase 24: per-installer capacity & work days
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.
-- Any column left null falls back to the shop-wide Scheduling defaults.

create table if not exists public.installer_settings (
  installer_id          uuid primary key references auth.users (id) on delete cascade,
  work_days             text,
  cap_carpet_yd         numeric,
  cap_lvt_sf            numeric,
  cap_laminate_sf       numeric,
  cap_hardwood_sf       numeric,
  cap_tile_teardown_sf  numeric,
  cap_subfloor_sheets   numeric,
  cap_selflevel_sf      numeric,
  updated_at            timestamptz not null default now()
);

alter table public.installer_settings enable row level security;
drop policy if exists installer_settings_read on public.installer_settings;
create policy installer_settings_read on public.installer_settings
  for select to authenticated using (public.my_role() <> 'customer');
drop policy if exists installer_settings_manage on public.installer_settings;
create policy installer_settings_manage on public.installer_settings
  for all to authenticated
  using (public.is_staff() or public.my_role() = 'scheduler')
  with check (public.is_staff() or public.my_role() = 'scheduler');
grant select, insert, update, delete on public.installer_settings to authenticated;
