-- QuickBooks-style PO auto-fill needs the vendor-unit helpers on the CATALOG so
-- picking a product fills them (no retyping): hard-surface carton coverage and
-- carpet broadloom roll width. Idempotent. No historical data is rewritten.
alter table public.products
  add column if not exists sqft_per_box numeric,
  add column if not exists roll_width_ft numeric;
