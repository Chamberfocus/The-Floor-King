-- Floor King — flooring knowledge engine, pass 94.
-- Run in the Supabase SQL editor AFTER 0190–0282. Idempotent — safe to re-run.
--
-- Exclusive carpet still listed the hard-surface Install method picker on
-- overlay walks. Stretch-in / glue-down / carpet tile stay on Carpet install.
-- Hide install_method once the job is carpet-only. Mixed Carpet + LVP still
-- asks. Unanswered hard surface stays open. Leftover Floating / Glue-down
-- chips do not reopen it.
-- Do NOT SQL-gate install_method on carpet_install (0142 — mixed Carpet + LVP leftover Floating must still ask hard-surface method).
-- Do NOT SQL-gate install_method on surface_type (0142 — unanswered HS must still ask install method).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0283_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, or thinset — pick every hard-surface method in play. Exclusive carpet hides this hard-surface method picker. Stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Floating / Glue-down chips do not reopen it on a carpet-only job.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

commit;
