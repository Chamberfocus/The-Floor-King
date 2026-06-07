-- Richer catalog products: manufacturer / style / color so a catalog item
-- carries everything an estimate line needs, and picking it in the wizard
-- fills the whole line. These mirror the free-text fields on estimate lines.

alter table public.products
  add column if not exists manufacturer text,
  add column if not exists style        text,
  add column if not exists color        text;

-- Help the wizard's catalog search.
create index if not exists products_search_idx
  on public.products (lower(name));
