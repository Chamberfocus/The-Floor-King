-- Supplier ordering sites and pay sites.
-- The password is not in this table. It is stored encrypted in supplier_site_secrets,
-- which signed-in users cannot read. The app decrypts it only for an owner or
-- office login, and only after writing an open record.
-- Salespeople, installers, warehouse, and customers cannot read these rows.

create table if not exists public.supplier_sites (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers (id) on delete set null,
  name text not null,
  purpose text not null check (purpose in ('order', 'pay')),
  site_url text not null,
  username text not null default '',
  has_secret boolean not null default false,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_sites_https check (
    site_url ~ '^https://[^[:space:]@]+$'
  )
);

create index if not exists supplier_sites_supplier_idx
  on public.supplier_sites (supplier_id);

create table if not exists public.supplier_site_secrets (
  site_id uuid primary key references public.supplier_sites (id) on delete cascade,
  secret_cipher text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_site_opens (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.supplier_sites (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists supplier_site_opens_created_idx
  on public.supplier_site_opens (created_at desc);

alter table public.supplier_sites enable row level security;
alter table public.supplier_site_secrets enable row level security;
alter table public.supplier_site_opens enable row level security;

drop policy if exists supplier_sites_select on public.supplier_sites;
drop policy if exists supplier_sites_insert on public.supplier_sites;
drop policy if exists supplier_sites_update on public.supplier_sites;
drop policy if exists supplier_sites_delete on public.supplier_sites;

create policy supplier_sites_select on public.supplier_sites
  for select to authenticated
  using (public.user_role(auth.uid())::text in ('admin', 'office'));

create policy supplier_sites_insert on public.supplier_sites
  for insert to authenticated
  with check (public.user_role(auth.uid())::text = 'admin');

create policy supplier_sites_update on public.supplier_sites
  for update to authenticated
  using (public.user_role(auth.uid())::text = 'admin')
  with check (public.user_role(auth.uid())::text = 'admin');

create policy supplier_sites_delete on public.supplier_sites
  for delete to authenticated
  using (public.user_role(auth.uid())::text = 'admin');

-- No policies on the password table or the open log. Authenticated users
-- cannot select them. The server reads them with the service role after it
-- checks the person's role.

revoke all on public.supplier_sites from public, anon;
grant select, insert, update, delete on public.supplier_sites to authenticated;

revoke all on public.supplier_site_secrets from public, anon, authenticated;
revoke all on public.supplier_site_opens from public, anon, authenticated;
