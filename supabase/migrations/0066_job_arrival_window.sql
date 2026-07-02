-- Customizable arrival window for installs (same format as estimate windows:
-- "HH:MM-HH:MM", e.g. "08:00-10:00"). The friendly 12-hour label is derived in
-- the app. Jobs are still date-based; this just adds the time window we tell the
-- customer the crew will arrive in.

alter table public.jobs
  add column if not exists arrival_window text;
