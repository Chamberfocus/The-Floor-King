-- Floor King — flooring knowledge engine, pass 80.
-- Run in the Supabase SQL editor AFTER 0190–0268. Idempotent — safe to re-run.
--
-- Glue-down, carpet tile, nail-down, and stretch-in still offered
-- "Included with underlayment" on the vapor-barrier question. That chip
-- is a floating-floor 6-mil sheet — you cannot glue to it. Aqua bar /
-- primer stays on moisture mitigation. Floating and unanswered LVP /
-- engineered still offer the chip. Exclusive solid hardwood hides it
-- even before a method is picked. Do NOT SQL-gate vapor_barrier options on install_method (0142 — unanswered LVP must still offer Included with underlayment).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0269_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Aqua bar stays on moisture mitigation. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

commit;
