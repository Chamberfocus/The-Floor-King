-- Floor King — flooring knowledge engine, pass 99.
-- Run in the Supabase SQL editor AFTER 0190–0287. Idempotent — safe to re-run.
--
-- Generic Stairs yes/no is a leftover synthesizer. Live stair questions are
-- Carpet stairs, Carpet tile stairs, and hard-surface plank stairs.
-- Overlay hides the dead gate once a family-specific stair question is in
-- play. Landings / open sides still follow those Yes answers via
-- synthesizeStairGate. Unanswered project_type stays open. Exclusive wall
-- already hides stairs. Mixed Carpet + LVP still asks both family stairs.
-- Do NOT SQL-gate stair_landings on carpet_stairs (0142 — synthesizeStairGate copies Yes onto stairs).
-- Do NOT SQL-gate stairs on carpet_install (0142 — unanswered project_type must still ask the leftover gate).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0288_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stairs change material, labor, and trim. Exclusive wall tile hides this — a backsplash is not a stair job. Mixed carpet or LVP + wall still asks the family-specific stair questions. This leftover yes/no hides once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Unanswered project_type stays open. Field verify if you have not seen them.'
 where key = 'stairs';

commit;
