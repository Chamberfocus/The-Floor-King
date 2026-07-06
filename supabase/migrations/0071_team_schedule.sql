-- Team work schedule + time-off board.
--   * staff_work_days — each person's regular weekly working days.
--   * time_off        — days off anyone posts (no approval); everyone sees them.
-- Staff can see the whole team's schedule; you post your own days off (office/
-- admin can post for anyone). Google event ids let approved days off mirror onto
-- the shared team calendar.

create table if not exists staff_work_days (
  user_id    uuid primary key references profiles(id) on delete cascade,
  work_days  text not null default '1,2,3,4,5,6',  -- 0=Sun .. 6=Sat
  updated_at timestamptz not null default now()
);

alter table staff_work_days enable row level security;

drop policy if exists "work days read" on staff_work_days;
create policy "work days read" on staff_work_days
  for select using (public.is_staff());

drop policy if exists "work days write" on staff_work_days;
create policy "work days write" on staff_work_days
  for all
  using (public.is_admin() or public.my_role() = 'office')
  with check (public.is_admin() or public.my_role() = 'office');

create table if not exists time_off (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(id) on delete cascade,
  start_date         date not null,
  end_date           date not null,
  kind               text not null default 'off', -- off | vacation | sick | personal
  note               text,
  created_by         uuid references profiles(id) on delete set null,
  google_event_id    text,
  google_calendar_id text,
  created_at         timestamptz not null default now()
);

create index if not exists time_off_range_idx on time_off (start_date, end_date);

alter table time_off enable row level security;

drop policy if exists "time off read" on time_off;
create policy "time off read" on time_off
  for select using (public.is_staff());

drop policy if exists "time off insert" on time_off;
create policy "time off insert" on time_off
  for insert with check (
    public.is_staff()
    and (user_id = auth.uid() or public.is_admin() or public.my_role() = 'office')
  );

drop policy if exists "time off update" on time_off;
create policy "time off update" on time_off
  for update
  using (user_id = auth.uid() or public.is_admin() or public.my_role() = 'office')
  with check (user_id = auth.uid() or public.is_admin() or public.my_role() = 'office');

drop policy if exists "time off delete" on time_off;
create policy "time off delete" on time_off
  for delete using (
    user_id = auth.uid() or public.is_admin() or public.my_role() = 'office'
  );
