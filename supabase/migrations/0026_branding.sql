-- Floor King CRM — Phase 22: branding (logo, colors, contact info)
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

create table if not exists public.org_settings (
  id            text primary key default 'default',
  company_name  text not null default 'Cleveland Floor King',
  logo_url      text,
  primary_color text,
  phone         text,
  email         text,
  address       text,
  updated_at    timestamptz not null default now()
);
insert into public.org_settings (id) values ('default') on conflict (id) do nothing;

alter table public.org_settings enable row level security;
drop policy if exists org_settings_read on public.org_settings;
create policy org_settings_read on public.org_settings
  for select to authenticated using (true);
drop policy if exists org_settings_admin on public.org_settings;
create policy org_settings_admin on public.org_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.org_settings to authenticated;

-- Public bucket for the logo (so it shows in emails, the portal, and PDFs).
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists branding_public_read on storage.objects;
create policy branding_public_read on storage.objects
  for select to public using (bucket_id = 'branding');
drop policy if exists branding_admin_write on storage.objects;
create policy branding_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'branding' and public.is_admin())
  with check (bucket_id = 'branding' and public.is_admin());
