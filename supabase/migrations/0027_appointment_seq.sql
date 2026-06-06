-- Floor King CRM — Phase 23: manual route order for appointments
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

alter table public.appointments add column if not exists seq int not null default 0;
