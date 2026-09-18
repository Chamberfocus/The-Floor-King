-- Floor King — flooring knowledge engine, pass 96.
-- Run in the Supabase SQL editor AFTER 0190–0284. Idempotent — safe to re-run.
--
-- Leftover Surface type (Hardwood / LVP / …) on exclusive carpet still
-- unioned hard-surface families, so overlay asked finish, fasteners, vapor,
-- and plank stairs. That leftover chip does not switch finish, fasteners, vapor,
-- or Install method — it is not a mixed job. Ignore it for overlay families
-- — same as leftover Floating on install_method (0274). Mixed Carpet + LVP
-- still unions Surface type. Unanswered hard surface stays open. Assigned
-- hardwood products still add the family. Unanswered project_type still
-- reads Surface type (0142).
-- Do NOT SQL-gate hardwood_finish on project_type (0142 — mixed Carpet + hardwood must still ask finish).
-- Do NOT SQL-gate surface_type on carpet_install (0142 — mixed leftover Hardwood must still ask surface type).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0285_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'LVP, hardwood, laminate, tile, or sheet vinyl. Exclusive carpet hides this — stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Hardwood chips do not reopen finish, fasteners, vapor, or Install method on a carpet-only job.'
 where key = 'surface_type';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Leftover Hardwood on Surface type does not reopen finish, fasteners, or vapor. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

commit;
