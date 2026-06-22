-- Floor King CRM — where we order each product from. The price-list import and
-- catalog capture the supplier; POs then populate per vendor. Safe to re-run.

alter table public.products
  add column if not exists supplier text;

create index if not exists products_supplier_idx
  on public.products (lower(supplier));
