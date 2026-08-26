-- Floor King — the specs that actually differ between carpet, sheet and hard surface
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Adding a product asked every product the same questions, so a carpet was
-- offered coverage-per-bag and a bag of patch was offered a roll width. The
-- fields that genuinely identify a product — the ones a customer asks about and
-- a supplier quotes from — weren't there at all.
--
-- The set below is what the trade actually publishes on a data sheet:
--
--   carpet        face weight (oz/sq yd), fibre, roll width (12' / 15')
--   sheet vinyl   wear layer (mil), gauge (mm), roll width (6' / 12')
--   LVP / LVT     wear layer (mil), thickness (mm), sq ft per box
--   laminate      AC rating (AC1–AC5), thickness (mm), sq ft per box
--   hardwood      species, thickness (mm), sq ft per box
--   tile          PEI rating (I–V), sq ft per box
--
-- roll_width_ft, sqft_per_box, piece_length_in and the coverage pair already
-- existed and are reused — only the six genuinely missing ones are added.

alter table public.products
  -- Vinyl and LVP: the number every customer asks about. Mils, because that's
  -- what North American suppliers print (1 mil = 0.0254 mm).
  add column if not exists wear_layer_mil numeric,
  -- Overall gauge for sheet/LVP/laminate/hardwood. Millimetres, as quoted.
  add column if not exists thickness_mm numeric,
  -- Carpet: ounces of face fibre per square yard — the quality number.
  add column if not exists face_weight_oz numeric,
  -- Carpet: nylon 6,6 / polyester / triexta / wool / olefin.
  add column if not exists fiber text,
  -- Laminate abrasion class (AC1–AC5) and tile abrasion (PEI I–V). Text, since
  -- both are published as grades rather than numbers.
  add column if not exists wear_rating text,
  -- Hardwood: oak, hickory, maple… and whether it's solid or engineered.
  add column if not exists species text;

comment on column public.products.wear_layer_mil is
  'Vinyl / LVP wear layer in mils. The spec customers compare on.';
comment on column public.products.face_weight_oz is
  'Carpet face fibre, ounces per square yard.';
comment on column public.products.wear_rating is
  'Laminate AC1-AC5 or tile PEI I-V — published as a grade, so text.';

create index if not exists products_spec_idx
  on public.products (category)
  where wear_layer_mil is not null or face_weight_oz is not null;
