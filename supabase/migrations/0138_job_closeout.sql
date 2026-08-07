-- Floor King — closing a job out: what it really cost, and what went wrong
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Job costing already compares estimated against actual, but nothing ever fed
-- the actual side: labor came only from an installer bill and material only
-- from committed POs, so with no bills written and every PO still a draft,
-- every job read "not yet costed". This gives one place to type what a job
-- really cost — and to say what went wrong, in a way that adds up across jobs.

alter table public.jobs
  -- Dump fees, fuel, a mid-job run to the store: real money that belonged
  -- nowhere before.
  add column if not exists actual_other_cost numeric(12,2),
  add column if not exists closeout_notes text,
  add column if not exists closed_out_at timestamptz,
  add column if not exists closed_out_by uuid references public.profiles (id) on delete set null;

comment on column public.jobs.actual_other_cost is
  'Costs that are neither material nor labor — dump fees, fuel, a run to the store.';
comment on column public.jobs.closed_out_at is
  'When the real costs were recorded. Null = never closed out, which is what '
  'separates "cost me nothing" from "nobody has said yet".';

-- What went wrong, in a form that totals up ---------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_issue_code') then
    create type public.job_issue_code as enum (
      'bad_measure',          -- measured short or long
      'material_shortage',    -- ran out mid-job
      'material_wrong',       -- wrong colour, style, lot
      'material_damaged',
      'installer_rework',     -- had to redo work
      'customer_change',      -- scope changed after pricing
      'subfloor_condition',   -- worse than it looked
      'access_delay',         -- couldn't get in, furniture, parking
      'scheduling',           -- crew or date fell through
      'pricing_error',        -- quoted wrong
      'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'job_issue_blame') then
    create type public.job_issue_blame as enum (
      'sales', 'installer', 'supplier', 'warehouse', 'customer', 'us', 'unknown'
    );
  end if;
end
$$;

create table if not exists public.job_issues (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id) on delete cascade,
  code          public.job_issue_code not null,
  blame         public.job_issue_blame not null default 'unknown',
  -- Optional: the specific person or supplier, so patterns surface over time.
  blame_profile_id  uuid references public.profiles (id) on delete set null,
  blame_supplier_id uuid references public.suppliers (id) on delete set null,
  -- What it cost. Nullable, because some problems cost time, not money.
  cost_impact   numeric(12,2),
  note          text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists job_issues_job_idx on public.job_issues (job_id);
create index if not exists job_issues_code_idx on public.job_issues (code);
create index if not exists job_issues_blame_idx on public.job_issues (blame);

alter table public.job_issues enable row level security;

drop policy if exists job_issues_staff on public.job_issues;
create policy job_issues_staff on public.job_issues for all
  to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.job_issues to authenticated;

/**
 * Which causes actually cost money, across every job.
 *
 * The point of a reason code rather than free text: "bad measure cost us
 * $4,200 across nine jobs this year" is a decision you can act on, and a pile
 * of notes isn't.
 */
create or replace view public.job_issue_totals
with (security_invoker = true) as
select
  i.code,
  i.blame,
  count(*)::int                              as times,
  coalesce(sum(i.cost_impact), 0)            as cost,
  count(distinct i.job_id)::int              as jobs
from public.job_issues i
group by i.code, i.blame;

grant select on public.job_issue_totals to authenticated;

/**
 * Estimated vs actual per job, with the actual side preferring what was typed
 * at close-out and falling back to what the records imply.
 */
create or replace view public.job_costing
with (security_invoker = true) as
select
  j.id                                          as job_id,
  j.customer_id,
  j.title,
  j.status,
  j.closed_out_at,
  coalesce(j.estimated_material_cost, 0)        as est_material,
  coalesce(j.estimated_labor_cost, 0)           as est_labor,
  coalesce(j.estimated_material_cost, 0)
    + coalesce(j.estimated_labor_cost, 0)       as est_total,
  j.actual_material_cost,
  j.actual_labor_cost,
  j.actual_other_cost,
  case
    when j.actual_material_cost is null
     and j.actual_labor_cost is null
     and j.actual_other_cost is null then null
    else coalesce(j.actual_material_cost, 0)
       + coalesce(j.actual_labor_cost, 0)
       + coalesce(j.actual_other_cost, 0)
  end                                           as actual_total,
  (select coalesce(sum(i.cost_impact), 0) from public.job_issues i where i.job_id = j.id)
                                                as issue_cost,
  (select count(*)::int from public.job_issues i where i.job_id = j.id)
                                                as issue_count
from public.jobs j;

grant select on public.job_costing to authenticated;
