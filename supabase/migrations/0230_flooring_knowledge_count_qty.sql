-- Floor King — flooring knowledge engine, pass 41.
-- Run in the Supabase SQL editor AFTER 0190–0229. Idempotent — safe to re-run.
--
-- Count units (each / bag / lnft / sheet) do not invent a quantity of 1 when
-- Builder switches Price per off area, when a count SKU is picked onto an
-- area line, or when a subfloor sheet line is added. Transitions stay EACH —
-- taped square feet is not one T-mold. Warehouse roll receive does not invent
-- square yards when the product unit is missing (Unit TBD until picked).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0230_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'T-mold, reducer, end cap, threshold, or metal — EACH, never square feet. Pick the types here, then add matching catalog pieces on Trims and type the count. Do not invent a SKU, a price, or a quantity of 1 from room square footage. Field verify is allowed.'
 where key = 'hs_transitions';

update public.estimate_questions
   set help = 'Count of doorways or edges that need gripper or flat metal, in EACH. Never square feet. Type the number — we do not invent 1. Type and color are next. Pick a catalog metal in Builder — this does not invent a price.'
 where key = 'metals_qty';

commit;
