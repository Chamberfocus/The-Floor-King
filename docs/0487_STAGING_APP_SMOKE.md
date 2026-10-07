# B1 staging application smoke test

Run this only after PR #65 is deployed to a host that uses the staging
Supabase project where migration 0487 already passed.

Do not run it against production. Do not merge the PR to start it. Do not
use the customers or the job that were already on staging before this test.
Those counts were 6 customers and 1 job.

The Settings screen has no outcome editor. New stages created in the app are
`active`. A parked stage and a null-outcome stage are inserted with the SQL
at the end of this document, on the staging project only, and deleted in
cleanup.

Lost behavior in the app is the customer move (`advanceWorkflow`), not the
per-job stage picker. The per-job picker updates the job's stage and the
coarse lead stage. It does not archive the customer and it does not run
Lost job settlement.

## Fingerprint before the test

In the staging SQL Editor, save this grid. It is the unrelated-data guard.

```sql
select 'invoices' as metric, count(*)::bigint as value from public.invoices
union all
select 'payments', count(*) from public.payments
union all
select 'stock_movements', count(*) from public.stock_movements
union all
select 'inventory_return_allocations', count(*) from public.inventory_return_allocations
union all
select 'office_tasks', count(*) from public.office_tasks
union all
select 'products', count(*) from public.products
union all
select 'products_with_reserved', count(*) from public.products where reserved > 0
union all
select 'reserved_qty_sum', coalesce(sum(reserved), 0)::bigint from public.products
union all
select 'jobs', count(*) from public.jobs
union all
select 'customers', count(*) from public.customers
union all
select 'workflow_stages', count(*) from public.workflow_stages;

select id, status
from public.jobs
order by created_at;

select status::text as job_status, count(*) as job_count
from public.jobs
group by status
order by status::text;

select kind, count(*) as movement_count
from public.stock_movements
group by kind
order by kind;
```

Record the existing job `id` and `status`. That row must be unchanged at the
end. Do not open that job during the test.

Expected starting point from the 0487 run: invoices 0, payments 0, stock
movements 0, inventory return allocations 0, office tasks 0, products 13583,
reserved quantity 0, jobs 1, customers 6, workflow stages 16.

## Fixture

Create these in the staging app, signed in as an admin:

1. Customer display name `ZZ-B1 Smoke`.
2. On that customer, two jobs titled `ZZ-B1 Unscheduled` and
   `ZZ-B1 In Progress`. Leave the first unscheduled. Set the second to In
   progress with the normal job status control. Do not reserve stock and do
   not create an invoice or a payment.

Customer moves are done from the customer file, choosing the stage and
saving the move.

## A. Ordinary active stage

Move `ZZ-B1 Smoke` to `New Lead`.

Pass:

- `customers.cancelled_at` is null
- both test jobs keep the statuses you set
- stock movement count and reserved quantity stay 0

Read-only check, substitute nothing else:

```sql
select c.cancelled_at is null as still_active, s.name as stage_name, s.outcome
from public.customers c
join public.workflow_stages s on s.id = c.workflow_stage_id
where c.full_name = 'ZZ-B1 Smoke';

select title, status
from public.jobs
where title in ('ZZ-B1 Unscheduled', 'ZZ-B1 In Progress')
order by title;
```

## B. Real Lost stage

Move `ZZ-B1 Smoke` to `Lost / Declined`.

Pass:

- the stage's stored `outcome` is `lost`
- the customer is archived (`cancelled_at` is set)
- `ZZ-B1 Unscheduled` becomes `cancelled`
- `ZZ-B1 In Progress` stays `in_progress`
- the pre-existing job id from the fingerprint is untouched
- stock movement count and reserved quantity stay 0

Move `ZZ-B1 Smoke` to `Lost / Declined` a second time.

Pass: the same job statuses, still one archive timestamp, stock still 0.
The second move does not cancel the in-progress job and does not insert a
stock movement.

```sql
select s.name, s.outcome, c.cancelled_at is not null as archived
from public.customers c
join public.workflow_stages s on s.id = c.workflow_stage_id
where c.full_name = 'ZZ-B1 Smoke';

select title, status
from public.jobs
where title in ('ZZ-B1 Unscheduled', 'ZZ-B1 In Progress')
order by title;

select count(*) as stock_movements from public.stock_movements;
```

`Lost / Declined` itself is not renamed and not deleted.

## C. Active stage whose label contains Lost

In Settings → Stages, create a stage named `ZZ-B1 Active Probe`.
The app sends `outcome = active`. Confirm:

```sql
select name, outcome
from public.workflow_stages
where name = 'ZZ-B1 Active Probe';
```

Expected: `active`.

Rename that stage's display name to `ZZ-B1 Lost Label`. Do not expect a
Lost settlement from the rename. Confirm the column is still `active`:

```sql
select name, outcome
from public.workflow_stages
where name = 'ZZ-B1 Lost Label';
```

Move `ZZ-B1 Smoke` off Lost onto `ZZ-B1 Lost Label`.

Pass:

- `cancelled_at` is cleared (a non-lost move reopens the customer)
- `ZZ-B1 Unscheduled` stays `cancelled`
- `ZZ-B1 In Progress` stays `in_progress`
- stock movements stay 0

The label contains "Lost". The stored outcome is what keeps this from being
a Lost settlement.

## D. Lost stage whose label is harmless

Do not change `Lost / Declined`. On staging only, insert a controlled stage:

```sql
insert into public.workflow_stages (name, position, outcome)
values ('ZZ-B1 Lost Probe', 900101, 'lost')
returning id, name, position, outcome;
```

`position` is not required for the insert. `900101` keeps the probe away
from the real pipeline order. `name` is the only required column without a
default. `outcome` is set explicitly to `lost`.

In Settings, rename `ZZ-B1 Lost Probe` to `ZZ-B1 Did Not Buy`.

```sql
select name, outcome
from public.workflow_stages
where position = 900101;
```

Expected: name `ZZ-B1 Did Not Buy`, outcome `lost`.

Create one more job on `ZZ-B1 Smoke` titled `ZZ-B1 Unscheduled After Rename`,
left unscheduled. Move the customer to `ZZ-B1 Did Not Buy`.

Pass:

- customer is archived again
- `ZZ-B1 Unscheduled After Rename` becomes `cancelled`
- `ZZ-B1 In Progress` stays `in_progress`
- stock movements stay 0

The label does not say Lost. The stored `lost` outcome does.

## E. Parked stage

There is no parked stage on this database, and Settings cannot set outcome.
Insert one on staging only:

```sql
insert into public.workflow_stages (name, position, outcome)
values ('ZZ-B1 Park Probe', 900102, 'parked')
returning id, name, position, outcome;
```

Rename it in Settings to `ZZ-B1 Parked Renamed`.

```sql
select name, outcome
from public.workflow_stages
where position = 900102;
```

Expected: outcome still `parked`.

Move `ZZ-B1 Smoke` to `ZZ-B1 Parked Renamed`.

Pass:

- customer is not archived (`cancelled_at` is null). Parked is not Lost.
- no test job changes status
- stock movements stay 0

This customer has no job sitting past the install anchor that this move
could complete. Do not add a new open job and then move it here. A non-lost
stage whose position is past `Installed — Follow-up` still uses the existing
completion rule. That rule is not the parked test.

## F. Null fallback

Transition compatibility only. Insert a null outcome with a legacy Lost name:

```sql
insert into public.workflow_stages (name, position, outcome)
values ('ZZ-B1 Null Lost', 900103, null)
returning id, name, position, outcome;
```

Expected read: `outcome` is null.

Create a job titled `ZZ-B1 Null Unscheduled`, left unscheduled. Move
`ZZ-B1 Smoke` to `ZZ-B1 Null Lost`.

Pass:

- the app still treats a null outcome plus this Lost name as Lost
- the customer is archived
- `ZZ-B1 Null Unscheduled` becomes `cancelled`
- `ZZ-B1 In Progress` stays `in_progress`
- stock movements stay 0

## Fingerprint after the test

Run the same fingerprint SQL as the start.

These may change, and only because the fixture did it:

- customers: +1 while `ZZ-B1 Smoke` exists
- jobs: +4 while all four test jobs exist (`ZZ-B1 Unscheduled`,
  `ZZ-B1 In Progress`, `ZZ-B1 Unscheduled After Rename`,
  `ZZ-B1 Null Unscheduled`)
- workflow stages: +3 probes (`ZZ-B1 Lost Label`, position `900101`,
  position `900102`, position `900103`) until cleanup
- statuses of those test jobs, as the steps above require
- `customers.cancelled_at` on `ZZ-B1 Smoke` only

These must match the starting fingerprint exactly:

- invoices count and any status grid
- payments count
- stock movement count and `kind` grid
- products count, products with `reserved` > 0, reserved quantity sum
- inventory return allocations count
- office tasks count
- the original job's `id` and `status`

Handoffs and activities for `ZZ-B1 Smoke` will grow. That is the move log,
not a financial or stock change.

Fail the smoke if any unchanged metric moved.

## Cleanup

Stay on the staging project. Do not delete `Lost / Declined` or any stage
that was in the original 16.

1. In Settings, delete the stage now named `ZZ-B1 Lost Label` only after
   `ZZ-B1 Smoke` is not sitting on it. Move the customer to `New Lead` first
   if you want the archive cleared before delete. Deleting a stage sets
   `workflow_stage_id` to null on rows that pointed at it.
2. Delete the SQL probes:

```sql
delete from public.workflow_stages
where position = 900101 and name in ('ZZ-B1 Lost Probe', 'ZZ-B1 Did Not Buy')
   or position = 900102 and name in ('ZZ-B1 Park Probe', 'ZZ-B1 Parked Renamed')
   or position = 900103 and name = 'ZZ-B1 Null Lost'
   or name in ('ZZ-B1 Active Probe', 'ZZ-B1 Lost Label');
```

3. Delete `ZZ-B1 Smoke` with the in-app Safe Delete (type `DELETE`) if it
   reports no blockers. A test job blocks that delete. Do not invent a
   broader customer delete. If Safe Delete refuses, stop and report the
   blocker. Do not delete any of the original 6 customers.
4. Confirm:

```sql
select id, name, position
from public.workflow_stages
where name like 'ZZ-B1%'
   or position in (900101, 900102, 900103);

select id, full_name
from public.customers
where full_name = 'ZZ-B1 Smoke';

select id, title, status
from public.jobs
where title like 'ZZ-B1%';
```

Stages and the smoke customer should be gone. If the smoke jobs remain
because Safe Delete was blocked, they are still labeled `ZZ-B1` and the
original job id is not among them.

Run the fingerprint one last time. After a full cleanup, customers are 6,
jobs are 1, stages are 16, and the financial and stock metrics match the
start.
