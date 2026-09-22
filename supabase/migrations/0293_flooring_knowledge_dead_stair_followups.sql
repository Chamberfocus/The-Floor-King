-- Floor King — flooring knowledge engine, pass 104.
-- Run in the Supabase SQL editor AFTER 0190–0292. Idempotent — safe to re-run.
--
-- Generic Stairs yes/no is overlay-hidden once family-specific stairs are
-- live. Landings / open sides still required leftover stairs=Yes, so
-- unanswered require on that hidden parent kept them open on every carpet
-- and hard-surface overlay walk. Hide stair_landings and stair_open_sides
-- until Carpet stairs, Carpet tile stairs, or hard-surface plank stairs is
-- Yes. Leftover stairs=Yes without a family Yes does not reopen them —
-- hidden answers do not gate. Unanswered project_type stays open.
-- Do NOT SQL-gate stair_landings on carpet_stairs (0142 — synthesizeStairGate copies family Yes onto stairs; live show_if still waits for that Yes).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0293_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Count of landings in EACH. Measured with the rooms when they are floored the same; this flags extra pieces and noses. Exclusive wall tile hides this — a backsplash is not a stair job. Leftover Stairs yes/no hides this once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Unanswered project_type stays open.'
 where key = 'stair_landings';

update public.estimate_questions
   set help = 'Open sides change wrapped carpet ends and hard-surface nosing. Exclusive wall tile hides this. Leftover Stairs yes/no hides this once family-specific stairs are in play — open sides still follow those Yes answers. Capture the construction — pricing still uses existing stair labor.'
 where key = 'stair_open_sides';

update public.estimate_questions
   set help = 'Stairs change material, labor, and trim. Exclusive wall tile hides this — a backsplash is not a stair job. Mixed carpet or LVP + wall still asks the family-specific stair questions. This leftover yes/no hides once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Leftover landings / open sides hide until a family stair question is Yes. Unanswered project_type stays open. Field verify if you have not seen them.'
 where key = 'stairs';

commit;
