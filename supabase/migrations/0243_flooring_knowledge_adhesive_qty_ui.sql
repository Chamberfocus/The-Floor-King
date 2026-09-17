-- Floor King — flooring knowledge engine, pass 54.
-- Run in the Supabase SQL editor AFTER 0190–0242. Idempotent — safe to re-run.
--
-- Adhesive / other / labor / trim lines with no sold-by unit are COUNT in
-- Builder (How many / Unit TBD), not the Sq ft field. Taped square feet is
-- still not a glue order. Do not invent gallons or coverage.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0243_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. Do not invent coverage.'
 where key = 'adhesive';

commit;
