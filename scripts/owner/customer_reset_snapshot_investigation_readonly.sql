-- =============================================================================
-- FLOOR KING — SNAPSHOT BLOCKER INVESTIGATION (READ-ONLY)
-- Paste the ENTIRE file into the production Supabase SQL Editor and Run.
--
-- One file. Several short independent SELECT statements.
-- Does NOT delete, update, insert, alter, drop, truncate, call mutating RPCs,
-- disable triggers, or change session_replication_role.
-- =============================================================================

-- 1) The two (or more) approval snapshots and their customer/estimate.
select
  s.id as snapshot_id,
  e.id as estimate_id,
  c.id as customer_id,
  c.full_name as customer_name,
  e.status::text as estimate_status,
  s.created_at as snapshot_created_at,
  s.approved_at as snapshot_approved_at,
  s.approval_source,
  s.version as snapshot_version,
  s.approved_by_customer_id,
  e.approved_at as estimate_approved_at,
  e.current_approval_snapshot_id,
  (
    e.status::text = 'approved'
    or e.approved_at is not null
    or e.current_approval_snapshot_id is not null
  ) as estimate_has_approval_history,
  (e.current_approval_snapshot_id = s.id) as snapshot_is_current_on_estimate
from public.estimate_approval_snapshots as s
join public.estimates as e
  on e.id = s.estimate_id
join public.customers as c
  on c.id = e.customer_id
order by s.created_at, s.id;

-- 2) Related job / order / invoice ids for those snapshot customers.
select
  s.id as snapshot_id,
  e.id as estimate_id,
  c.id as customer_id,
  (
    select string_agg(j.id::text, ', ' order by j.created_at, j.id)
    from public.jobs as j
    where j.customer_id = c.id
       or j.estimate_id = e.id
  ) as related_job_ids,
  (
    select string_agg(o.id::text, ', ' order by o.created_at, o.id)
    from public.orders as o
    where o.customer_id = c.id
       or o.job_id in (
         select j.id from public.jobs as j
         where j.customer_id = c.id or j.estimate_id = e.id
       )
  ) as related_order_ids,
  (
    select string_agg(i.id::text, ', ' order by i.created_at, i.id)
    from public.invoices as i
    where i.customer_id = c.id
       or i.estimate_id = e.id
       or i.approval_snapshot_id = s.id
  ) as related_invoice_ids
from public.estimate_approval_snapshots as s
join public.estimates as e
  on e.id = s.estimate_id
join public.customers as c
  on c.id = e.customer_id
order by s.created_at, s.id;

-- 3) Exact FKs among snapshots, estimates, and customers.
select
  con.conname as constraint_name,
  rel_child.relname as child_table,
  rel_parent.relname as parent_table,
  case con.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else con.confdeltype::text
  end as on_delete,
  pg_catalog.pg_get_constraintdef(con.oid) as constraint_def
from pg_catalog.pg_constraint as con
join pg_catalog.pg_class as rel_child
  on rel_child.oid = con.conrelid
join pg_catalog.pg_namespace as nsp_child
  on nsp_child.oid = rel_child.relnamespace
join pg_catalog.pg_class as rel_parent
  on rel_parent.oid = con.confrelid
join pg_catalog.pg_namespace as nsp_parent
  on nsp_parent.oid = rel_parent.relnamespace
where con.contype = 'f'
  and nsp_child.nspname = 'public'
  and nsp_parent.nspname = 'public'
  and (
    (
      rel_child.relname = 'estimate_approval_snapshots'
      and rel_parent.relname in ('estimates', 'customers')
    )
    or
    (
      rel_child.relname = 'estimates'
      and rel_parent.relname in ('customers', 'estimate_approval_snapshots')
    )
  )
order by child_table, parent_table, constraint_name;

-- 4) Every FK that POINTS AT estimate_approval_snapshots.
select
  con.conname as constraint_name,
  rel_child.relname as from_table,
  case con.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else con.confdeltype::text
  end as on_delete,
  pg_catalog.pg_get_constraintdef(con.oid) as constraint_def
from pg_catalog.pg_constraint as con
join pg_catalog.pg_class as rel_child
  on rel_child.oid = con.conrelid
join pg_catalog.pg_namespace as nsp_child
  on nsp_child.oid = rel_child.relnamespace
join pg_catalog.pg_class as rel_parent
  on rel_parent.oid = con.confrelid
join pg_catalog.pg_namespace as nsp_parent
  on nsp_parent.oid = rel_parent.relnamespace
where con.contype = 'f'
  and nsp_child.nspname = 'public'
  and nsp_parent.nspname = 'public'
  and rel_parent.relname = 'estimate_approval_snapshots'
order by from_table, constraint_name;

-- 5) Triggers on estimate_approval_snapshots.
select
  t.tgname as trigger_name,
  case t.tgenabled
    when 'O' then 'enabled_origin'
    when 'A' then 'enabled_always'
    when 'R' then 'enabled_replica'
    when 'D' then 'DISABLED'
    else t.tgenabled::text
  end as trigger_state,
  pg_catalog.pg_get_triggerdef(t.oid) as trigger_def
from pg_catalog.pg_trigger as t
join pg_catalog.pg_class as c
  on c.oid = t.tgrelid
join pg_catalog.pg_namespace as n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'estimate_approval_snapshots'
  and not t.tgisinternal
order by t.tgname;

-- 6) Preservation verdict from live catalog (read-only).
select
  (select count(*)::bigint from public.estimate_approval_snapshots) as snapshot_count,
  (
    select count(distinct e.customer_id)::bigint
    from public.estimate_approval_snapshots as s
    join public.estimates as e on e.id = s.estimate_id
  ) as distinct_customers_holding_snapshots,
  (
    select count(*)::bigint
    from public.customers as c
    where not exists (
      select 1
      from public.estimate_approval_snapshots as s
      join public.estimates as e on e.id = s.estimate_id
      where e.customer_id = c.id
    )
  ) as other_customers_without_snapshots,
  exists (
    select 1
    from pg_catalog.pg_constraint as con
    join pg_catalog.pg_class as rel_child on rel_child.oid = con.conrelid
    join pg_catalog.pg_namespace as nsp_child on nsp_child.oid = rel_child.relnamespace
    join pg_catalog.pg_class as rel_parent on rel_parent.oid = con.confrelid
    join pg_catalog.pg_namespace as nsp_parent on nsp_parent.oid = rel_parent.relnamespace
    where con.contype = 'f'
      and nsp_child.nspname = 'public'
      and rel_child.relname = 'estimate_approval_snapshots'
      and nsp_parent.nspname = 'public'
      and rel_parent.relname = 'estimates'
      and con.confdeltype = 'c'
  ) as estimate_delete_attempts_snapshot_delete,
  exists (
    select 1
    from pg_catalog.pg_constraint as con
    join pg_catalog.pg_class as rel_child on rel_child.oid = con.conrelid
    join pg_catalog.pg_namespace as nsp_child on nsp_child.oid = rel_child.relnamespace
    join pg_catalog.pg_class as rel_parent on rel_parent.oid = con.confrelid
    join pg_catalog.pg_namespace as nsp_parent on nsp_parent.oid = rel_parent.relnamespace
    where con.contype = 'f'
      and nsp_child.nspname = 'public'
      and rel_child.relname = 'estimates'
      and nsp_parent.nspname = 'public'
      and rel_parent.relname = 'customers'
      and con.confdeltype = 'c'
  ) as customer_delete_attempts_estimate_delete,
  exists (
    select 1
    from pg_catalog.pg_trigger as t
    join pg_catalog.pg_class as c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'estimate_approval_snapshots'
      and t.tgname = 'estimate_approval_snapshots_no_delete'
      and t.tgenabled is distinct from 'D'
      and not t.tgisinternal
  ) as no_delete_trigger_enabled,
  exists (
    select 1
    from pg_catalog.pg_trigger as t
    join pg_catalog.pg_class as c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'estimate_approval_snapshots'
      and t.tgname = 'estimate_approval_snapshots_immutable'
      and t.tgenabled is distinct from 'D'
      and not t.tgisinternal
  ) as immutable_trigger_enabled,
  false as can_preserve_snapshots_while_deleting_those_customers,
  'KEEP_PROTECTED_CUSTOMER_HISTORY' as recommendation;
