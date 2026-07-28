-- Price-to-a-total lands on the exact number, then loses it on save. The
-- solver scales every line's rate to 6 decimals so the subtotal hits the typed
-- total, but estimate_line_items rate columns were numeric(12,2) — so each rate
-- truncated to cents on insert and the subtotal drifted (e.g. a $1,971.42 quote
-- saved as $1,971.19). Widen the rate columns to match invoice_items (0132) so
-- the solved rates survive and estimate → invoice stays penny-exact.
alter table public.estimate_line_items
  alter column material_rate type numeric(16, 6);
alter table public.estimate_line_items
  alter column labor_rate type numeric(16, 6);
alter table public.estimate_line_items
  alter column installed_rate type numeric(16, 6);
alter table public.estimate_line_items
  alter column flat_amount type numeric(16, 6);
