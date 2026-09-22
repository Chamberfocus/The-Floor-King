-- Floor King — flooring knowledge engine, pass 55.
-- Run in the Supabase SQL editor AFTER 0190–0243. Idempotent — safe to re-run.
--
-- Pad / underlayment with no sold-by unit is COUNT in Builder (How many /
-- Unit TBD), not the Sq ft field. Pricing uses the same count-vs-area rule
-- as display (`isCountPricedLine`) so leftover measure_unit sqft cannot
-- turn a TBD pad or toilet into square feet.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0244_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Quantity follows CARPET rooms only — mixed jobs do not buy pad for the LVP. Glue-down and carpet tile hide this step. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet.'
 where key = 'carpet_pad';

commit;
