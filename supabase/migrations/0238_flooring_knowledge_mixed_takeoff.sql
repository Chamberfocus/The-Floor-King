-- Floor King — flooring knowledge engine, pass 49.
-- Run in the Supabase SQL editor AFTER 0190–0237. Idempotent — safe to re-run.
--
-- Mixed jobs do not clone whole-job taped sq ft onto every family. Carpet
-- rooms keep carpet measured area; LVP rooms keep LVP. Unassigned mixed
-- takeoffs stay empty rather than inventing 500 sq ft of both.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0238_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Fill-empty uses this job''s flooring family. Sold-by for Other / adhesive is TBD until you pick a unit.'
 where kind = 'floor_map';

commit;
