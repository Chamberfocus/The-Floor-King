-- 0180: crew-linked logins can SEE and OPEN jobs assigned to their crew.
--
-- Least privilege. My Work listing already uses the admin client; this is the
-- RLS counterpart so getJob / work-order lines / job_files SELECT succeed.
--
-- Does NOT:
--   - grant generic UPDATE on public.jobs (jobs_crew_update stays assigned_to)
--   - grant INSERT/UPDATE/DELETE on job_files to crew-linked users
--   - create a membership table
--   - expose other crews' jobs
--   - change accounting / posting flags
-- Do NOT set posting_enabled.
-- UNAPPLIED until owner runs this in the SQL editor.

-- Identity: one login per crew via install_crews.profile_id (no membership table).
-- INVOKER + install_crews_self_read: the subquery only returns crews the
-- caller can already SELECT (own linked row). Not a definer function.

create or replace function public.installer_linked_crew_ids()
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select c.id
  from public.install_crews c
  where c.profile_id = auth.uid()
    and c.active = true;
$$;

revoke all on function public.installer_linked_crew_ids() from public, anon;
grant execute on function public.installer_linked_crew_ids() to authenticated;

-- Crew may read their own crew row (needed for INVOKER helper + getJobCrew).
drop policy if exists install_crews_self_read on public.install_crews;
create policy install_crews_self_read on public.install_crews
  for select to authenticated
  using (profile_id = auth.uid());

-- SELECT only. Preserves 0010 open_for_claim board visibility.
-- jobs_crew_update remains assigned_to only (0005) — do not DROP/replace it.
drop policy if exists jobs_crew_read on public.jobs;
create policy jobs_crew_read on public.jobs
  for select to authenticated
  using (
    assigned_to = auth.uid()
    or open_for_claim = true
    or assigned_crew_id in (select public.installer_linked_crew_ids())
  );

drop policy if exists job_line_items_crew_read on public.job_line_items;
create policy job_line_items_crew_read on public.job_line_items
  for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_line_items.job_id
        and (
          j.assigned_to = auth.uid()
          or j.assigned_crew_id in (select public.installer_linked_crew_ids())
        )
    )
  );

-- job_files_access (0008) stays FOR ALL for staff + assigned_to.
-- Crew-linked users get SELECT only — no insert/update/delete via this policy.
drop policy if exists job_files_linked_crew_read on public.job_files;
create policy job_files_linked_crew_read on public.job_files
  for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_files.job_id
        and j.assigned_crew_id in (select public.installer_linked_crew_ids())
    )
  );
