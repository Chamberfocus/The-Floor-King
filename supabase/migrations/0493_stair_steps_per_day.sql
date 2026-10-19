-- Install scheduler: steps one crew can finish in a day.
-- Safe to re-run. Does not enable accounting or books of record.

alter table public.scheduling_settings
  add column if not exists cap_stair_steps numeric not null default 12;
