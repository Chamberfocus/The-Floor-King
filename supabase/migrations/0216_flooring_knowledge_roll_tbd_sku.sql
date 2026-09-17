-- Floor King — flooring knowledge engine, pass 27.
-- Run in the Supabase SQL editor AFTER 0190–0215. Idempotent — safe to re-run.
--
-- Roll-goods SKU without cuts: Builder still receives the product identity
-- with order TBD. Do not drop the pick, do not invent sq ft ÷ 9, and do not
-- invent a 12-foot (or 6-foot) warehouse cut from room dimensions.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0216_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll — converting room square feet into yards is not a cut plan. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile hides this list and orders from measured area.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. Each piece needs a length AND a roll width (catalog width or a 6''/12'' chip). An empty width is not a 6-foot roll. Converting room square feet into yards is not a layout. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered.'
 where key = 'vinyl_layout'
    or (kind = 'cuts' and config->>'category' = 'vinyl');

commit;
