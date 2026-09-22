-- Floor King — flooring knowledge engine, pass 57.
-- Run in the Supabase SQL editor AFTER 0190–0245. Idempotent — safe to re-run.
--
-- Hard-surface stair wrap is extra boxes / EACH, never taped square feet.
-- Questionnaire emit strips an area sold-by unit so typing 13×8 sq ft in
-- Builder cannot reopen the invented 8 sq ft/step order. Pricing keys off
-- "wrap qty TBD" and bills quantity only.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0246_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Wrap extra boxes are How many / Unit TBD in Builder (wrap qty TBD), never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one.'
 where key = 'hs_plank_stairs';

commit;
