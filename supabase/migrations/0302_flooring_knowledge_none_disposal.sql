-- Floor King — flooring knowledge engine, pass 113.
-- Run in the Supabase SQL editor AFTER 0190–0301. Idempotent — safe to re-run.
--
-- Haul-away / dumpster / curb and bulk pickup still asked after demo was
-- exclusive None. Nothing is coming up, so there is nothing to dispose.
-- Hide demo_disposal and bulk_pickup once every demo pick is None. Carpet /
-- LVP / ceramic demo still asks. Mixed None + Carpet stays open. Other /
-- Unknown stay open. Unanswered stays open.
-- Do NOT SQL-gate demo_disposal on hs_demo (0142 — unanswered demo and Carpet demo must still ask disposal).
-- Do NOT SQL-gate bulk_pickup on hs_demo (0142 — unanswered disposal and Placed at curb must still ask bulk pickup).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0302_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Haul away, dumpster, or placed at curb. Placed at curb opens bulk pickup day. Leftover Placed-on-the-curb yes-no stays off the overlay — demo_disposal is the source of truth. New construction hides this. Exclusive None demo hides this — nothing is coming up, so there is nothing to haul. Other / Unknown still ask. Unanswered stays open. Do not invent a dumpster fee.'
 where key = 'demo_disposal';

update public.estimate_questions
   set help = 'Municipal bulk pickup day so the old floor is at the curb on time. New construction hides this. Haul-away / dumpster hides this. Exclusive None demo hides this with haul-away — nothing is coming up. Unanswered disposal stays open in overlay. Leftover Placed-on-the-curb yes-no is not this question — Placed at curb on demo_disposal is. Do not invent a disposal charge here.'
 where key = 'bulk_pickup';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

commit;
