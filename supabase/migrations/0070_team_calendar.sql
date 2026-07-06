-- Shared team calendar: one Google calendar that EVERY appointment syncs into,
-- so the whole crew sees the full schedule in one place (instead of each job
-- living only in the assigned rep's personal calendar).
--
-- Single-row config table. Writes go through the service role; a read policy
-- lets the app show the current selection.

create table if not exists team_calendar (
  id            boolean primary key default true,
  owner_id      uuid references profiles(id) on delete set null, -- whose token syncs
  calendar_id   text,          -- Google calendar id all events go to
  calendar_name text,          -- display name (for settings UI)
  updated_at    timestamptz not null default now(),
  constraint team_calendar_singleton check (id)
);

alter table team_calendar enable row level security;

drop policy if exists "team cal read" on team_calendar;
create policy "team cal read" on team_calendar
  for select using (auth.uid() is not null);

-- Which Google calendar an appointment's event actually lives in — needed to
-- update/delete it correctly when it's the shared team calendar rather than a
-- personal "primary" calendar. Legacy rows (null) are treated as "primary".
alter table appointments add column if not exists google_calendar_id text;
