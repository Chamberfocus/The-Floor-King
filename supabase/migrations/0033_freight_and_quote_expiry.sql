-- Freight / fuel protection + quote expiration.

-- 1) Suppliers: per-manufacturer/distributor freight, matched by name --------
create table if not exists public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  freight_pct      numeric not null default 0,   -- % added to material cost
  freight_per_unit numeric not null default 0,   -- optional flat $/unit add
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists suppliers_name_idx on public.suppliers (lower(name));

alter table public.suppliers enable row level security;
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select using (public.is_staff());
drop policy if exists suppliers_write on public.suppliers;
create policy suppliers_write on public.suppliers
  for all using (public.is_staff()) with check (public.is_staff());

-- 2) Global fuel surcharge + quote terms on org settings --------------------
alter table public.org_settings
  add column if not exists fuel_surcharge_pct numeric not null default 0,
  add column if not exists quote_valid_days   int     not null default 30,
  add column if not exists freight_disclaimer text;

update public.org_settings
  set freight_disclaimer = coalesce(
    freight_disclaimer,
    'Pricing reflects freight and fuel surcharges in effect on the quote date and is subject to change at time of order.'
  )
  where id = 'default';

-- 3) Quote expiration on estimates ------------------------------------------
alter table public.estimates
  add column if not exists valid_until date;
