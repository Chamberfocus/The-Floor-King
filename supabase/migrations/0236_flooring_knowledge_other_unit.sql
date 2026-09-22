-- Floor King — flooring knowledge engine, pass 47.
-- Run in the Supabase SQL editor AFTER 0190–0235. Idempotent — safe to re-run.
--
-- Adding an Other / adhesive product does not plant sq ft as the sold-by unit.
-- Floor-map "fill empty rooms" uses the job's flooring family, not a default LVP.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0236_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Fill-empty uses this job''s flooring family — it does not plant LVP on a carpet job. Sold-by for Other / adhesive is TBD until you pick a unit; we do not plant sq ft on a pail of glue.'
 where kind = 'floor_map';

commit;
