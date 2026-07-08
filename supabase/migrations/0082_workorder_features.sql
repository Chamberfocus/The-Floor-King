-- Floor King CRM — work order features: price toggle, per-job balance collection,
-- installer photos, customer satisfaction form. Run in Supabase: paste -> Run.
-- Idempotent.

-- Per-job flags.
alter table public.jobs
  add column if not exists show_prices boolean not null default false;
alter table public.jobs
  add column if not exists installer_collects_balance boolean; -- null = inherit global

-- Attach completed-job photos (documents) to a specific job.
alter table public.documents
  add column if not exists job_id uuid references public.jobs (id) on delete set null;
create index if not exists documents_job_idx on public.documents (job_id);

-- Customer satisfaction sign-off, linked to the work order.
create table if not exists public.job_satisfaction (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  rating      int,                -- 1..5 overall
  comments    text,
  signature   text,               -- data-URL of the signature
  signed_name text,
  signed_at   timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists job_satisfaction_job_idx on public.job_satisfaction (job_id);

alter table public.job_satisfaction enable row level security;
drop policy if exists js_read on public.job_satisfaction;
create policy js_read on public.job_satisfaction for select to authenticated using (true);
drop policy if exists js_staff on public.job_satisfaction;
create policy js_staff on public.job_satisfaction
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.job_satisfaction to authenticated;
