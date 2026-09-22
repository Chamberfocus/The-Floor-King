-- Floor King — flooring knowledge engine, pass 28.
-- Run in the Supabase SQL editor AFTER 0190–0216. Idempotent — safe to re-run.
--
-- Hard-surface stairs: step count is EACH/step. Stair noses, treads, and
-- risers stay on Trims. Do not invent 8 sq ft (tread+riser) or 4 sq ft
-- (tread only) of flooring as an order quantity. Wrap extra boxes in Builder
-- if the crew uses field plank. Stair labor is per step when a rate is
-- entered — legacy $/sq ft is not multiplied by 8.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0217_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Matching stairnose stays on Trims. Stair labor is $ per step when you enter a rate; do not invent one. Wrap extra boxes in Builder if you use field plank.'
 where kind = 'hs_stairs'
    or key = 'hs_plank_stairs';

commit;
