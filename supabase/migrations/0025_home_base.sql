-- Floor King CRM — Phase 21: salesperson home base (route origin)
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

alter table public.profiles add column if not exists home_address text;
