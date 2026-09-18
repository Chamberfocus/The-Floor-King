-- Floor King — flooring knowledge engine, pass 109.
-- Run in the Supabase SQL editor AFTER 0190–0297. Idempotent — safe to re-run.
--
-- Existing-vinyl skim is for embossed vinyl, not every sheet-vinyl job.
-- Exclusive carpet / LVP / hardwood / ceramic / luan tear-out still asked
-- it. Hide vinyl_skim once every demo pick names a non-vinyl floor. None
-- stays open — encapsulating existing vinyl has no tear-out chip. Other /
-- Unknown stay open. Sheet vinyl demo still asks. Mixed Carpet + Sheet
-- vinyl stays open. Unanswered stays open. New construction already hides.
-- Do NOT SQL-gate vinyl_skim on hs_demo (0142 — unanswered and mixed Carpet + Sheet vinyl must still ask skim).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0298_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Embossed existing vinyl often needs a skim coat. New construction hides this — there is no existing vinyl. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out also hides this — that demo is not existing vinyl. None still asks — encapsulating existing vinyl has no tear-out chip. Other / Unknown stay open. Sheet vinyl demo still asks. Mixed Carpet + Sheet vinyl still asks. Unanswered stays open. If you cannot see it until demo, pick Field verify — do not invent a bag count here.'
 where key = 'vinyl_skim';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

commit;
