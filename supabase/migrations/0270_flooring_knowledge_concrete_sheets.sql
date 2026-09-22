-- Floor King — flooring knowledge engine, pass 81.
-- Run in the Supabase SQL editor AFTER 0190–0269. Idempotent — safe to re-run.
--
-- Exclusive Concrete still asked for 4×8 plywood overlay sheets. A slab
-- is patch / self-level, not a wood-deck repair. Hide subfloor_needed
-- once every substrate pick is Concrete. Plywood / wood / existing
-- flooring / Unknown stay open. Unanswered stays open. Sit the question
-- after substrate so it does not appear behind the salesperson.
-- Do NOT SQL-gate subfloor_needed on substrate (0142 — unanswered substrate must still ask 4×8).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0270_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'If you cannot see the substrate until demo, pick Unknown / field verify rather than guessing plywood vs concrete. Exclusive Concrete hides 4×8 subfloor sheets — a slab is patch / self-level, not plywood overlay. Plywood / wood / existing flooring still ask.',
       position = 350
 where key = 'substrate';

update public.estimate_questions
   set help = 'Yes emits 4×8 sheets only when Settings has sheet_sqft. Missing coverage is TBD — we do not invent 32 sq ft per sheet. Field verify withholds the count. Exclusive Concrete hides this — a slab is not a plywood overlay. Plywood / wood / existing flooring / Unknown still ask. Self-level stays on Floor prep.',
       position = 355
 where key = 'subfloor_needed';

commit;
