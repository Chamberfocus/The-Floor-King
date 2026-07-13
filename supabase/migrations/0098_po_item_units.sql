-- Vendor-unit accuracy on purchase orders: carry the product category + the
-- hard-surface carton coverage (sq ft per box) and the carpet broadloom width
-- onto each PO line so the printed PO can show CARTONS (not raw sq ft) for hard
-- surface and roll width for carpet, and reliably flag lot/dye on hard-surface
-- orders — the single most common and costly ordering error. Idempotent.
alter table public.po_items
  add column if not exists category text,
  add column if not exists sqft_per_box numeric,
  add column if not exists roll_width_ft numeric;
