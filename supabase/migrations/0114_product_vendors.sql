-- Floor King CRM — Manufacturer (who MAKES it) vs Vendor (who we BUY it from).
-- Manufacturer stays a product attribute; a product can be carried by MULTIPLE
-- vendors, each at its own cost. De-conflates the distributor "OVF" that had
-- leaked into the manufacturer field. Run in Supabase. Idempotent.

-- 1) Which vendors carry a product, each at its own cost -------------------
create table if not exists public.product_vendors (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  vendor_id   uuid not null references public.suppliers (id) on delete cascade,
  cost        numeric,          -- our unit cost from THIS vendor
  vendor_sku  text,             -- the vendor's own item # (optional)
  position    int not null default 0, -- 0 = primary/default vendor
  created_at  timestamptz not null default now(),
  unique (product_id, vendor_id)
);
create index if not exists product_vendors_product_idx
  on public.product_vendors (product_id, position);
create index if not exists product_vendors_vendor_idx
  on public.product_vendors (vendor_id);

alter table public.product_vendors enable row level security;
drop policy if exists product_vendors_staff on public.product_vendors;
create policy product_vendors_staff on public.product_vendors
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.product_vendors to authenticated;

-- 2) De-conflate OVF (a DISTRIBUTOR) out of the manufacturer field ---------
do $$
declare ovf uuid;
begin
  select id into ovf from public.suppliers where lower(trim(name)) = 'ovf' limit 1;
  if ovf is null then
    insert into public.suppliers (name, kind, active)
      values ('OVF', 'distributor', true) returning id into ovf;
  end if;

  -- "OVF (Dreamweaver)" → maker is Dreamweaver, vendor is OVF.
  update public.products
     set manufacturer = 'Dreamweaver', supplier_id = ovf, supplier = 'OVF'
   where lower(trim(manufacturer)) = 'ovf (dreamweaver)';

  -- Plain "OVF" → the maker isn't recorded (blank it), vendor is OVF.
  update public.products
     set manufacturer = null, supplier_id = ovf, supplier = 'OVF'
   where lower(trim(manufacturer)) = 'ovf';

  -- Give every product now sourced from OVF a vendor row at its catalog cost,
  -- so the everyday single-vendor path is populated (not a duplicate — this IS
  -- the product's vendor list).
  insert into public.product_vendors (product_id, vendor_id, cost, position)
  select p.id, ovf, p.material_rate, 0
    from public.products p
   where p.supplier_id = ovf
     and not exists (
       select 1 from public.product_vendors pv
        where pv.product_id = p.id and pv.vendor_id = ovf
     );
end $$;

-- 3) Backfill product_vendors for any product that ALREADY had a single
--    vendor set (so existing single-vendor products behave unchanged) --------
insert into public.product_vendors (product_id, vendor_id, cost, position)
select p.id, p.supplier_id, p.material_rate, 0
  from public.products p
 where p.supplier_id is not null
   and not exists (
     select 1 from public.product_vendors pv
      where pv.product_id = p.id and pv.vendor_id = p.supplier_id
   );
