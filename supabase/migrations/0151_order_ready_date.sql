-- Floor King — telling a customer WHEN their order will be ready
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- The order flow already works up to the decision: the customer submits, the
-- warehouse sees it under "Stock checks" with the on-hand count beside each
-- item, reports in stock / partial / out with a note, and that emails the owner.
--
-- Then it stops being useful. Approving sends the customer "Your order is
-- approved and headed to our warehouse to be cut. We'll reach out with pricing
-- and let you know as soon as it's ready" — the same words whether the material
-- is on the shelf or has to be ordered from the mill. The one thing the customer
-- actually wants to know, and the one thing the shop already knows by that
-- point, isn't in it.
--
-- So an approved order carries a date and which kind of date it is.

alter table public.orders
  -- When they can collect it. For stock this is a cutting turnaround; for
  -- material we have to order it's the mill lead time plus cutting.
  add column if not exists ready_date date,
  -- Whether that date means "we have it" or "we're ordering it". Kept separate
  -- from stock_status because stock_status is the WAREHOUSE's answer about the
  -- shelf, and this is the OWNER's decision about what to promise — they can
  -- differ (partial stock, still promised as one pickup).
  add column if not exists ready_kind text
    check (ready_kind in ('from_stock', 'on_order'));

comment on column public.orders.ready_date is
  'Promised pickup date, sent to the customer on approval.';
comment on column public.orders.ready_kind is
  'from_stock = cutting what we have; on_order = waiting on the supplier. '
  'Decides which message the customer gets, and is the owner''s call rather '
  'than the warehouse''s stock_status.';

create index if not exists orders_ready_date_idx on public.orders (ready_date)
  where ready_date is not null;
