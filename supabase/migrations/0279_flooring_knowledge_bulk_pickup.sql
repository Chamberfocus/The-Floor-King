-- Floor King — flooring knowledge engine, pass 90.
-- Run in the Supabase SQL editor AFTER 0190–0278. Idempotent — safe to re-run.
--
-- Bulk pickup day was UUID-only (0142). Overlay, review, and new-construction
-- hide could not attach. Key it as bulk_pickup. New construction hides it with
-- the other tear-out questions. Live show_if still waits for Placed at curb.
-- Overlay require hides haul-away / dumpster once disposal is answered.
-- Unanswered work_type stays open. Do not invent a dumpster fee.
-- Do NOT SQL-gate bulk_pickup on work_type (0142 — unanswered new-vs-replacement must still ask when curb is in play).
-- Do NOT SQL-gate bulk_pickup on demo_disposal (0142 show_if already waits for Placed at curb; overlay require hides haul-away).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0279_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set key = 'bulk_pickup',
       help = 'Municipal bulk pickup day so the old floor is at the curb on time. New construction hides this. Haul-away / dumpster hides this. Unanswered disposal stays open in overlay. Do not invent a disposal charge here.'
 where id = '81a746cb-5374-46d2-b828-c7f0053b3c8f'
    or key = 'bulk_pickup';

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, and toilet pull/reset — substrate, prep, appliances, and door shaves still apply. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab.'
 where key = 'work_type';

commit;
