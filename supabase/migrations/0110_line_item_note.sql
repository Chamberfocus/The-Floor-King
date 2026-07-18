-- Floor King CRM — per-line "Description" note. A plain-language note describing
-- what we're doing on a line, shown on the customer estimate scope and carried
-- to the work order. Separate from `description` (the product/line name).
-- Run in Supabase: SQL Editor -> paste -> Run. Idempotent.
alter table public.estimate_line_items
  add column if not exists note text;
