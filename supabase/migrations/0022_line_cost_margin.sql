-- Floor King CRM — Phase 18: per-line cost, quantity & margin
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.
-- Adds OUR cost (material + labor) and an explicit quantity/unit to every
-- estimate line, so the wizard can show cost, price, margin & profit side by
-- side, and so post-job actual-vs-estimate can be measured.

alter table public.estimate_line_items
  add column if not exists material_cost numeric(12, 2),
  add column if not exists labor_cost    numeric(12, 2),
  add column if not exists quantity      numeric(12, 2),
  add column if not exists unit          text;
