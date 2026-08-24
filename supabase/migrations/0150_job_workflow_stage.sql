-- Floor King — the pipeline stage belongs to the WORK, not the account
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- The stage has always lived on `customers`, so an account held exactly one
-- position in the pipeline however much work it had. That is fine for the 17 of
-- 46 live customers who have no job yet — a lead being chased for a quote IS the
-- account. It falls apart the moment a customer has two jobs running, which for
-- a contractor or a property manager is the normal case, not an edge one:
--
--   JDP Home Improvements — account stage "Install In Progress"
--     "Flooring for JDP Home Improvements"  unscheduled
--     "Home Addition"                       in progress
--     "Flooring for JDP Home Improvements"  in progress
--
-- Two of those hadn't been measured. They were reported as being installed
-- because the third one was, sat in the wrong lane on Client status, carried no
-- next-action date, and nothing chased them. Every workaround for this — restart
-- the flow, forward-only nudges — is a way of choosing which job gets to be the
-- truth. There is no right answer to that question; the question is wrong.
--
-- So a job carries its own stage, its own owner and its own due date. The
-- customer keeps theirs for the phase BEFORE any job exists (lead, estimate
-- booked, quote out) — that work has no job to hang off and genuinely belongs
-- to the account. One rule: the stage lives on the smallest thing that can
-- actually be at a stage.

alter table public.jobs
  add column if not exists workflow_stage_id uuid
    references public.workflow_stages (id) on delete set null,
  -- Deliberately mirrors customers.workflow_owner_id, which points at
  -- auth.users rather than profiles.
  add column if not exists workflow_owner_id uuid
    references auth.users (id) on delete set null,
  add column if not exists next_action_due timestamptz;

comment on column public.jobs.workflow_stage_id is
  'Where THIS job stands. Null means it has not been staged yet and the '
  'account''s own stage stands in — see workStageFor() in src/lib/work-stage.ts.';
comment on column public.jobs.next_action_due is
  'SLA clock for this job, so two jobs on one account chase independently.';

create index if not exists jobs_workflow_idx on public.jobs (workflow_stage_id);
create index if not exists jobs_workflow_owner_idx on public.jobs (workflow_owner_id);
create index if not exists jobs_next_action_idx on public.jobs (next_action_due)
  where next_action_due is not null;

/**
 * Backfill: every existing job inherits the stage its account was carrying, so
 * nothing moves on the day this runs. Multi-job accounts start with all their
 * jobs on the same stage — which is exactly where they are today — and can be
 * moved apart from there.
 *
 * Only fills jobs that have no stage yet, so re-running never overwrites work.
 */
update public.jobs j
set
  workflow_stage_id = c.workflow_stage_id,
  workflow_owner_id = coalesce(j.workflow_owner_id, c.workflow_owner_id),
  next_action_due   = coalesce(j.next_action_due, c.next_action_due)
from public.customers c
where j.customer_id = c.id
  and j.workflow_stage_id is null
  and c.workflow_stage_id is not null
  and j.status <> 'cancelled';
