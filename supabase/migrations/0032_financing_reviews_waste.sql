-- Three features: homeowner financing link, automated review requests,
-- and a per-line waste factor on estimates.

-- 1) Org settings: financing + Google review links -----------------------------
alter table public.org_settings
  add column if not exists financing_url     text,
  add column if not exists google_review_url text;

-- 2) Jobs: track completion time + whether we asked for a review ---------------
alter table public.jobs
  add column if not exists completed_at           timestamptz,
  add column if not exists review_request_sent_at timestamptz;

-- Stamp completed_at automatically whenever a job becomes 'completed'.
create or replace function public.set_job_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed')
     and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists jobs_set_completed_at on public.jobs;
create trigger jobs_set_completed_at
  before insert or update on public.jobs
  for each row execute function public.set_job_completed_at();

-- Backfill: any already-completed jobs get a completion time so they don't all
-- trigger a review request retroactively (treat as already handled).
update public.jobs
  set completed_at = coalesce(completed_at, updated_at),
      review_request_sent_at = coalesce(review_request_sent_at, now())
  where status = 'completed' and completed_at is null;

-- 3) Estimate lines: waste percentage (added to the material amount) -----------
alter table public.estimate_line_items
  add column if not exists waste_pct numeric not null default 0;
