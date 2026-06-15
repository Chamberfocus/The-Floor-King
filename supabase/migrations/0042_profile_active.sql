-- Deactivate a team member without deleting them: their login is disabled but
-- their profile (and their name on past jobs/estimates) stays intact, and they
-- can be reactivated later.
alter table public.profiles
  add column if not exists active boolean not null default true;
