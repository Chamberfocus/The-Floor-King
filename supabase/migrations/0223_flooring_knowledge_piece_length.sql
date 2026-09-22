-- Floor King — flooring knowledge engine, pass 34.
-- Run in the Supabase SQL editor AFTER 0190–0222. Idempotent — safe to re-run.
--
-- Trim sold by the piece converts a measured run into sticks only when the
-- product actually has piece_length_in. Missing length stays TBD — we do not
-- invent a 94" stick the way we do not invent carton coverage.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0223_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Quarter round, shoe, and base are linear feet; stair noses, T-molds, and reducers are EACH — never square feet. Pick a catalog item or type a rate. Clicking a chip does not invent a price. Linear feet convert to sticks only when the product has a piece length — we do not invent 94". Extra carpet/sheet on another step stays order TBD until cuts exist.'
 where coalesce(config->>'trim_list', '') = 'true';

commit;
