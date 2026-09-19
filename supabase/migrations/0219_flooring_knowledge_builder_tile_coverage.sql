-- Floor King — flooring knowledge engine, pass 30.
-- Run in the Supabase SQL editor AFTER 0190–0218. Idempotent — safe to re-run.
--
-- Exclusive carpet tile is modular coverage in Builder, not a warehouse cut
-- plan. Cuts vs Roll stays on broadloom / sheet vinyl. Carton math only when
-- product sqft_per_box exists — we do not invent a box size.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0219_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

commit;
