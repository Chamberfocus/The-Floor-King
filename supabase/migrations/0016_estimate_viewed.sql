-- Floor King CRM — Phase 12: estimate open tracking
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

alter table public.estimates add column if not exists viewed_at timestamptz;
