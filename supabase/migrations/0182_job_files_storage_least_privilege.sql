-- P0: job-files storage least privilege.
-- Root: job_files_storage_rw (0008) grants role crew ALL on the entire
-- job-files bucket (list/read/upload/overwrite/delete) with no job/path check.
-- public.job_files RLS is already narrower (staff + assigned_to write;
-- 0180 linked-crew SELECT only). Storage must not be broader than that.
--
-- Architecture: drop the broad FOR ALL policy. Parse job_id from the first
-- path segment (`{job_uuid}/...`, the only app convention). Authorize against
-- the same business rules as public.job_files — via SECURITY DEFINER so
-- jobs_crew_read's open_for_claim does NOT leak unclaimed-job files to every
-- installer. Direct JWT SELECT remains so listJobFiles can mint 1h signed
-- URLs after the caller is allowed to see that job. Crew INSERT only when
-- assigned_to. Crew UPDATE/DELETE removed. 0179 documents_storage_rw is
-- untouched.
--
-- Safe to re-run. DOES NOT apply accounting activation.
-- Do NOT set posting_enabled
-- DO NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.
-- OWNER applies manually. Agent must NOT apply to production.

-- ---------------------------------------------------------------------------
-- 0) Accounting safety precheck — refuse if flags flipped; never activate here.
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  if to_regclass('public.accounting_settings') is null then
    raise exception 'P0_0182_PRECHECK: accounting_settings missing — apply 0161–0181 first.';
  end if;
  select * into s from public.accounting_settings where id = 1;
  if not found then
    raise exception 'P0_0182_PRECHECK: accounting_settings row id=1 missing.';
  end if;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.inventory_posting_enabled, false)
     or coalesce(s.ap_posting_enabled, false)
     or coalesce(s.installer_posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or coalesce(s.opening_balances_entered, false)
     or coalesce(s.accountant_validated, false)
     or s.cutover_date is not null then
    raise exception
      'P0_0182_PRECHECK: accounting activation flags are not in the required OFF/NULL state. Aborting (no mutation of flags).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Path → job_id. App writes `{job_id}/signature-{ts}.png`. Reject anything
--    that is not a UUID first folder. INVOKER / immutable — no table access.
-- ---------------------------------------------------------------------------
create or replace function public.job_files_storage_job_id(object_name text)
returns uuid
language sql
immutable
strict
set search_path = public
as $$
  select case
    when object_name is null then null
    when position('/' in object_name) < 2 then null
    when position('..' in object_name) > 0 then null
    when split_part(object_name, '/', 1) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then null
    else split_part(object_name, '/', 1)::uuid
  end;
$$;

revoke all on function public.job_files_storage_job_id(text) from public, anon;
grant execute on function public.job_files_storage_job_id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Read auth. DEFINER + auth.uid() so we do not inherit jobs SELECT extras
--    (open_for_claim board). Matches job_files_access + job_files_sales_read
--    + job_files_linked_crew_read. Warehouse / customer / unlinked → false.
--    Does not accept an arbitrary job id without tying it to the caller.
-- ---------------------------------------------------------------------------
create or replace function public.can_read_job_files_object(job_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    where job_uuid is not null
      and j.id = job_uuid
      and (
        public.is_staff()
        or public.user_role(auth.uid())::text in ('sales_manager', 'scheduler')
        or (
          public.user_role(auth.uid())::text = 'salesman'
          and public.mine_job(job_uuid)
        )
        or j.assigned_to = auth.uid()
        or j.assigned_crew_id in (
          select c.id
          from public.install_crews c
          where c.profile_id = auth.uid()
            and c.active = true
        )
      )
  );
$$;

revoke all on function public.can_read_job_files_object(uuid) from public, anon;
grant execute on function public.can_read_job_files_object(uuid) to authenticated;

-- Write auth: staff OR direct assigned_to. Linked crew has no generic write
-- (0180). Warehouse / customer / salesman / scheduler → false.
create or replace function public.can_write_job_files_object(job_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    where job_uuid is not null
      and j.id = job_uuid
      and (
        public.is_staff()
        or j.assigned_to = auth.uid()
      )
  );
$$;

revoke all on function public.can_write_job_files_object(uuid) from public, anon;
grant execute on function public.can_write_job_files_object(uuid) to authenticated;

-- 0179 documents_storage_rw is untouched. Do not drop or recreate it here.
-- ---------------------------------------------------------------------------
-- 3) Replace the broad FOR ALL policy. Permissive policies OR together — the
--    old policy MUST be dropped or crew still has the whole bucket.
-- ---------------------------------------------------------------------------
drop policy if exists "job_files_storage_rw" on storage.objects;
drop policy if exists job_files_storage_rw on storage.objects;
drop policy if exists job_files_storage_select on storage.objects;
drop policy if exists job_files_storage_insert on storage.objects;
drop policy if exists job_files_storage_update on storage.objects;
drop policy if exists job_files_storage_delete on storage.objects;

create policy job_files_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-files'
    and public.can_read_job_files_object(public.job_files_storage_job_id(name))
  );

create policy job_files_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-files'
    and public.can_write_job_files_object(public.job_files_storage_job_id(name))
  );

-- Staff only. WITH CHECK also requires a writable job path so a rename cannot
-- move an object into another job's namespace without staff write rights
-- (staff already have write on every real job).
create policy job_files_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'job-files'
    and public.is_staff()
    and public.can_write_job_files_object(public.job_files_storage_job_id(name))
  )
  with check (
    bucket_id = 'job-files'
    and public.is_staff()
    and public.can_write_job_files_object(public.job_files_storage_job_id(name))
  );

create policy job_files_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'job-files'
    and public.is_staff()
    and public.can_write_job_files_object(public.job_files_storage_job_id(name))
  );

-- ---------------------------------------------------------------------------
-- 4) Accounting safety postcheck — still OFF (no flag writes)
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  select * into s from public.accounting_settings where id = 1;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.inventory_posting_enabled, false)
     or coalesce(s.ap_posting_enabled, false)
     or coalesce(s.installer_posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or coalesce(s.opening_balances_entered, false)
     or coalesce(s.accountant_validated, false)
     or s.cutover_date is not null then
    raise exception 'P0_0182_POSTCHECK: accounting flags must remain OFF/NULL.';
  end if;
end $$;
