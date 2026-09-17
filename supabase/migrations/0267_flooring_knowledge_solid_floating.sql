-- Floor King — flooring knowledge engine, pass 78.
-- Run in the Supabase SQL editor AFTER 0190–0266. Idempotent — safe to re-run.
--
-- Solid hardwood is typically nail, staple, or glue — not a click floor.
-- Unanswered install method still asked attached pad / underlayment /
-- expansion because those gates stay open until a method is picked.
-- Hide them once the surface is exclusive solid hardwood. Engineered and
-- mixed Hardwood + Engineered stay open. Unanswered HS stays open.
-- Do NOT SQL-gate attached_pad on surface_type (0142 — unanswered HS must still ask attached pad for LVP / laminate).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0267_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, and thinset ask different follow-ups. Solid hardwood hides attached pad, underlayment, and expansion — floating is not a permitted system. Pick the system this product actually uses. Do not invent a per-room editor.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Floating LVP / laminate / engineered may have an attached pad. Solid hardwood hides this — floating is not a permitted system. Glue-down hides this. Yes hides separate underlayment.'
 where key = 'attached_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Do not invent a roll count.'
 where key = 'hs_underlayment';

update public.estimate_questions
   set help = 'Floating floors need expansion at walls and transitions. Solid hardwood hides this — floating is not a permitted system. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.'
 where key = 'laminate_expansion';

commit;
