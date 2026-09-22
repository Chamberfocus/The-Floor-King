-- Floor King — flooring knowledge engine, pass 46.
-- Run in the Supabase SQL editor AFTER 0190–0234. Idempotent — safe to re-run.
--
-- Picking a catalog SKU that forgot its unit does not plant sq ft. Carpet and
-- sheet vinyl still default to sq yd; boxed hard surface still defaults to
-- sq ft. Adhesive / trim / pad / other stay unit TBD until a real unit is
-- known — taped square feet is not a glue order.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0235_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Adhesive product. Quantity is gallons or kits from the catalog unit — never the room''s taped square feet. A SKU that forgot its unit is TBD; we do not plant sq ft on a pail of glue.'
 where key = 'adhesive';

commit;
