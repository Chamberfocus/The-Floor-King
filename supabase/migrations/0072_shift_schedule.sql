-- Rework the team schedule into a published shift schedule + time-off approval.
--   * staff_shifts — each person's weekly working HOURS per weekday (template).
--   * time_off.status — day-off requests are auto-approved unless they clash
--     with someone already off, in which case they wait for a manager.

create table if not exists staff_shifts (
  user_id    uuid not null references profiles(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6), -- 0=Sun..6=Sat
  start_time text not null,   -- "HH:MM" 24-hour
  end_time   text not null,
  primary key (user_id, weekday)
);

alter table staff_shifts enable row level security;

drop policy if exists "shifts read" on staff_shifts;
create policy "shifts read" on staff_shifts
  for select using (public.is_staff());

drop policy if exists "shifts write" on staff_shifts;
create policy "shifts write" on staff_shifts
  for all
  using (public.is_admin() or public.my_role() = 'office')
  with check (public.is_admin() or public.my_role() = 'office');

-- Approval workflow for time off. Existing rows count as already approved.
alter table time_off
  add column if not exists status text not null default 'approved'; -- pending|approved|denied
alter table time_off
  add column if not exists decided_by uuid references profiles(id) on delete set null;
alter table time_off
  add column if not exists decided_at timestamptz;

create index if not exists time_off_status_idx on time_off (status);

-- Only managers may change a request's status (approve / deny); employees can
-- still insert their own requests and cancel (delete) them.
drop policy if exists "time off update" on time_off;
create policy "time off update" on time_off
  for update
  using (public.is_admin() or public.my_role() = 'office')
  with check (public.is_admin() or public.my_role() = 'office');
