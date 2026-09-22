-- Floor King — flooring knowledge engine, pass 123.
-- Run in the Supabase SQL editor AFTER 0190–0311. Idempotent — safe to re-run.
--
-- A boxed LVP / hardwood SKU sold by the carton with catalog coverage still
-- takeoffs from measured area. Carton math uses sqft_per_box — we do not
-- invent a box size and we do not treat leftover taped sq ft as How many
-- boxes. Missing coverage stays TBD. Wrap extras sold by the box still ask
-- How many (0310) — this pass is floor-map / main flooring emit only.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0312_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size.'
 where kind = 'floor_map';

commit;
