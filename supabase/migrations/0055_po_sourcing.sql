-- Floor King CRM — Purchase Order overhaul: customer-focused, source-aware.
-- Make POs distinguish Manufacturer vs Distributor vs (pulled-from) Stock, tie
-- each PO to a real supplier, and keep inventory/finance perfectly in sync.
-- Self-contained & defensive: creates anything missing. Safe to re-run.

-- 0) Make sure the suppliers table exists (was originally in 0033) -----------
create table if not exists public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  freight_pct      numeric not null default 0,
  freight_per_unit numeric not null default 0,
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
grant select, insert, update, delete on public.suppliers to authenticated;

-- 1) Suppliers gain a TYPE so we know who we're ordering from ----------------
alter table public.suppliers
  add column if not exists kind text not null default 'distributor';
-- allowed: 'manufacturer' | 'distributor'

-- 2) Products remember their supplier (defensive: 'supplier' text may be new) -
alter table public.products
  add column if not exists supplier    text,
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;
create index if not exists products_supplier_id_idx
  on public.products (supplier_id);

-- 3) Purchase orders point at a real supplier + carry their source type ------
alter table public.purchase_orders
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null,
  add column if not exists source_type text; -- 'manufacturer' | 'distributor' | 'stock'
create index if not exists po_supplier_idx
  on public.purchase_orders (supplier_id);

-- 4) Backfill existing data so nothing looks blank ---------------------------
-- Link POs to a supplier row by matching the free-text name.
update public.purchase_orders po
   set supplier_id = s.id
  from public.suppliers s
 where po.supplier_id is null
   and po.supplier is not null
   and lower(trim(po.supplier)) = lower(trim(s.name));

-- Link products to a supplier row by matching the free-text name.
update public.products p
   set supplier_id = s.id
  from public.suppliers s
 where p.supplier_id is null
   and p.supplier is not null
   and lower(trim(p.supplier)) = lower(trim(s.name));

-- Source type follows the linked supplier's kind…
update public.purchase_orders po
   set source_type = s.kind
  from public.suppliers s
 where po.source_type is null
   and po.supplier_id = s.id;

-- …and anything still unset but with a vendor name defaults to 'distributor'.
update public.purchase_orders
   set source_type = 'distributor'
 where source_type is null
   and supplier is not null
   and trim(supplier) <> '';
