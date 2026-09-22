-- Floor King — flooring knowledge engine, pass 106.
-- Run in the Supabase SQL editor AFTER 0190–0294. Idempotent — safe to re-run.
--
-- Aqua bar is a slab coating. Exclusive glue / carpet tile over existing
-- flooring already hid it (0290). Exclusive hardwood nail / staple /
-- floating over existing flooring still asked it. Hide moisture_mitigation
-- once every substrate pick is Existing flooring. Moisture test still
-- asks (unknown what's under). Mixed existing + concrete stays open. A
-- moisture-concern flag still asks. Unanswered substrate stays open.
-- Do NOT SQL-gate moisture_mitigation on substrate (0142 — mixed existing + concrete must still ask Aqua bar).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0295_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier except exclusive carpet tile over plywood — Aqua bar is a slab system. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system. Exclusive glue-down or carpet tile over plywood also hides this. Exclusive glue-down or carpet tile over existing flooring also hides this — Aqua bar is a slab coating, not an existing-floor primer. Exclusive hardwood nail/staple/floating over existing flooring also hides this. Moisture test still asks. Glue over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. A moisture-concern flag still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation';

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood over concrete, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — 0190 is glue-down or wood over concrete, not a wood deck. Glue-down over plywood still asks. Exclusive glue-down or carpet tile over plywood hides Aqua bar — it is a slab system. Exclusive hardwood nail/staple/floating over existing flooring also hides Aqua bar — it is a slab coating, not an existing-floor primer. Moisture test still asks. Mixed LVP still asks. Unanswered substrate stays open. Wet area still asks.'
 where key = 'moisture_test';

commit;
