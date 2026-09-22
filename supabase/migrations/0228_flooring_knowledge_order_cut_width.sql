-- Floor King — flooring knowledge engine, pass 39.
-- Run in the Supabase SQL editor AFTER 0190–0227. Idempotent — safe to re-run.
--
-- Customer / portal orders: an empty cut width is not a 12' roll, and a
-- missing unit is not square yards. Warehouse cut labels stay TBD until a
-- real width is entered. Existing rows are not rewritten.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0228_FLOORING_KNOWLEDGE

begin;

alter table public.order_items
  alter column unit set default '';

comment on column public.order_items.unit is
  'Billing unit from the catalog or the customer. Empty is TBD — never invent sq yd.';

commit;
