-- Floor King CRM — separate the two customer-copy switches:
--   • presentation ("detailed" = itemized price-per-line / "summary" = lump sum)
--   • show_project_details (whether the captured questionnaire answers appear)
-- Run in Supabase: SQL Editor -> paste -> Run. Idempotent.
alter table public.estimates
  add column if not exists show_project_details boolean not null default true;
