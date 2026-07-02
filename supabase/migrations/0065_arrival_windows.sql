-- Customizable arrival windows for estimate scheduling.
-- Stored as a comma-separated list of "HH:MM-HH:MM" ranges, e.g.
-- "08:00-10:00,10:00-12:00". Friendly 12-hour labels are derived in the app.

alter table public.scheduling_settings
  add column if not exists arrival_windows text;

update public.scheduling_settings
  set arrival_windows = '08:00-10:00,10:00-12:00,12:00-14:00,14:00-16:00,16:00-18:00'
  where id = 'default'
    and (arrival_windows is null or arrival_windows = '');
