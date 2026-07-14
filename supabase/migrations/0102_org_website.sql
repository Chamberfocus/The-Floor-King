-- Floor King CRM — add a website to the company identity, for document letterheads.
-- Run in Supabase: SQL Editor -> paste -> Run. Safe to re-run.

alter table public.org_settings
  add column if not exists website text;

notify pgrst, 'reload schema';
