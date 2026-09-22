-- Floor King — flooring knowledge engine, pass 83.
-- Run in the Supabase SQL editor AFTER 0190–0271. Idempotent — safe to re-run.
--
-- Exclusive hardwood nail/staple/floating over plywood still asked the slab
-- moisture test and Aqua bar. 0190: moisture test is glue-down or wood over
-- concrete — not a wood deck and not floating click. Hide moisture_test and
-- moisture_mitigation once every substrate pick is Plywood / OSB / Wood and
-- the job is exclusive hardwood that is not glue-down. Glue-down over plywood
-- still asks. Mixed LVP still asks. A moisture-concern flag still asks.
-- Unanswered substrate and unanswered method stay open.
-- Do NOT SQL-gate moisture_test on substrate (0142 — unanswered substrate and mixed LVP + hardwood must still ask a slab moisture test).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0272_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood over concrete, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — 0190 is glue-down or wood over concrete, not a wood deck. Glue-down over plywood still asks. Mixed LVP still asks. Unanswered substrate stays open. Wet area still asks.'
 where key = 'moisture_test'
    or id = '9400b1d6-9e58-45f8-929d-57dc35dff3be';

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system; glue-down over wood still asks. Mixed LVP still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation'
    or id = '2fc7799c-030c-4276-b6fa-801cb9867082';

commit;
