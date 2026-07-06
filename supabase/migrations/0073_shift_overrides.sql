-- One-off schedule changes for a specific date (e.g. "just this Friday Fred
-- works 12–4"), layered on top of the recurring weekly template. An override
-- either sets custom hours OR marks that single date off.
--
-- Precedence when showing a day: approved time off > date override > weekly
-- template.

create table if not exists shift_overrides (
  user_id    uuid not null references profiles(id) on delete cascade,
  date       date not null,
  start_time text,          -- null when it's an "off" override
  end_time   text,
  off        boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table shift_overrides enable row level security;

drop policy if exists "overrides read" on shift_overrides;
create policy "overrides read" on shift_overrides
  for select using (public.is_staff());

drop policy if exists "overrides write" on shift_overrides;
create policy "overrides write" on shift_overrides
  for all
  using (public.is_admin() or public.my_role() = 'office')
  with check (public.is_admin() or public.my_role() = 'office');
