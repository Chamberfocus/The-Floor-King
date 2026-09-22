-- Floor King — flooring knowledge engine, pass 86.
-- Run in the Supabase SQL editor AFTER 0190–0274. Idempotent — safe to re-run.
--
-- Exclusive glue-down over plywood still asked the 6-mil click-floor vapor
-- sheet. You cannot glue to 6-mil poly — Aqua bar stays on moisture
-- mitigation. Hide vapor_barrier once every substrate pick is Plywood /
-- OSB / Wood and the job is glue-down with no floating. Glue over concrete
-- still asks. Mixed floating + glue still asks. Unanswered substrate stays
-- open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed plywood + concrete must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0275_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly; Aqua bar stays on moisture mitigation. Glue over concrete still asks. Mixed floating still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

commit;
