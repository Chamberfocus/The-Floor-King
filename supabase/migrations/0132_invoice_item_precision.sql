-- Exact billing: invoice_items.rate/quantity were numeric(12,2), so the
-- "carry the precision in the rate" logic (rate = lineTotal / rounded qty) was
-- rounded back to cents on insert and the invoice could drift a few cents/dollars
-- from the approved estimate on large-area lines. Widen the scale so
-- quantity × rate reproduces the estimate's line total to the penny.
alter table public.invoice_items
  alter column rate type numeric(16, 6);
alter table public.invoice_items
  alter column quantity type numeric(16, 4);
