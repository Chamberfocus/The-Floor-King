-- Floor King — flooring knowledge engine, pass 68.
-- Run in the Supabase SQL editor AFTER 0190–0256. Idempotent — safe to re-run.
--
-- New construction hides existing-vinyl skim. There is no existing vinyl to
-- skim. Replacement and unanswered still ask. Do NOT SQL-gate vinyl_skim on work_type
-- (0142 — unanswered new-vs-replacement must not hide skim).
-- Substrate and floor prep still apply. Do not invent a bag count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0257_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, and disposal — substrate and prep still apply. Unknown / field verify keeps demo visible. Do not invent a demo charge on a new slab.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Embossed existing vinyl often needs a skim coat. New construction hides this — there is no existing vinyl. If you cannot see it until demo, pick Field verify — do not invent a bag count here.'
 where key = 'vinyl_skim';

commit;
