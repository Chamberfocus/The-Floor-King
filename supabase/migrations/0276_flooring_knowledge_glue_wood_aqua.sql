-- Floor King — flooring knowledge engine, pass 87.
-- Run in the Supabase SQL editor AFTER 0190–0275. Idempotent — safe to re-run.
--
-- Exclusive glue-down / carpet tile over plywood still asked Aqua bar.
-- Aqua bar is a slab coating — not a wood-deck primer. Hide
-- moisture_mitigation once every substrate pick is Plywood / OSB / Wood
-- and the job is glue-down or carpet tile. Moisture test still asks
-- (wood moisture content). Glue over concrete still asks. Mixed plywood
-- + concrete still asks. A moisture-concern flag still asks. Unanswered
-- substrate and unanswered method stay open.
-- Do NOT SQL-gate moisture_mitigation on substrate (0142 — unanswered substrate and mixed plywood + concrete must still ask Aqua bar).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0276_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier except exclusive carpet tile over plywood — Aqua bar is a slab system. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system. Exclusive glue-down or carpet tile over plywood also hides this. Moisture test still asks. Glue over concrete still asks. Mixed plywood + concrete still asks. A moisture-concern flag still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation'
    or id = '2fc7799c-030c-4276-b6fa-801cb9867082';

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood over concrete, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — 0190 is glue-down or wood over concrete, not a wood deck. Glue-down over plywood still asks. Exclusive glue-down or carpet tile over plywood hides Aqua bar — it is a slab system. Mixed LVP still asks. Unanswered substrate stays open. Wet area still asks.'
 where key = 'moisture_test'
    or id = '9400b1d6-9e58-45f8-929d-57dc35dff3be';

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Glue over concrete still asks. Mixed floating still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

commit;
