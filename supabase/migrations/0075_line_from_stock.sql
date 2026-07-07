-- "Pull from stock" flag on estimate line items. Stock items still appear on the
-- estimate and work order, but are EXCLUDED from the Purchase Order (we already
-- have them — don't re-order). Especially useful for trim pieces.
alter table public.estimate_line_items
  add column if not exists from_stock boolean not null default false;
