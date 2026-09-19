-- Floor King — flooring knowledge engine, pass 63.
-- Run in the Supabase SQL editor AFTER 0190–0251. Idempotent — safe to re-run.
--
-- Guided Estimate cut totals: empty width × length is Order TBD, not 0 sq yd.
-- Measured room square feet ÷ 9 is not an order. Do not plant 12'.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0252_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. These cuts are the order quantity — converting room square feet into yards is not a layout and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. Width starts empty unless the catalog has roll_width_ft. 6''/12'' chips are one tap — we do not plant 6''.'
 where kind = 'cuts'
   and (config->>'category' = 'vinyl' or key = 'vinyl_layout');

commit;
