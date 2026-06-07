-- Background import jobs: lets a price list parse + import on the server so the
-- user can keep working (and even close the tab) while it runs.

create table if not exists public.import_jobs (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default 'price_list',   -- future: 'clients'
  label            text,                                  -- file name / source
  status           text not null default 'queued',        -- queued|processing|done|error
  total_chunks     int  not null default 0,
  processed_chunks int  not null default 0,
  imported_count   int  not null default 0,
  storage_path     text,                                  -- for image/scanned docs
  storage_mime     text,
  chunks           jsonb not null default '[]'::jsonb,    -- text chunks to parse
  error            text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists import_jobs_status_idx on public.import_jobs (status);
create index if not exists import_jobs_created_idx on public.import_jobs (created_at desc);

alter table public.import_jobs enable row level security;

-- Staff can see and create import jobs; processing runs via the service role
-- (which bypasses RLS), so no extra update policy is needed for the worker.
drop policy if exists import_jobs_select on public.import_jobs;
create policy import_jobs_select on public.import_jobs
  for select using (public.is_staff());

drop policy if exists import_jobs_insert on public.import_jobs;
create policy import_jobs_insert on public.import_jobs
  for insert with check (public.is_staff());

drop policy if exists import_jobs_update on public.import_jobs;
create policy import_jobs_update on public.import_jobs
  for update using (public.is_staff()) with check (public.is_staff());

drop policy if exists import_jobs_delete on public.import_jobs;
create policy import_jobs_delete on public.import_jobs
  for delete using (public.is_staff());
