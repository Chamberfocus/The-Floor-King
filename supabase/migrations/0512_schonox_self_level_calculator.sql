-- Floor King — Schönox self-leveler and primer on the guided estimate.
-- Run in the Supabase SQL editor. Idempotent.
--
-- Yes on this question opens the Schönox calculator already in the app.
-- The bag and primer counts use the published formula. This file only
-- renames the question so the guided step says what it does.
--
-- Does NOT write product prices. Does NOT enable accounting.

begin;

update public.estimate_questions
   set label = 'Schönox self-leveling and primer?',
       help = 'Yes opens the Schönox calculator for the leveler and the primer. Pick the product and the pour on the next step. Field verify does not add a count.'
 where key = 'selflevel_needed';

update public.estimate_questions
   set label = 'Schönox self-leveler and primer',
       help = 'Pick the Schönox leveler, the pour thickness, and the primer. Counts match the Schönox calculator.'
 where kind = 'selflevel';

commit;
