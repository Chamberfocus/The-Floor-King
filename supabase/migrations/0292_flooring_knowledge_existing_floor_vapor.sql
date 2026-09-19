-- Floor King — flooring knowledge engine, pass 103.
-- Run in the Supabase SQL editor AFTER 0190–0291. Idempotent — safe to re-run.
--
-- Exclusive floating over Existing flooring still asked the 6-mil click-floor
-- vapor sheet. 6-mil is a slab sheet, not an existing-floor underlayment.
-- Hide vapor_barrier once every substrate pick is Existing flooring and the
-- install method is answered (or inferred). Exclusive floating, glue, and
-- mixed floating + glue over existing flooring all hide. Glue / floating
-- over concrete still ask. Mixed existing + concrete stays open.
-- Unanswered substrate and unanswered LVP method stay open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed existing + concrete must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0292_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive plywood also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not a wood-deck underlayment. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Exclusive existing flooring also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not an existing-floor underlayment. Glue over concrete still asks. Floating over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

commit;
