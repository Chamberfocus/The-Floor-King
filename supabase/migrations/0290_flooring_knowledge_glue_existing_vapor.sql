-- Floor King — flooring knowledge engine, pass 101.
-- Run in the Supabase SQL editor AFTER 0190–0289. Idempotent — safe to re-run.
--
-- Exclusive glue-down over Existing flooring still asked the 6-mil click-floor
-- vapor sheet and Aqua bar. You glue to the existing floor or tear it out —
-- not to 6-mil poly. Aqua bar is a slab coating, not an existing-floor primer.
-- Hide vapor_barrier once every substrate pick is Existing flooring and the
-- job is glue-down with no floating. Hide moisture_mitigation once exclusive
-- glue-down or carpet tile is over Existing flooring. Moisture test still
-- asks (unknown what is under). Glue over concrete still asks both. Mixed
-- floating + glue still asks vapor. Mixed existing + concrete stays open.
-- A moisture-concern flag still asks Aqua bar. Unanswered substrate stays
-- open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed existing + concrete must still ask vapor barrier).
-- Do NOT SQL-gate moisture_mitigation on substrate (0142 — unanswered substrate and mixed existing + concrete must still ask Aqua bar).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0290_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Glue over concrete still asks. Mixed floating still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier except exclusive carpet tile over plywood — Aqua bar is a slab system. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system. Exclusive glue-down or carpet tile over plywood also hides this. Exclusive glue-down or carpet tile over existing flooring also hides this — Aqua bar is a slab coating, not an existing-floor primer. Moisture test still asks. Glue over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. A moisture-concern flag still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation';

commit;
