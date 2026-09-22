-- Floor King — flooring knowledge engine, pass 29.
-- Run in the Supabase SQL editor AFTER 0190–0217. Idempotent — safe to re-run.
--
-- Floor-map room L×W is measured area. Exclusive carpet tile is modular:
-- stuffing a 12'×14' room onto length_in/width_in is not a warehouse cut.
-- Broadloom order still comes from the cuts step. Staging/PO cut lists skip
-- lines marked not-a-roll (order_as_roll = false) unless real cut pieces exist.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0218_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile hides this list and orders from measured area; floor-map room sizes stay measured, not cuts.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

commit;
