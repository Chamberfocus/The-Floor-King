-- Floor King — flooring knowledge engine, pass 40.
-- Run in the Supabase SQL editor AFTER 0190–0228. Idempotent — safe to re-run.
--
-- Tile setting materials are catalog bags, not taped square feet. Thinset /
-- grout stay TBD until a product with coverage is picked. Customer order
-- catalog rows keep their real unit — missing unit is empty, not sq yd.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0229_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Thinset, grout, and backer come from the catalog in Builder. This records the need. Bag counts stay TBD unless a product with coverage is picked. Taped square feet is not bags of thinset.'
 where key = 'tile_setting';

commit;
