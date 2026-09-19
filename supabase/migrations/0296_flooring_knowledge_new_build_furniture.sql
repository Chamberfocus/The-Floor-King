-- Floor King — flooring knowledge engine, pass 107.
-- Run in the Supabase SQL editor AFTER 0190–0295. Idempotent — safe to re-run.
--
-- Furniture moving is for occupied replacement floors. Vacant already hides
-- it. Exclusive new construction still asked light/medium/heavy and piano /
-- pool-table notes — a new slab has no furniture to move. Hide
-- furniture_level and furniture_heavy once every work-type pick is New
-- construction. Mixed Replacement + New construction stays open. Unanswered
-- stays open. Occupied new construction still hides furniture.
-- Do NOT SQL-gate furniture on work_type (0142 — mixed Replacement + New construction must still ask furniture).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0296_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Light / medium / heavy uses Floor King''s furniture-moving labor. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job. Exclusive new construction hides this — a new slab has no furniture to move. Mixed Replacement + New construction still asks. Specialty items (piano, pool table) stay on the next question as scope.'
 where key = 'furniture_level';

update public.estimate_questions
   set help = 'Pianos, pool tables, and loaded cabinets are scope/schedule notes unless this job already has a furniture-moving labor line. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job. Exclusive new construction hides this — a new slab has no furniture to move. Mixed Replacement + New construction still asks.'
 where key = 'furniture_heavy';

update public.estimate_questions
   set help = 'Occupied vs vacant. Vacant hides furniture moving — empty house, do not invent a furniture charge. Exclusive wall tile also hides it — a backsplash is not a furniture-moving job. Exclusive new construction also hides it — a new slab has no furniture to move. Occupied and Unknown still ask light/medium/heavy. Unanswered stays open.'
 where key = 'occupancy';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab.'
 where key = 'work_type';

commit;
