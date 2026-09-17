-- Floor King — flooring knowledge engine, pass 48.
-- Run in the Supabase SQL editor AFTER 0190–0236. Idempotent — safe to re-run.
--
-- Hard-surface stair wrap product picker uses this job's flooring family.
-- Hardwood stairs do not plant LVP. Mixed jobs leave category TBD instead of
-- guessing LVP. The add-product form does the same when no category is given.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0237_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Hard-surface stairs. Count the steps. Wrap product follows this job''s flooring family — hardwood does not plant LVP. Mixed jobs leave the category TBD. Noses / treads / risers fill on Trims in EACH. Wrap qty is not an automatic sq ft/step order.'
 where key = 'hs_plank_stairs';

commit;
