-- A mill or installer claim stays on what the customer owes.
-- Sales and margin reports leave it out. Tax charged on it is still listed.
-- Does not post to the ledger and does not turn posting on.

alter table public.jobs
  add column if not exists is_claim boolean not null default false;

comment on column public.jobs.is_claim is
  'Mill or installer claim. Stays on the customer balance. Left out of sales totals.';
