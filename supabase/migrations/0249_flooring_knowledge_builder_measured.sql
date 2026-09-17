-- Floor King — flooring knowledge engine, pass 60.
-- Run in the Supabase SQL editor AFTER 0190–0248. Idempotent — safe to re-run.
--
-- Builder roll goods without warehouse cuts: leftover sq ft is MEASURED
-- area, not the order. Label it "Measured sq ft (not the order)". Sq ft ÷ 9
-- is equivalent area, not a cut plan. Hard-surface boxed lines may still
-- enter sq ft directly as the order. Do not invent a 12-foot width.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0249_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Builder labels leftover sq ft as measured area, not the order — Sq ft ÷ 9 is equivalent area. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. These cuts are the order quantity — converting room square feet into yards is not a layout and is not billed as an order. Builder labels leftover sq ft as measured area, not the order — Sq ft ÷ 9 is equivalent area. Width starts empty unless the catalog has roll_width_ft. 6''/12'' chips are one tap — we do not plant 6''.'
 where kind = 'cuts'
   and (config->>'category' = 'vinyl' or key = 'vinyl_layout');

commit;
