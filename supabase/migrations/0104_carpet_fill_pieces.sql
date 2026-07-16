-- Carpet FILL pieces — an estimate carpet line can be flagged as a fill / seam
-- piece (an extra cut off the same roll for an area). The flag flows onto the
-- staging sheet, work order, and purchase order cut lists so fill pieces show
-- clearly everywhere and still count toward the roll yardage ordered.
alter table public.estimate_line_items
  add column if not exists is_fill boolean not null default false;
