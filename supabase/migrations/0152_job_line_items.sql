-- Floor King — the work order owns its own scope
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- A job had no scope of its own. What's being installed — the rooms, the
-- quantities, the material, the labour — lived on the ESTIMATE, and the job just
-- pointed at the accepted option. So the work order was read-only: editing what
-- the crew is actually doing meant editing the customer's approved quote, and
-- the only thing changeable from the job side was stock-vs-order sourcing.
--
-- That's the wrong way round for how the work goes. The measurement is off by a
-- closet, the crew finds a second layer of subfloor, a room gets dropped — the
-- WORK ORDER has to say what's really happening, and the signed estimate has to
-- stay as signed, or there's no record of what was agreed.
--
-- So the job gets its own copy of the lines, made from the estimate and free to
-- diverge from it afterwards.

/**
 * Same shape as an estimate line, deliberately — every calculator in the app
 * (lineQty, lineTotal, buildJobScope, lineSpec, the cut list) already reads that
 * shape, so a job line drops straight into all of them with no new code.
 */
create table if not exists public.job_line_items (
  like public.estimate_line_items including defaults including constraints
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_line_items_pkey') then
    alter table public.job_line_items add primary key (id);
  end if;
end
$$;

alter table public.job_line_items
  add column if not exists job_id uuid references public.jobs (id) on delete cascade;

-- option_id came along with the LIKE and means nothing here; keep it nullable as
-- a breadcrumb back to the estimate option the line was copied from.
alter table public.job_line_items alter column option_id drop not null;

comment on table public.job_line_items is
  'The WORK ORDER''s scope. Copied from the estimate when the job is created, '
  'then edited freely — the signed estimate never changes. option_id is kept '
  'only to show where a line came from.';

create index if not exists job_line_items_job_idx
  on public.job_line_items (job_id, position);

alter table public.job_line_items enable row level security;

drop policy if exists job_line_items_staff on public.job_line_items;
create policy job_line_items_staff on public.job_line_items for all
  to authenticated using (public.is_staff()) with check (public.is_staff());

-- The crew reads the scope of jobs assigned to them (that IS the work order).
drop policy if exists job_line_items_crew_read on public.job_line_items;
create policy job_line_items_crew_read on public.job_line_items for select
  to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_line_items.job_id and j.assigned_to = auth.uid()
    )
  );

grant select, insert, update, delete on public.job_line_items to authenticated;

/**
 * Backfill: every job that has an estimate option takes a copy of its lines, so
 * nothing changes on the day this runs — the work order shows exactly what it
 * showed before, and only diverges once somebody edits it.
 *
 * Only fills jobs that have no lines yet, so re-running never overwrites an
 * edit.
 */
insert into public.job_line_items
select l.*, j.id as job_id
from public.estimate_line_items l
join public.jobs j on j.option_id = l.option_id
where j.status <> 'cancelled'
  and not exists (
    select 1 from public.job_line_items x where x.job_id = j.id
  );
