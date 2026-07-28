-- Split the per-job vehicle cost into its own line: a car allowance tracked
-- separately from fuel (both flat $ per job, internal, hidden from the customer).
alter table public.business_settings
  add column if not exists job_car_allowance numeric not null default 0;
