# 0487 staging validation (manual)

Manual package for migration `supabase/migrations/0487_workflow_stage_outcome.sql`.
Run it in the Supabase SQL Editor on the **staging** project only.

This document does not connect to a database. It does not select a project.
It does not contain credentials, project URLs, or project names.

0487 adds `workflow_stages.outcome`, backfills existing nulls from the stage
name, then sets the column default to `active`. It does not insert, delete,
or rename stages. It does not write customers, jobs, invoices, payments,
tasks, or stock.

## How to run this

1. Open the Supabase dashboard yourself and select the staging project.
2. Open the SQL Editor.
3. Run the blocks below **in order**, one block at a time.
4. Paste **only** the SQL inside a fenced `sql` block. Do not paste the
   markdown heading, the fence, or the prose around it. Lines that start
   with `--` are SQL comments and are safe to paste.
5. Save every result grid. You will paste them into the template at the bottom.
6. Stop at every **STOP** in this document. A later block is not permission
   to ignore an earlier stop.

Schema names in these queries come from the migrations in this repo:

| Object | Migration |
| --- | --- |
| `public.customers` | `0002_customers.sql` |
| `public.customers.cancelled_at` | `0044_cancel_customer.sql` |
| `public.jobs.status` (`job_status`) | `0005_jobs.sql` |
| `public.invoices.status` (`invoice_status`), `public.payments` | `0007_invoices.sql` |
| `public.workflow_stages` (`id`, `name`, `position`, `color`, `default_owner`, `created_at`) | `0013_workflow.sql` |
| `public.customers.workflow_stage_id` | `0013_workflow.sql` |
| `public.workflow_stages.auto_action` | `0029_stage_auto_action.sql` |
| `public.workflow_stages.next_action`, `sla_hours` | `0034_stage_next_action_sla.sql` |
| `public.stock_movements` (`kind`) | `0037_inventory.sql` |
| `public.products.reserved` | `0043_stock_sourcing.sql` |
| `public.workflow_stages.owner_duty` | `0051_stage_owner_duty.sql` |
| `public.office_tasks` | `0160_f2_operations_glue.sql` |
| `public.inventory_return_allocations` | `0176_f6_p4_inventory_accounting.sql` |

`workflow_stages` has no unique constraint on `name` or `position`. The only
required column without a default is `name`. `position` defaults to `0`,
`color` to `'zinc'`, `auto_action` to `'none'`, and `sla_hours` to `0`.
`id` and `created_at` default as well. `next_action`, `default_owner`, and
`owner_duty` are nullable. There is no trigger on `workflow_stages`.

## Block A — environment identity (read-only)

```sql
select
  current_database() as current_database,
  current_user as current_user,
  session_user as session_user,
  current_setting('server_version') as server_version,
  version() as postgres_version,
  now() as current_timestamp,
  current_setting('application_name', true) as application_name,
  inet_server_addr() as inet_server_addr,
  inet_server_port() as inet_server_port;
```

**STOP unless the operator has independently confirmed this Supabase project is STAGING and not production.**

These values do not prove which Supabase project is connected.
`current_database()` is typically `postgres` on both staging and production.
`inet_server_addr()` is often null behind the pooler. Nothing in PostgreSQL
exposes a reliable Supabase project id from the SQL Editor. The project
selected in the dashboard is the confirmation. SQL cannot supply it.

Do not continue to Block B until that confirmation is done.

## Block B — BEFORE fingerprint (read-only)

Run this whole block once. Keep every result grid. Block H is the same SQL
and must return the same grids, except that Block H is run after 0487.

If `exists_in_public` is false for any table, record `RELATION DOES NOT EXIST`
for that table. Leave the matching `select count(*)` statement in this
document unchanged. If that count then errors with `undefined_table`
(SQLSTATE `42P01`), record the error and run the later statements one at a
time. Do not create the table while validating 0487. A missing table on a
database that is supposed to already contain migrations through `0486` is a
reason to stop before Block F.

If the `products.reserved` lookup returns zero rows, record
`COLUMN DOES NOT EXIST` and skip only the last statement of F5. Do not
rewrite it.

```sql
-- F0. Table presence. Read-only.
-- If exists_in_public is false, record RELATION DOES NOT EXIST for that
-- table in the result template. Do not delete that table from the F3
-- statements below. Do not create the table.
select requested.table_name,
       (to_regclass('public.' || requested.table_name) is not null) as exists_in_public
from (values
  ('customers'),
  ('jobs'),
  ('invoices'),
  ('payments'),
  ('stock_movements'),
  ('office_tasks'),
  ('inventory_return_allocations'),
  ('workflow_stages'),
  ('products')
) as requested(table_name)
order by requested.table_name;

-- F0b. products.reserved column. Read-only.
-- Zero rows means record COLUMN DOES NOT EXIST for the reserved distribution
-- and skip only the last statement in F5. Do not rewrite that statement.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'products'
  and column_name = 'reserved';

-- F1. Workflow stages. Read-only. Outcome is omitted so this grid
-- has the same columns before and after 0487.
select id, name, position, auto_action, next_action, sla_hours
from public.workflow_stages
order by position, id;

select count(*) as workflow_stage_count
from public.workflow_stages;

-- F1b. Probe names and sentinel positions.
-- Expected: zero rows. A row here means a probe already exists.
-- Stop before Blocks I-L.
select id, name, position
from public.workflow_stages
where name like 'ZZ-0487-PROBE-%'
   or position in (900001, 900002)
order by position, id;

-- F2. Customer stage pointers. Counts only. No names, email, phone, or address.
select workflow_stage_id, count(*) as customer_count
from public.customers
group by workflow_stage_id
order by workflow_stage_id nulls first;

select
  count(*) as total_customers,
  count(*) filter (where workflow_stage_id is not null) as customers_with_workflow_stage_id,
  count(*) filter (where cancelled_at is not null) as customers_with_cancelled_at
from public.customers;

-- F3. Business data counts. One statement per table.
-- If a statement fails with SQLSTATE 42P01 undefined_table, record
-- RELATION DOES NOT EXIST for that table, then run the remaining
-- statements one at a time. Do not remove the failing statement from
-- this document and do not create the missing table.
select count(*) as customers from public.customers;
select count(*) as jobs from public.jobs;
select count(*) as invoices from public.invoices;
select count(*) as payments from public.payments;
select count(*) as stock_movements from public.stock_movements;
select count(*) as office_tasks from public.office_tasks;
select count(*) as inventory_return_allocations from public.inventory_return_allocations;

-- F4. Status distributions. Read-only.
select status::text as job_status, count(*) as job_count
from public.jobs
group by status
order by status::text;

select status::text as invoice_status, count(*) as invoice_count
from public.invoices
group by status
order by status::text;

-- F5. Stock and reservation distribution. Aggregates only. No product names.
-- stock_movements.kind includes receive, pull, adjust, return, and the
-- reserve / release kinds added later. Grouping returns whatever is stored.
select kind, count(*) as movement_count
from public.stock_movements
group by kind
order by kind;

select
  count(*) as product_count,
  count(*) filter (where reserved > 0) as products_with_reserved,
  coalesce(sum(reserved), 0) as reserved_qty_sum
from public.products;
```

What must be copied into the template from this block:

- `workflow_stage_count`
- the stage list (`id`, `name`, `position`, and the other selected columns)
- `workflow_stage_id | customer_count`, including the null `workflow_stage_id` group
- `total_customers`
- `customers_with_workflow_stage_id`
- `customers_with_cancelled_at` (this is the archived-customer count)
- the seven business counts
- jobs by `status`
- invoices by `status`
- `stock_movements` by `kind`
- product reserved totals

F1b must return zero rows before any probe in Blocks I–L.

## Block C — preview classification (read-only)

Run this **before** Block F. It does not read or write `outcome`. It
classifies every current stage name with the same `CASE` and the same
PostgreSQL regular expressions as the `UPDATE` in 0487.

On a database where `outcome` does not exist yet, every existing row is null
and this preview is the value 0487 will store. `won` is not produced.

```sql
select
  id,
  name,
  position,
  case
    when coalesce(name, '') ~* 'lost|declin|dead|cancel' then 'lost'
    when coalesce(name, '') ~* 'material|deliver' then 'active'
    when coalesce(name, '') ~* $park$\ywaiting\y|\yon hold\y|\yhold\y|\ypark$park$ then 'parked'
    else 'active'
  end as predicted_outcome,
  case
    when coalesce(name, '') ~* 'lost|declin|dead|cancel' then 'lost rule'
    when coalesce(name, '') ~* 'material|deliver' then 'material/deliver exclusion'
    when coalesce(name, '') ~* $park$\ywaiting\y|\yon hold\y|\yhold\y|\ypark$park$ then 'parked rule'
    else 'default active'
  end as classification_reason
from public.workflow_stages
order by position, id;
```

`classification_reason` is one of:

- `lost rule`
- `material/deliver exclusion`
- `parked rule`
- `default active`

The three `WHEN` tests are copied from 0487, in that order. Lost wins over
the material/deliver exclusion. The material/deliver exclusion wins over the
parked rule. The parked pattern is the dollar-quoted string used in 0487, so
`\y` reaches PostgreSQL as a word boundary and not as a doubled backslash.

## Block D — representative PostgreSQL regex proof (read-only)

This statement does not read or write any table. It runs the same `CASE` as
Block C and as 0487.

```sql
select
  v.sort_key,
  v.name,
  case
    when coalesce(v.name, '') ~* 'lost|declin|dead|cancel' then 'lost'
    when coalesce(v.name, '') ~* 'material|deliver' then 'active'
    when coalesce(v.name, '') ~* $park$\ywaiting\y|\yon hold\y|\yhold\y|\ypark$park$ then 'parked'
    else 'active'
  end as postgres_outcome,
  case
    when coalesce(v.name, '') ~* 'lost|declin|dead|cancel' then 'lost rule'
    when coalesce(v.name, '') ~* 'material|deliver' then 'material/deliver exclusion'
    when coalesce(v.name, '') ~* $park$\ywaiting\y|\yon hold\y|\yhold\y|\ypark$park$ then 'parked rule'
    else 'default active'
  end as classification_reason
from (values
  (1, 'Lost'),
  (2, 'Did Not Buy'),
  (3, 'Declined'),
  (4, 'Dead'),
  (5, 'Cancelled'),
  (6, 'Lost Samples Follow-Up'),
  (7, 'Waiting'),
  (8, 'Waiting on Customer'),
  (9, 'Waiting on Product'),
  (10, 'Awaiting Materials'),
  (11, 'Material Ordered'),
  (12, 'Delivery Pending'),
  (13, 'On Hold'),
  (14, 'Hold'),
  (15, 'Park'),
  (16, 'Parked'),
  (17, 'Follow Up'),
  (18, 'Installed'),
  (19, 'Collect Balance')
) as v(sort_key, name)
order by v.sort_key;
```

Compare `postgres_outcome` to `postgres_should_return`, and
`classification_reason` to the reason column in the next section, row by row.
`Waiting`, `On Hold`, `Hold`, `Park`, and `Parked` are the `\y` rows: if the
word boundary is wrong, those come back `active`. `Awaiting Materials` must
stay `active` with reason `material/deliver exclusion`.

**STOP if any `postgres_outcome` differs from `postgres_should_return`.**
Do not run Block F.

## Expected JavaScript outcomes

These values were produced by executing `backfillOutcomeFromCurrentName` in
`src/lib/customer-lifecycle.ts`. That function returns `lost` when
`stageNameMeansLost` matches (`/lost|declin|dead|cancel/i`), otherwise
`parked` when `stageNameMeansParked` matches, otherwise `active`. It never
returns `won`.

`stageNameMeansParked` lowercases the name, returns false when
`/material|deliver/` matches, then tests
`/\bwaiting\b|\bon hold\b|\bhold\b|\bpark/`.

PostgreSQL `~*` is the case-insensitive form of those same tests.
PostgreSQL `\y` is the word-boundary form of JavaScript `\b` in that parked
pattern. The parked pattern in 0487 is dollar-quoted so the backslash is
preserved. Static comparison of the 19 names below found no outcome
difference. This document does not claim a PostgreSQL server was executed
while the document was written. Block D is that execution.

`Lost Samples Follow-Up` is `lost` by this name rule. A stored `outcome` of
`active` on that label is a different case, already covered by the B1 golden
tests. 0487 only classifies rows whose `outcome` is null.

| name | expected_javascript_outcome | postgres_should_return | classification_reason |
| --- | --- | --- | --- |
| Lost | lost | lost | lost rule |
| Did Not Buy | active | active | default active |
| Declined | lost | lost | lost rule |
| Dead | lost | lost | lost rule |
| Cancelled | lost | lost | lost rule |
| Lost Samples Follow-Up | lost | lost | lost rule |
| Waiting | parked | parked | parked rule |
| Waiting on Customer | parked | parked | parked rule |
| Waiting on Product | parked | parked | parked rule |
| Awaiting Materials | active | active | material/deliver exclusion |
| Material Ordered | active | active | material/deliver exclusion |
| Delivery Pending | active | active | material/deliver exclusion |
| On Hold | parked | parked | parked rule |
| Hold | parked | parked | parked rule |
| Park | parked | parked | parked rule |
| Parked | parked | parked | parked rule |
| Follow Up | active | active | default active |
| Installed | active | active | default active |
| Collect Balance | active | active | default active |

`postgres_should_return` is what Block D must return. It is not a second
classifier. It is the JavaScript result lined up against the SQL `CASE`.

## Block E — pre-migration gate (read-only)

```sql
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'workflow_stages'
  and column_name = 'outcome';

select conname
from pg_constraint
where conname = 'workflow_stages_outcome_check';
```

Both result sets must be **zero rows**. `outcome` must not already exist.

**STOP if either query returns a row.** Do not run Block F again. Re-running
0487 would classify any row that is still explicitly null.

## Block F — apply 0487

**STOP unless the operator has independently confirmed this Supabase project is STAGING and not production.**

Run this block only after Blocks A–E, and only if Block D matched the table
above. Run it once.

The statements below are the exact bytes of
`supabase/migrations/0487_workflow_stage_outcome.sql` in this commit.
SHA-256: `db8b6ed92e3fcf93d8b0b88e6c69d48f67a400e0098f2b5eb93ec2925043015f`

If that file and this block ever differ, stop. Use neither until they match.
The file is the source. Do not retype the migration.

Order inside the file, which must stay in this order:

1. `add column if not exists outcome text` with no default on the add.
2. Replace check constraint `workflow_stages_outcome_check`.
3. `UPDATE` rows where `outcome is null`.
4. `alter column outcome set default 'active'` after that update.

The column stays nullable. The default is not applied on the `ADD COLUMN`.

```sql
-- workflow_stages.outcome is the Lost/Parked authority.
-- Display names stay editable. This file does not move customers, jobs,
-- invoices, payments, tasks, or stock, and it does not insert or delete stages.
--
-- Backfill matches the application name rules in src/lib/customer-lifecycle.ts:
--   stageNameMeansLost  -> lost
--   else stageNameMeansParked -> parked
--   else -> active
-- won is allowed by the check and is not written here.
--
-- Lost name rule: lost | declin | dead | cancel (case insensitive substring).
-- Parked name rule: not material|deliver, then a word-boundary match for
-- waiting, "on hold", hold, or a word starting with park (park, parked).
-- PostgreSQL \y is the word boundary. JavaScript \b is the same test.
--
-- Rows that already have an outcome are left alone, so applying this file
-- twice does not recompute a renamed label back into a semantic change.
-- On a database that has never had the column, every existing stage is null
-- and therefore classified once.
--
-- The default is attached AFTER that classification. PostgreSQL 11+ stores a
-- constant ADD COLUMN default in the catalog and existing rows then read as
-- that default, so WHERE outcome IS NULL would classify nothing. New inserts
-- that omit the column, including the app that is running before this code
-- deploys, store active. An explicit NULL is still accepted.
--
-- Safe to re-run. Does not enable accounting.

alter table public.workflow_stages
  add column if not exists outcome text;

alter table public.workflow_stages
  drop constraint if exists workflow_stages_outcome_check;

alter table public.workflow_stages
  add constraint workflow_stages_outcome_check
  check (outcome is null or outcome in ('active', 'won', 'lost', 'parked'));

update public.workflow_stages
set outcome = case
  when coalesce(name, '') ~* 'lost|declin|dead|cancel' then 'lost'
  when coalesce(name, '') ~* 'material|deliver' then 'active'
  when coalesce(name, '') ~* $park$\ywaiting\y|\yon hold\y|\yhold\y|\ypark$park$ then 'parked'
  else 'active'
end
where outcome is null;

alter table public.workflow_stages
  alter column outcome set default 'active';
```

A successful run finishes without an error. Then run Block G immediately.

## Block G — AFTER stage results (read-only)

```sql
select id, name, position, outcome
from public.workflow_stages
order by position, id;

select
  count(*) as stage_count,
  count(*) filter (where outcome = 'active') as outcome_active,
  count(*) filter (where outcome = 'lost') as outcome_lost,
  count(*) filter (where outcome = 'parked') as outcome_parked,
  count(*) filter (where outcome = 'won') as outcome_won,
  count(*) filter (where outcome is null) as outcome_null
from public.workflow_stages;

select
  con.conname,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'workflow_stages'
  and con.conname = 'workflow_stages_outcome_check';

select
  cols.column_name,
  cols.column_default,
  cols.is_nullable,
  cols.data_type,
  pg_get_expr(ad.adbin, ad.adrelid) as attr_default
from information_schema.columns cols
join pg_catalog.pg_class rel
  on rel.relname = cols.table_name
 and rel.relkind = 'r'
join pg_catalog.pg_namespace nsp
  on nsp.oid = rel.relnamespace
 and nsp.nspname = cols.table_schema
join pg_catalog.pg_attribute att
  on att.attrelid = rel.oid
 and att.attname = cols.column_name
 and att.attnum > 0
 and not att.attisdropped
left join pg_catalog.pg_attrdef ad
  on ad.adrelid = att.attrelid
 and ad.adnum = att.attnum
where cols.table_schema = 'public'
  and cols.table_name = 'workflow_stages'
  and cols.column_name = 'outcome';
```

Expected on this first application:

- `stage_count` equals the Block B `workflow_stage_count`
- `outcome_null` is `0`
- `outcome_won` is `0`
- `outcome_active + outcome_lost + outcome_parked` equals `stage_count`
- stage `id`, `name`, and `position` match Block B
- the constraint row exists, and its definition allows null plus `active`,
  `won`, `lost`, and `parked`
- `column_default` and `attr_default` are both `'active'::text`
- `is_nullable` is `YES`

Record the catalog text itself. Do not substitute the migration file for
that proof.

**STOP if `outcome_null` is not 0, if `outcome_won` is not 0, if the default
is not `'active'::text`, or if the constraint row is missing.** Do not run
the probe transactions against a schema that failed this check. Blocks H–M
are still read-only or rolled back; Block H should still be run so the
fingerprint is recorded.

## Block H — AFTER fingerprint (read-only)

This is Block B again, unchanged. Every grid below must match Block B.

0487 is allowed to change only `workflow_stages.outcome` and the schema
metadata for that column (the check constraint and the default). The
following must be unchanged:

- workflow stage count
- stage ids
- stage names
- stage positions
- `auto_action`, `next_action`, and `sla_hours` on those rows
- customer `workflow_stage_id` distribution
- customer count
- archived customer count (`customers_with_cancelled_at`)
- customers with a non-null `workflow_stage_id`
- jobs count and jobs-by-status
- invoices count and invoices-by-status
- payments count
- `stock_movements` count and the `kind` distribution
- `office_tasks` count
- `inventory_return_allocations` count
- product reserved totals

```sql
-- F0. Table presence. Read-only.
-- If exists_in_public is false, record RELATION DOES NOT EXIST for that
-- table in the result template. Do not delete that table from the F3
-- statements below. Do not create the table.
select requested.table_name,
       (to_regclass('public.' || requested.table_name) is not null) as exists_in_public
from (values
  ('customers'),
  ('jobs'),
  ('invoices'),
  ('payments'),
  ('stock_movements'),
  ('office_tasks'),
  ('inventory_return_allocations'),
  ('workflow_stages'),
  ('products')
) as requested(table_name)
order by requested.table_name;

-- F0b. products.reserved column. Read-only.
-- Zero rows means record COLUMN DOES NOT EXIST for the reserved distribution
-- and skip only the last statement in F5. Do not rewrite that statement.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'products'
  and column_name = 'reserved';

-- F1. Workflow stages. Read-only. Outcome is omitted so this grid
-- has the same columns before and after 0487.
select id, name, position, auto_action, next_action, sla_hours
from public.workflow_stages
order by position, id;

select count(*) as workflow_stage_count
from public.workflow_stages;

-- F1b. Probe names and sentinel positions.
-- Expected: zero rows. A row here means a probe already exists.
-- Stop before Blocks I-L.
select id, name, position
from public.workflow_stages
where name like 'ZZ-0487-PROBE-%'
   or position in (900001, 900002)
order by position, id;

-- F2. Customer stage pointers. Counts only. No names, email, phone, or address.
select workflow_stage_id, count(*) as customer_count
from public.customers
group by workflow_stage_id
order by workflow_stage_id nulls first;

select
  count(*) as total_customers,
  count(*) filter (where workflow_stage_id is not null) as customers_with_workflow_stage_id,
  count(*) filter (where cancelled_at is not null) as customers_with_cancelled_at
from public.customers;

-- F3. Business data counts. One statement per table.
-- If a statement fails with SQLSTATE 42P01 undefined_table, record
-- RELATION DOES NOT EXIST for that table, then run the remaining
-- statements one at a time. Do not remove the failing statement from
-- this document and do not create the missing table.
select count(*) as customers from public.customers;
select count(*) as jobs from public.jobs;
select count(*) as invoices from public.invoices;
select count(*) as payments from public.payments;
select count(*) as stock_movements from public.stock_movements;
select count(*) as office_tasks from public.office_tasks;
select count(*) as inventory_return_allocations from public.inventory_return_allocations;

-- F4. Status distributions. Read-only.
select status::text as job_status, count(*) as job_count
from public.jobs
group by status
order by status::text;

select status::text as invoice_status, count(*) as invoice_count
from public.invoices
group by status
order by status::text;

-- F5. Stock and reservation distribution. Aggregates only. No product names.
-- stock_movements.kind includes receive, pull, adjust, return, and the
-- reserve / release kinds added later. Grouping returns whatever is stored.
select kind, count(*) as movement_count
from public.stock_movements
group by kind
order by kind;

select
  count(*) as product_count,
  count(*) filter (where reserved > 0) as products_with_reserved,
  coalesce(sum(reserved), 0) as reserved_qty_sum
from public.products;
```

**STOP if any of those differ from Block B.** Say which grid changed. Do not
try to repair it from this document.

## Block I — default is `active` (rollback only)

Run this after Block G has shown the catalog default `'active'::text`.

The insert lists `name` only. That is the only `NOT NULL` column without a
default (`0013_workflow.sql`). `position`, `color`, `auto_action`,
`sla_hours`, `id`, and `created_at` fill from their defaults. `outcome` is
omitted on purpose so the column default is what gets stored.

The `SELECT` result is returned before `ROLLBACK`. Expected: exactly one row,
`name` = `ZZ-0487-PROBE-DEFAULT`, `outcome` = `active`.

If the editor reports `there is already a transaction in progress` on
`begin`, delete that one line, keep `rollback` as the last statement, and run
the block again.

A script that ends in `rollback` must not keep the row. Block M checks that.

```sql
begin;

insert into public.workflow_stages (name)
values ('ZZ-0487-PROBE-DEFAULT');

select id, name, position, color, auto_action, sla_hours, outcome
from public.workflow_stages
where name = 'ZZ-0487-PROBE-DEFAULT'
order by id;

rollback;
```

Pass: the selected `outcome` is `active`, and Block M later returns zero rows
for this name.

## Block J — explicit null stays null (rollback only)

The insert lists `outcome` and sets it to null. Omitting the column would
store `active` instead, which is Block I.

Expected: exactly one row, `outcome` is null (an empty cell, not the word
`active`).

```sql
begin;

insert into public.workflow_stages (name, outcome)
values ('ZZ-0487-PROBE-NULL', null);

select id, name, outcome
from public.workflow_stages
where name = 'ZZ-0487-PROBE-NULL'
order by id;

rollback;
```

Pass: the selected `outcome` is null, and Block M later returns zero rows for
this name. Same `begin` troubleshooting as Block I.

## Block K — invalid value is rejected

Run the insert **alone**. The check constraint must reject it. An error
aborts the SQL Editor script, so do not put any later statement in this paste.
The failure is the pass. The successful execution of this insert would be a
failure.

```sql
insert into public.workflow_stages (name, outcome)
values ('ZZ-0487-PROBE-GARBAGE', 'garbage');
```

Expected error: check constraint `workflow_stages_outcome_check`
(SQLSTATE `23514`). The message should name that constraint. The editor
rolls the failed script back. No row is saved.

Then run this proof that nothing remained:

```sql
select count(*) as garbage_rows_remaining
from public.workflow_stages
where name = 'ZZ-0487-PROBE-GARBAGE';
```

Expected: `0`.

If the count is not `0`, the constraint did not fire and the row was stored.
Run only this delete, then repeat the count. Expected count after the delete:
`0`.

```sql
delete from public.workflow_stages
where name = 'ZZ-0487-PROBE-GARBAGE';
```

Do not broaden that delete. There is no business stage with this name.

## Block L — stored outcome does not follow a rename (rollback only)

This is a database-value demonstration. It does not run application
settlement, job cancellation, or stock release. Those paths are covered by
the B1 golden tests.

`position` is not required by the schema. It is set to `900001` and `900002`
so each probe can be told apart from a real stage that already uses the same
display name. The `UPDATE` joins the id returned by the insert. It does not
update every row named `Lost` or `Did Not Buy`.

Expected reads, in order:

1. `Lost` / `900001` / `active`
2. after the name-only update: `Lost / Declined` / `900001` / `active`
3. `Did Not Buy` / `900002` / `lost`
4. after the name-only update: `Installed` / `900002` / `lost`

`rollback` discards both rows and the temporary table.

```sql
begin;

create temporary table _0487_probe (
  label text primary key,
  id uuid not null
) on commit drop;

with inserted as (
  insert into public.workflow_stages (name, position, outcome)
  values ('Lost', 900001, 'active')
  returning id
)
insert into _0487_probe (label, id)
select 'lost_label_stays_active', id from inserted;

select s.id, s.name, s.position, s.outcome, p.label
from public.workflow_stages s
join _0487_probe p on p.id = s.id
where p.label = 'lost_label_stays_active';

update public.workflow_stages s
set name = 'Lost / Declined'
from _0487_probe p
where s.id = p.id
  and p.label = 'lost_label_stays_active';

select s.id, s.name, s.position, s.outcome, p.label
from public.workflow_stages s
join _0487_probe p on p.id = s.id
where p.label = 'lost_label_stays_active';

with inserted as (
  insert into public.workflow_stages (name, position, outcome)
  values ('Did Not Buy', 900002, 'lost')
  returning id
)
insert into _0487_probe (label, id)
select 'explicit_lost_stays_lost', id from inserted;

select s.id, s.name, s.position, s.outcome, p.label
from public.workflow_stages s
join _0487_probe p on p.id = s.id
where p.label = 'explicit_lost_stays_lost';

update public.workflow_stages s
set name = 'Installed'
from _0487_probe p
where s.id = p.id
  and p.label = 'explicit_lost_stays_lost';

select s.id, s.name, s.position, s.outcome, p.label
from public.workflow_stages s
join _0487_probe p on p.id = s.id
where p.label = 'explicit_lost_stays_lost';

rollback;
```

## Block M — probe sweep (read-only)

Run this after Blocks I, J, K, and L.

```sql
select id, name, position, outcome
from public.workflow_stages
where name in (
    'ZZ-0487-PROBE-DEFAULT',
    'ZZ-0487-PROBE-NULL',
    'ZZ-0487-PROBE-GARBAGE'
  )
   or (position = 900001 and name in ('Lost', 'Lost / Declined'))
   or (position = 900002 and name in ('Did Not Buy', 'Installed'))
order by position, id;
```

Expected: zero rows.

Compare with Block B F1b. Positions `900001` and `900002` were absent before
the probes. A row here means a probe survived. Stop and use Block N.

## Block N — cleanup only if Block M returned a row

Do not run this when Block M returned zero rows.

This deletes only the probe keys from Block M. It does not delete a real
stage named `Lost` or `Did Not Buy` at any other position.

```sql
delete from public.workflow_stages
where name in (
    'ZZ-0487-PROBE-DEFAULT',
    'ZZ-0487-PROBE-NULL',
    'ZZ-0487-PROBE-GARBAGE'
  )
   or (position = 900001 and name in ('Lost', 'Lost / Declined'))
   or (position = 900002 and name in ('Did Not Buy', 'Installed'));
```

Run Block M again. Expected: zero rows.

## Operator result template

Paste this back with the values filled in. Do not paste customer names,
email addresses, phone numbers, or addresses.

```text
Confirmed environment:
PostgreSQL version:
Stage count before:
Predicted classifications:
Representative regex table:
0487 result:
Stage count after:
Active count:
Lost count:
Parked count:
Won count:
Null count:
DB default:
Constraint:
Customer counts before/after:
Customer stage distribution before/after:
Archived customers before/after:
Jobs before/after:
Job status distribution before/after:
Invoices before/after:
Invoice status distribution before/after:
Payments before/after:
Stock movements before/after:
Office tasks before/after:
Inventory return allocations before/after:
Default-active test:
Explicit-null test:
Invalid-value test:
Any mismatches:
```

`Confirmed environment` is the dashboard confirmation that the project is
staging, plus the Block A `current_database` and `current_user`. It is not a
claim that Block A proved the project id.

`Predicted classifications` is the Block C grid.
`Representative regex table` is the Block D grid next to the JavaScript
table. `Any mismatches` is empty only when those grids agree, Block H matches
Block B, and Blocks I–M passed.
