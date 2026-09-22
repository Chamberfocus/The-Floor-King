-- Floor King — flooring knowledge engine, pass 112.
-- Run in the Supabase SQL editor AFTER 0190–0300. Idempotent — safe to re-run.
--
-- Existing pad and tack follow OLD carpet. Installing new carpet still asked
-- them once leftover families carpet kept the overlay open, even after demo
-- was exclusive LVP / hardwood / ceramic / luan / sheet vinyl. Hide
-- existing_pad and existing_tack once every demo pick is non-carpet. Carpet
-- demo still asks. Mixed Carpet + LVP still asks. None / Other / Unknown
-- stay open. Unanswered stays open.
-- Do NOT SQL-gate existing_pad on hs_demo (0142 — unanswered carpet and mixed Carpet + LVP demo must still ask pad).
-- Do NOT SQL-gate existing_tack on hs_demo (0142 — unanswered carpet and mixed Carpet + LVP demo must still ask tack).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0301_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Tearing out carpet — to carpet or to hard surface — usually takes the pad with it. Reuse only when the salesperson explicitly allows it. This follows the existing floor, not only a new-carpet job. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides this — that demo is not old carpet. None / Other / Unknown stay open. Mixed Carpet + LVP still asks. Unanswered stays open. Do not invent a second demo rate; the tear-out line gets a pad note.'
 where key = 'existing_pad';

update public.estimate_questions
   set help = 'Tearing out carpet usually takes tack strip with it. Keep is unusual. This is not new stretch-in tack strip — that stays on the install step. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides this with existing pad — that demo is not old carpet. None / Other / Unknown stay open. Mixed Carpet + LVP still asks. Unanswered stays open. Linear feet stay off until you add a catalog item. Do not invent a linear-foot price.'
 where key = 'existing_tack';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

commit;
