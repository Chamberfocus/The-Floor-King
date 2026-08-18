-- Floor King — when the customer needs it, and their measurements as MEASUREMENTS.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Two gaps in the client order form:
--
-- 1. Nobody is asked WHEN they need it. The office finds out by phoning back,
--    and the warehouse has no way to tell a Friday install from a browse.
--
-- 2. The form already collects cuts properly — 12' wide × 14'6" — and then
--    flattens them into one string ("12' × 14'6" | 12' × 10'"), which is read
--    back by splitting on a pipe. So the one part of the order the warehouse
--    has to work from is the part stored as prose.

alter table public.orders
  add column if not exists date_needed date;

comment on column public.orders.date_needed is
  'When the customer needs the material. Asked on the order form; drives the '
  'urgency shown to the office and the warehouse.';

-- Each cut as its own row of data: {"width_ft":12,"length_ft":14,"length_in":6}.
-- cut_notes is KEPT and still written, so orders submitted before this change
-- keep rendering, and anything reading the old string keeps working.
alter table public.order_items
  add column if not exists cuts jsonb;

comment on column public.order_items.cuts is
  'The cuts as structured rows, one object per cut. cut_notes holds the same '
  'thing as text for older orders and for anything that just wants a label.';

create index if not exists orders_date_needed_idx
  on public.orders (date_needed) where date_needed is not null;
