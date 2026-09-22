-- Floor King — flooring knowledge engine, pass 110.
-- Run in the Supabase SQL editor AFTER 0190–0298. Idempotent — safe to re-run.
--
-- Leftover illegal install chips were switching overlay follow-ups. Exclusive
-- solid hardwood leftover Floating hid fasteners and adhesive that unanswered
-- solid still asks. Exclusive LVP leftover Nail hid pad / expansion.
-- Exclusive engineered leftover Loose-lay hid both branches. leftover illegal chips do not switch
-- overlay follow-ups on an exclusive single hard-surface family. Mixed LVP +
-- hardwood keeps every chip. Laminate leftover Glue still coalesces to floating.
-- Do NOT SQL-gate hardwood_fasteners on install_method (0142 — mixed LVP + hardwood Nail-down must still ask fasteners).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0299_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Nail/staple jobs need fasteners. Pick the catalog item in Builder — this question only records the need. Leftover Floating on exclusive solid hardwood does not hide this — leftover illegal chips do not switch overlay follow-ups. Mixed LVP + hardwood still asks when Nail-down is in play.'
 where key = 'hardwood_fasteners';

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, or thinset — pick every hard-surface method in play. Exclusive carpet hides this hard-surface method picker. Stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Floating / Glue-down chips do not reopen it on a carpet-only job. Leftover Floating on exclusive solid hardwood does not hide fasteners or adhesive — leftover illegal chips do not switch overlay follow-ups.'
 where key = 'install_method';

commit;
