-- Floor King — flooring knowledge engine, pass 53.
-- Run in the Supabase SQL editor AFTER 0190–0241. Idempotent — safe to re-run.
--
-- Mixed carpet + LVP (or any 2+ families) with measured rooms but no floor-map
-- assignment used to silently takeoff 0. Review now warns: assign each room
-- to a product — mixed jobs do not clone whole-job sq ft onto every family.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0242_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms.'
 where kind = 'floor_map';

commit;
