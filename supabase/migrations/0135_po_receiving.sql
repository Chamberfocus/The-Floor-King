-- Floor King — warehouse receiving, line by line
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Receiving a PO was a single status flip on the whole order, done from the
-- office. Nobody recorded WHAT actually turned up, so a short shipment or the
-- wrong colour only surfaced when the installer opened the box on site.
--
-- These columns let the warehouse check the delivery against the order and say
-- what arrived — including "3 of the 5 boxes" or "wrong colour, sending back".

alter table public.po_items
  add column if not exists received_qty numeric(12,2),
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references public.profiles (id) on delete set null,
  add column if not exists receiving_note text;

comment on column public.po_items.received_qty is
  'What the warehouse actually counted in. NULL = not yet checked; 0 = checked '
  'and nothing arrived. The difference matters, so it is nullable rather than '
  'defaulting to zero.';
comment on column public.po_items.receiving_note is
  'Why the count differs from the order — short shipment, wrong colour, damage.';

create index if not exists po_items_unreceived_idx
  on public.po_items (po_id) where received_at is null;

-- When the delivery was checked in, and by whom, at the order level.
alter table public.purchase_orders
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references public.profiles (id) on delete set null,
  add column if not exists receiving_note text;

/**
 * What is still outstanding on a PO — the view the warehouse and the office
 * both read, so "did it all come in?" has one answer.
 *
 * security_invoker so the underlying row-level rules still apply.
 */
create or replace view public.po_receiving_status
with (security_invoker = true) as
select
  p.id                                        as po_id,
  count(i.id)::int                            as line_count,
  count(i.id) filter (where i.received_at is not null)::int as checked_count,
  coalesce(sum(i.quantity), 0)                as ordered_qty,
  coalesce(sum(i.received_qty), 0)            as received_qty,
  -- Short by this much across the order. Negative means MORE arrived than was
  -- ordered, which is worth seeing too.
  coalesce(sum(i.quantity), 0) - coalesce(sum(i.received_qty), 0) as outstanding_qty,
  count(i.id) filter (
    where i.received_at is not null
      and coalesce(i.received_qty, 0) <> coalesce(i.quantity, 0)
  )::int                                      as discrepancy_count,
  bool_and(i.received_at is not null)         as fully_checked
from public.purchase_orders p
left join public.po_items i on i.po_id = p.id
group by p.id;

grant select on public.po_receiving_status to authenticated;
