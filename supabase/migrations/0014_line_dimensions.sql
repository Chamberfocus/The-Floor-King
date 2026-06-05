-- Floor King CRM — Phase 10: line dimensions + measure unit (carpet sq yd)
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

alter table public.estimate_line_items
  add column if not exists length_in numeric(12, 2);
alter table public.estimate_line_items
  add column if not exists width_in numeric(12, 2);
-- how the line is priced/measured: 'sqft' or 'sqyd'
alter table public.estimate_line_items
  add column if not exists measure_unit text not null default 'sqft';
