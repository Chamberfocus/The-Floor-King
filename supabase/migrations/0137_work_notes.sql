-- Floor King — notes that can be aimed at a job, a purchase order, or the shop
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- 0136 created job_notes. It needs to cover more ground: notes about an
-- incoming PO ("check the dye lot when the Mohawk lands"), and shop-wide ones
-- that belong to nothing in particular ("truck is down Thursday"). A table
-- called job_notes holding those would be a lie, so it is renamed.
--
-- One log, three targets, and an audience per note — rather than three separate
-- inboxes nobody remembers to check.

alter table if exists public.job_notes rename to work_notes;

-- A note can hang off a job, a purchase order, or neither (a shop-wide note).
alter table public.work_notes alter column job_id drop not null;
alter table public.work_notes
  add column if not exists po_id uuid references public.purchase_orders (id) on delete cascade,
  -- Who it is for. Both can be true; neither means office-only.
  add column if not exists for_warehouse boolean not null default false,
  -- Escalates the notification from email to a text.
  add column if not exists urgent boolean not null default false,
  add column if not exists notified_at timestamptz;

comment on column public.work_notes.for_warehouse is
  'Shows on the warehouse queue and the staging sheet, and sends them a message.';
comment on column public.work_notes.urgent is
  'Normal warehouse notes email; urgent ones also text.';
comment on column public.work_notes.po_id is
  'Set for a note about an incoming order — the warehouse sees it on the '
  'receiving card before the box is even opened.';

create index if not exists work_notes_po_idx on public.work_notes (po_id, created_at desc)
  where po_id is not null;
create index if not exists work_notes_warehouse_idx on public.work_notes (created_at desc)
  where for_warehouse;
-- Shop-wide notes: attached to nothing, aimed at everyone.
create index if not exists work_notes_board_idx on public.work_notes (created_at desc)
  where job_id is null and po_id is null;

-- Old policy names referenced the old table; rebuild them cleanly.
drop policy if exists job_notes_staff_all on public.work_notes;
drop policy if exists job_notes_crew_read on public.work_notes;
drop policy if exists job_notes_crew_insert on public.work_notes;

drop policy if exists work_notes_staff_all on public.work_notes;
create policy work_notes_staff_all on public.work_notes for all
  to authenticated using (public.is_staff()) with check (public.is_staff());

-- The crew reads and writes on jobs assigned to them.
drop policy if exists work_notes_crew_read on public.work_notes;
create policy work_notes_crew_read on public.work_notes for select
  to authenticated
  using (
    job_id is not null
    and exists (
      select 1 from public.jobs j
      where j.id = work_notes.job_id and j.assigned_to = auth.uid()
    )
  );

drop policy if exists work_notes_crew_insert on public.work_notes;
create policy work_notes_crew_insert on public.work_notes for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and job_id is not null
    and exists (
      select 1 from public.jobs j
      where j.id = work_notes.job_id and j.assigned_to = auth.uid()
    )
  );

-- The warehouse reads anything aimed at them, and can write back.
drop policy if exists work_notes_warehouse_read on public.work_notes;
create policy work_notes_warehouse_read on public.work_notes for select
  to authenticated
  using (
    for_warehouse
    and coalesce(public.user_role(auth.uid())::text, '') = 'warehouse'
  );

drop policy if exists work_notes_warehouse_insert on public.work_notes;
create policy work_notes_warehouse_insert on public.work_notes for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and coalesce(public.user_role(auth.uid())::text, '') = 'warehouse'
  );

grant select, insert, update, delete on public.work_notes to authenticated;
