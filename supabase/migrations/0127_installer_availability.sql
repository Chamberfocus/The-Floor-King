-- Installer-owned availability, with database-enforced privacy.
--
-- WHY: office/admin can already manage the team schedule (staff_work_days,
-- time_off, staff_shifts, shift_overrides), but INSTALLERS (crew) are locked out
-- of those tables — is_staff() = admin/office only. This lets field crew post
-- their OWN availability / time off so the office knows when they can be
-- scheduled, WITHOUT giving the office visibility into private details.
--
-- PRIVACY MODEL (the key requirement): a crew member can mark a block PRIVATE.
--   * The office must NOT be able to see the note (which may name the installer's
--     own customer). A private block surfaces to the office as "Unavailable" only.
--   * This is enforced at the DATABASE layer, not just the UI:
--       - RLS on installer_availability grants SELECT to the OWNER ONLY. The
--         office has NO direct read on the raw table, so they can never query the
--         raw note — private or not.
--       - The office reads exclusively through installer_availability_office(),
--         a SECURITY DEFINER function that redacts the note on private rows.

create table if not exists installer_availability (
  id           uuid primary key default gen_random_uuid(),
  installer_id uuid not null references profiles(id) on delete cascade,
  start_date   date not null,
  end_date     date not null,                 -- = start_date for a single day
  all_day      boolean not null default true,
  start_time   text,                          -- "HH:MM" when not all_day
  end_time     text,
  kind         text not null default 'off',   -- off (time off) | busy (own job/personal)
  note         text,                          -- optional detail; hidden from office when private
  private      boolean not null default false,-- true → office sees "Unavailable" only
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint installer_availability_range_ck check (end_date >= start_date)
);

create index if not exists installer_availability_owner_idx
  on installer_availability (installer_id, start_date);
create index if not exists installer_availability_range_idx
  on installer_availability (start_date, end_date);

alter table installer_availability enable row level security;

-- OWNER-ONLY on the raw table. The office is intentionally NOT granted select
-- here — they read through installer_availability_office() below, which redacts.
drop policy if exists "installer availability owner read" on installer_availability;
create policy "installer availability owner read" on installer_availability
  for select using (installer_id = auth.uid());

drop policy if exists "installer availability owner insert" on installer_availability;
create policy "installer availability owner insert" on installer_availability
  for insert with check (installer_id = auth.uid());

drop policy if exists "installer availability owner update" on installer_availability;
create policy "installer availability owner update" on installer_availability
  for update using (installer_id = auth.uid()) with check (installer_id = auth.uid());

drop policy if exists "installer availability owner delete" on installer_availability;
create policy "installer availability owner delete" on installer_availability
  for delete using (installer_id = auth.uid());

-- The ONLY way the office sees crew availability. Redacts the note for private
-- rows so customer details never leak. Returns nothing for non-schedulers.
create or replace function public.installer_availability_office(p_from date, p_to date)
returns table (
  id            uuid,
  installer_id  uuid,
  installer_name text,
  start_date    date,
  end_date      date,
  all_day       boolean,
  start_time    text,
  end_time      text,
  kind          text,
  is_private    boolean,
  label         text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.installer_id,
    p.full_name,
    a.start_date,
    a.end_date,
    a.all_day,
    a.start_time,
    a.end_time,
    a.kind,
    a.private,
    case
      when a.private then 'Unavailable'
      else coalesce(nullif(a.note, ''),
                    case a.kind when 'busy' then 'Busy' else 'Time off' end)
    end as label
  from installer_availability a
  join profiles p on p.id = a.installer_id
  where (public.is_staff() or public.my_role() = 'scheduler')
    and a.end_date >= p_from
    and a.start_date <= p_to
  order by a.start_date, p.full_name;
$$;

grant execute on function public.installer_availability_office(date, date) to authenticated;
