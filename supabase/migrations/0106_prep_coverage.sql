-- Coverage-based bag calculator for prep materials (self-levelers, patches,
-- primers). Products carry their coverage (SF) at a reference thickness — a
-- self-leveler's coverage scales inversely with pour thickness; a flat-coverage
-- product (primer/adhesive) leaves the reference thickness null. Estimate lines
-- snapshot the coverage + carry the pour thickness so the bag math is stable and
-- reproducible, and a prep material line links to its auto-populated labor line
-- by prep_key. Area reuses estimate_line_items.sqft; bags are the quantity.
alter table public.products
  add column if not exists coverage_sqft         numeric,
  add column if not exists coverage_thickness_in numeric;

alter table public.estimate_line_items
  add column if not exists coverage_sqft         numeric,
  add column if not exists coverage_thickness_in numeric,
  add column if not exists prep_thickness_in     numeric,
  add column if not exists prep_key              text;
