-- Two-way Google Calendar sync: per-user OAuth connection + event mapping.
-- Tokens are only ever read/written server-side (service role); RLS still limits
-- any direct access to a user's own row.

create table if not exists google_calendar_connections (
  user_id       uuid primary key references profiles(id) on delete cascade,
  google_email  text,
  access_token  text not null,
  refresh_token text,
  token_expiry  timestamptz,
  calendar_id   text not null default 'primary',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table google_calendar_connections enable row level security;

drop policy if exists "own gcal select" on google_calendar_connections;
create policy "own gcal select" on google_calendar_connections
  for select using (user_id = auth.uid());
drop policy if exists "own gcal insert" on google_calendar_connections;
create policy "own gcal insert" on google_calendar_connections
  for insert with check (user_id = auth.uid());
drop policy if exists "own gcal update" on google_calendar_connections;
create policy "own gcal update" on google_calendar_connections
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own gcal delete" on google_calendar_connections;
create policy "own gcal delete" on google_calendar_connections
  for delete using (user_id = auth.uid());

-- Which Google event (and in whose calendar) a CRM appointment maps to.
alter table appointments add column if not exists google_event_id text;
alter table appointments add column if not exists google_calendar_user uuid;
