-- Floor King CRM — Phase 3b: Job photos & customer signature
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.
-- NOTE: the 'job-files' storage bucket must exist (created via API/dashboard).

do $$ begin
  if not exists (select 1 from pg_type where typname = 'job_file_kind') then
    create type public.job_file_kind as enum ('photo', 'signature');
  end if;
end $$;

create table if not exists public.job_files (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  path        text not null,
  kind        public.job_file_kind not null default 'photo',
  caption     text,
  signer_name text,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists job_files_job_idx
  on public.job_files (job_id, created_at desc);

alter table public.job_files enable row level security;

-- Staff, or the crew member assigned to the job.
drop policy if exists job_files_access on public.job_files;
create policy job_files_access on public.job_files
  for all to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.jobs j
      where j.id = job_files.job_id and j.assigned_to = auth.uid()
    )
  )
  with check (
    public.is_staff()
    or exists (
      select 1 from public.jobs j
      where j.id = job_files.job_id and j.assigned_to = auth.uid()
    )
  );

grant select, insert, update, delete on public.job_files to authenticated;

-- Storage access for the 'job-files' bucket: staff + crew may read/write.
drop policy if exists "job_files_storage_rw" on storage.objects;
create policy "job_files_storage_rw" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'job-files'
    and public.user_role(auth.uid()) in ('admin', 'office', 'crew')
  )
  with check (
    bucket_id = 'job-files'
    and public.user_role(auth.uid()) in ('admin', 'office', 'crew')
  );
