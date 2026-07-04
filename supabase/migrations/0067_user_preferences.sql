-- Per-user page preferences: which quick actions & tabs each login sees, and in
-- what order. One row per user; absence of a row = app defaults. Personal to
-- each login (RLS: you can only see/change your own row).

create table if not exists user_preferences (
  user_id       uuid primary key references profiles(id) on delete cascade,
  quick_actions text[],            -- ordered enabled actions on the customer file bar
  list_actions  text[],            -- ordered enabled actions on the customer list rows
  tabs          text[],            -- ordered visible tabs on the customer file
  default_tab   text,              -- tab a customer file opens on
  updated_at    timestamptz not null default now()
);

alter table user_preferences enable row level security;

-- Each user manages only their own preferences.
drop policy if exists "own prefs select" on user_preferences;
create policy "own prefs select" on user_preferences
  for select using (user_id = auth.uid());

drop policy if exists "own prefs insert" on user_preferences;
create policy "own prefs insert" on user_preferences
  for insert with check (user_id = auth.uid());

drop policy if exists "own prefs update" on user_preferences;
create policy "own prefs update" on user_preferences
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own prefs delete" on user_preferences;
create policy "own prefs delete" on user_preferences
  for delete using (user_id = auth.uid());
