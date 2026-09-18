-- Floor King — flooring knowledge engine, pass 108.
-- Run in the Supabase SQL editor AFTER 0190–0296. Idempotent — safe to re-run.
--
-- 6-mil click-floor vapor is a floating / glue sheet. Exclusive loose-lay
-- still asked for it over concrete. Loose-lay is not a click-floor sheet
-- and not glue-down — hide vapor_barrier once the only system is loose-lay,
-- including over concrete. Mixed floating + loose-lay stays open. Mixed
-- Carpet + LVP loose-lay stays open so stretch / glue over concrete still
-- asks. Leftover Loose-lay on exclusive carpet still asks over concrete.
-- Leftover Loose-lay on laminate coalesces to floating and still asks over
-- concrete. Unanswered LVP stays open.
-- Do NOT SQL-gate vapor_barrier on install_method (0142 — mixed floating + loose-lay must still ask 6-mil).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0297_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive plywood also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not a wood-deck underlayment. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Exclusive existing flooring also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not an existing-floor underlayment. Exclusive loose-lay hides this — loose-lay is not a click-floor 6-mil sheet, including over concrete. Mixed floating + loose-lay still asks. Mixed Carpet + LVP loose-lay still asks. Leftover Loose-lay on exclusive carpet still asks over concrete. Leftover Loose-lay on laminate coalesces to floating and still asks over concrete. Unanswered LVP stays open. Glue over concrete still asks. Floating over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

commit;
