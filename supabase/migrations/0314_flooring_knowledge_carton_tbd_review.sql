-- Floor King — flooring knowledge engine, pass 125.
-- Run in the Supabase SQL editor AFTER 0190–0313. Idempotent — safe to re-run.
--
-- Review was still printing taped square feet as the order when a boxed
-- LVP / hardwood / carpet-tile SKU is sold by the carton but coverage is
-- missing. Missing coverage stays TBD — not How many boxes from leftover
-- taped sq ft, and not measured-plus-waste as if it were billed by the foot.
-- Coverage on the SKU still takeoffs from measured area. Wrap extras sold
-- by the box still ask How many (0310).
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0314_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

commit;
