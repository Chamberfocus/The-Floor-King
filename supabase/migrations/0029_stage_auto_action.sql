-- Floor King CRM — Phase 25: stage auto-actions (pop the right scheduler)
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.
-- 'none' | 'schedule_estimate' | 'schedule_install'

alter table public.workflow_stages
  add column if not exists auto_action text not null default 'none';
