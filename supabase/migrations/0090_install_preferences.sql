-- 0090 — Client install-date PREFERENCES (a request, never a confirmation).
-- The customer picks preferred start dates in the portal; the job stays
-- unscheduled until the office confirms via bookInstall. Idempotent.

create table if not exists install_preferences (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  rank int not null check (rank between 1 and 3),
  preferred_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists install_preferences_job_idx on install_preferences (job_id);

-- Timestamp of the client's latest submission (for "submitted" state + notify).
alter table jobs add column if not exists install_prefs_at timestamptz;

alter table install_preferences enable row level security;
-- Staff manage/read directly; the portal writes/reads via a service-role server
-- action that verifies the customer owns the job (no data leak).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'install_preferences' and policyname = 'staff_all_install_prefs'
  ) then
    create policy staff_all_install_prefs on install_preferences
      for all using (is_staff()) with check (is_staff());
  end if;
end $$;
