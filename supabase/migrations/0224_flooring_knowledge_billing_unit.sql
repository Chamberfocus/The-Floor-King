-- Floor King — flooring knowledge engine, pass 35.
-- Run in the Supabase SQL editor AFTER 0190–0223. Idempotent — safe to re-run.
--
-- Leftover measure_unit is not the billing unit. Catalog SY rates convert from
-- the printed line unit (sq yd vs sq ft), never a stray "sqft" on a yard line.
-- Boxed hard surface keeps MEASURED sqft and waste_pct — waste is not baked
-- into quantity with sqft wiped.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0224_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Enter rooms in feet and inches. Add a section for closets and offsets. This is MEASURED area — order quantity is calculated next from the product and (for carpet) the cuts. Leftover sq ft on a sq-yd line is not a billing unit and must not 9× a catalog SY rate.'
 where kind = 'areas';

commit;
