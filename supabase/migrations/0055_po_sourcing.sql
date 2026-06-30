-- Floor King CRM — Purchase Order overhaul: customer-focused, source-aware.
-- Make POs distinguish Manufacturer vs Distributor vs (pulled-from) Stock, tie
-- each PO to a real supplier, and keep inventory/finance perfectly in sync.
-- Run in Supabase SQL editor. Safe to re-run.

-- 1) Suppliers gain a TYPE so we know who we're ordering from -----------------
alter table public.suppliers
  add column if not exists kind text not null default 'distributor';
-- allowed: 'manufacturer' | 'distributor'

-- 2) Purchase orders point at a real supplier + carry their source type -------
alter table public.purchase_orders
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null,
  add column if not exists source_type text; -- 'manufacturer' | 'distributor' | 'stock'

create index if not exists po_supplier_idx
  on public.purchase_orders (supplier_id);

-- 3) Products remember which supplier they come from (id, not just text) ------
alter table public.products
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

create index if not exists products_supplier_id_idx
  on public.products (supplier_id);

-- 4) Backfill existing data so nothing looks blank ----------------------------
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
