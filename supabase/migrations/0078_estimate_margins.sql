-- Floor King CRM — estimate profit margins (overall + per-line override).
-- Run in Supabase: SQL Editor -> paste -> Run. Safe to re-run (idempotent).
-- target_margin: the estimate's overall gross-margin default (percent).
-- margin_pct: a per-line override (percent). NULL = the line follows the overall.
-- Sell rates are still stored in material_rate/labor_rate, so the PO, work
-- order, invoice, and print are unaffected — these just record the margins used.

alter table public.estimates
  add column if not exists target_margin numeric;

alter table public.estimate_line_items
  add column if not exists margin_pct numeric;
