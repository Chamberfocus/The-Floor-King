-- Floor King — flooring knowledge engine, pass 67.
-- Run in the Supabase SQL editor AFTER 0190–0255. Idempotent — safe to re-run.
--
-- Vacant occupancy hides furniture moving (light/medium/heavy and specialty
-- items). Empty house — do not invent a furniture charge. Occupied and
-- Unknown still ask. Unanswered stays open. Do NOT SQL-gate furniture on occupancy
-- (0142 — unanswered occupancy must not hide furniture).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0256_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Occupied vs vacant. Vacant hides furniture moving — empty house, do not invent a furniture charge. Occupied and Unknown still ask light/medium/heavy. Unanswered stays open.'
 where key = 'occupancy';

update public.estimate_questions
   set help = 'Light / medium / heavy uses Floor King''s furniture-moving labor. Vacant jobs hide this. Specialty items (piano, pool table) stay on the next question as scope.'
 where key = 'furniture_level';

update public.estimate_questions
   set help = 'Pianos, pool tables, loaded china cabinets. Captured as scope unless a furniture-moving line (light/medium/heavy) is already on this job. Vacant jobs hide this. Do not invent a second charge here.'
 where key = 'furniture_heavy';

commit;
