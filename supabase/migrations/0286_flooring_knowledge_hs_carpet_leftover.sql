-- Floor King — flooring knowledge engine, pass 97.
-- Run in the Supabase SQL editor AFTER 0190–0285. Idempotent — safe to re-run.
--
-- Leftover Carpet install (Glue-down / Carpet tile / Stretch-in) on exclusive
-- hard surface still unioned carpet systems, so overlay asked adhesive,
-- moisture test, and acclimation on a floating LVP job. That leftover chip
-- does not switch adhesive, moisture test, or acclimation — it is not a
-- mixed job. Ignore leftover Carpet install when Carpet is not in play —
-- same as leftover Floating on exclusive carpet (0274). Mixed Carpet + LVP
-- still unions Carpet install. Unanswered carpet stays open. Assigned
-- carpet products still add the family.
-- Do NOT SQL-gate adhesive on carpet_install (0142 — mixed Carpet + LVP leftover Glue-down must still ask adhesive).
-- Do NOT SQL-gate carpet_install on surface_type (0142 — mixed leftover Stretch-in must still ask Carpet install).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0286_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Leftover Hardwood on Surface type does not reopen finish, fasteners, or vapor. Leftover Glue-down / Carpet tile on exclusive LVP is a carpet chip — it does not open adhesive, moisture test, or acclimation. Mixed Carpet + LVP still unions Carpet install. Do not invent a box size.'
 where key = 'carpet_install';

commit;
