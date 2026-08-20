-- Floor King — overriding a checklist step that the records will never prove
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- The job checklist is deliberately record-backed: a step is done because the
-- estimate, the payment or the work order EXISTS, not because someone ticked
-- it. That is the right default and it is why the list can be trusted.
--
-- But real jobs don't always leave the record behind. A deposit gets waived for
-- a repeat customer. A quote is approved on the phone and the paperwork never
-- catches up. Material was already in the warehouse, so no purchase order was
-- ever raised. With no way to say so, those steps sit open forever, the list
-- reports them as "passed over", and the one thing the checklist was for — an
-- honest read of where the job is — stops being true.
--
-- So: an override is its own record. It never edits the estimate or invents a
-- payment; it sits alongside and says "a person decided this one is handled",
-- with who and why, and it can be undone. The checklist shows it as overridden
-- rather than pretending a record turned up.

create table if not exists public.step_overrides (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers (id) on delete cascade,
  -- Null for the steps that happen BEFORE a work order exists (talk to them,
  -- book the visit, build, send, approve) — those belong to the account.
  job_id       uuid references public.jobs (id) on delete cascade,
  -- Matches ChecklistStep.key in src/lib/job-checklist.ts. Deliberately text,
  -- not an enum: the step list is application shape, and a rename must not need
  -- a migration to stay honest.
  step_key     text not null,
  reason       text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.step_overrides is
  'A person deciding a checklist step is handled when no record will ever prove '
  'it — a waived deposit, a phone approval, material already on the shelf. '
  'Never a substitute for the record: the checklist marks these as overridden.';
comment on column public.step_overrides.job_id is
  'Null = an account-level step, before any work order exists.';

-- One override per step. Two partial indexes because a plain unique over a
-- nullable job_id would let the pre-job steps be overridden twice.
create unique index if not exists step_overrides_job_step_idx
  on public.step_overrides (job_id, step_key) where job_id is not null;
create unique index if not exists step_overrides_account_step_idx
  on public.step_overrides (customer_id, step_key) where job_id is null;
create index if not exists step_overrides_customer_idx
  on public.step_overrides (customer_id);

alter table public.step_overrides enable row level security;

-- Office staff decide these; the crew and the customer portal only ever read
-- the checklist, never overrule it.
drop policy if exists step_overrides_staff on public.step_overrides;
create policy step_overrides_staff on public.step_overrides for all
  to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.step_overrides to authenticated;
