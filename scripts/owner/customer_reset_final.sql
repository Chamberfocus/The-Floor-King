-- =============================================================================
-- FLOOR KING — FINAL CUSTOMER OPERATIONAL RESET
--
-- OWNER ACTION. Not a migration. Run the ENTIRE file in the Supabase SQL
-- editor AFTER applying supabase/migrations/0188_estimate_approval_snapshot_operational_detach.sql.
--
-- Goal: public.customers = 0. The working CRM behaves as if no customers
-- have been entered. Immutable estimate_approval_snapshots are PRESERVED
-- and detached from live customer/estimate rows (0188). Catalog, vendors,
-- staff, warehouse unattributed POs, shop-wide work_notes, accounting
-- configuration (OFF), and financial_audit_log are preserved.
--
-- Schema target: repo migrations through 0188.
-- 0136 created public.job_notes; 0137 renamed it to public.work_notes.
-- This script never references public.job_notes.
--
-- DOES NOT:
--   disable triggers
--   set session_replication_role
--   drop foreign keys
--   delete estimate_approval_snapshots
--   delete storage objects (Postgres cannot roll those back)
--   delete auth.users / staff profiles
--   enable accounting
--   wipe products / suppliers / pricing / warehouse config
--
-- If any assertion fails, the transaction rolls back.
-- If customers are already 0, the script is a documented ALREADY_CLEAN no-op.
-- =============================================================================

BEGIN;

drop table if exists _fk_reset_customers;
drop table if exists _fk_reset_jobs;
drop table if exists _fk_reset_estimates;
drop table if exists _fk_reset_invoices;
drop table if exists _fk_reset_orders;
drop table if exists _fk_reset_pos;
drop table if exists _fk_reset_before;
drop table if exists _fk_storage_inventory;
drop table if exists _fk_reset_state;

create temporary table _fk_reset_customers as
select c.id
from public.customers as c;

create temporary table _fk_reset_jobs as
select j.id
from public.jobs as j
where j.customer_id in (select id from _fk_reset_customers);

create temporary table _fk_reset_estimates as
select e.id
from public.estimates as e
where e.customer_id in (select id from _fk_reset_customers);

create temporary table _fk_reset_invoices as
select i.id
from public.invoices as i
where i.customer_id in (select id from _fk_reset_customers);

create temporary table _fk_reset_orders as
select o.id
from public.orders as o
where o.customer_id in (select id from _fk_reset_customers)
   or o.job_id in (select id from _fk_reset_jobs);

create temporary table _fk_reset_pos as
select po.id
from public.purchase_orders as po
where po.customer_id in (select id from _fk_reset_customers)
   or po.job_id in (select id from _fk_reset_jobs)
   or po.estimate_id in (select id from _fk_reset_estimates);

create temporary table _fk_reset_before as
select
  (select count(*) from _fk_reset_customers) as customers,
  (select count(*) from _fk_reset_jobs) as jobs,
  (select count(*) from _fk_reset_estimates) as estimates,
  (select count(*) from public.estimate_approval_snapshots) as snapshots,
  (select count(*) from public.products) as products,
  (select count(*) from public.suppliers) as suppliers,
  (select count(*) from public.gl_accounts) as gl_accounts,
  (select count(*) from public.profiles where role is distinct from 'customer') as staff_profiles,
  (
    select count(*) from public.purchase_orders
    where customer_id is null and job_id is null and estimate_id is null
  ) as warehouse_pos,
  (select count(*) from public.financial_audit_log) as financial_audit_log,
  (select count(*) from public.workflow_stages) as workflow_stages,
  (select count(*) from public.org_settings) as org_settings,
  (select posting_enabled from public.accounting_settings where id = 1) as posting_enabled,
  (select books_of_record from public.accounting_settings where id = 1) as books_of_record;

create temporary table _fk_storage_inventory as
select
  'documents'::text as kind,
  d.id,
  d.path,
  d.customer_id,
  d.job_id
from public.documents as d
where d.customer_id in (select id from _fk_reset_customers)
   or d.job_id in (select id from _fk_reset_jobs)
union all
select
  'job_files',
  jf.id,
  jf.path,
  null,
  jf.job_id
from public.job_files as jf
where jf.job_id in (select id from _fk_reset_jobs);

create temporary table _fk_reset_state (
  already_clean boolean not null
);

insert into _fk_reset_state (already_clean)
select (select customers from _fk_reset_before) = 0;

select
  'customers_before' as item,
  customers as n
from _fk_reset_before
union all
select 'snapshots_before', snapshots from _fk_reset_before
union all
select 'jobs_before', jobs from _fk_reset_before
union all
select 'estimates_before', estimates from _fk_reset_before
union all
select 'storage_objects_inventoried_not_deleted', (
  select count(*) from _fk_storage_inventory
)
union all
select 'already_clean', case when already_clean then 1 else 0 end
from _fk_reset_state
order by 1;

do $assert$
declare
  s record;
  b record;
  n bigint;
  attnotnull boolean;
  deltype char;
  already boolean;
begin
  if current_setting('session_replication_role', true) is distinct from 'origin' then
    raise exception
      'RESET ABORTED: session_replication_role is %, triggers/FKs would be bypassed.',
      current_setting('session_replication_role', true);
  end if;

  if exists (
    select 1
    from pg_trigger as t
    join pg_class as c on c.oid = t.tgrelid
    join pg_namespace as ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname = 'estimate_approval_snapshots'
      and t.tgname in (
        'estimate_approval_snapshots_no_delete',
        'estimate_approval_snapshots_immutable'
      )
      and t.tgenabled = 'D'
  ) then
    raise exception 'RESET ABORTED: estimate_approval_snapshots triggers are DISABLED.';
  end if;

  if not exists (
    select 1
    from pg_trigger as t
    join pg_class as c on c.oid = t.tgrelid
    join pg_namespace as ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname = 'estimate_approval_snapshots'
      and t.tgname = 'estimate_approval_snapshots_no_delete'
      and t.tgenabled in ('O', 'A')
  ) then
    raise exception 'RESET ABORTED: snapshot no-delete trigger is missing or not enabled.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'estimate_approval_snapshots'
      and column_name = 'historical_estimate_id'
  ) then
    raise exception
      'RESET ABORTED: apply migration 0188 first (historical_estimate_id missing).';
  end if;

  select a.attnotnull into attnotnull
  from pg_attribute as a
  join pg_class as c on c.oid = a.attrelid
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'estimate_approval_snapshots'
    and a.attname = 'estimate_id'
    and a.attnum > 0
    and not a.attisdropped;
  if attnotnull is not false then
    raise exception
      'RESET ABORTED: apply migration 0188 first (estimate_id is still NOT NULL).';
  end if;

  select c.confdeltype into deltype
  from pg_constraint as c
  join pg_class as t on t.oid = c.conrelid
  join pg_class as ft on ft.oid = c.confrelid
  join pg_namespace as n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'estimate_approval_snapshots'
    and ft.relname = 'estimates'
    and c.contype = 'f'
  limit 1;
  if deltype is distinct from 'n' then
    raise exception
      'RESET ABORTED: apply migration 0188 first (estimate_id FK is not ON DELETE SET NULL).';
  end if;

  select * into s from public.accounting_settings where id = 1;
  if not found then
    raise exception 'RESET ABORTED: accounting_settings row id=1 missing.';
  end if;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.inventory_posting_enabled, false)
     or coalesce(s.ap_posting_enabled, false)
     or coalesce(s.installer_posting_enabled, false)
     or coalesce(s.invoice_posting_enabled, false)
     or coalesce(s.payment_posting_enabled, false)
     or coalesce(s.credit_posting_enabled, false)
     or coalesce(s.expense_posting_enabled, false)
     or coalesce(s.deposit_posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or coalesce(s.opening_balances_entered, false)
     or coalesce(s.accountant_validated, false)
     or s.cutover_date is not null then
    raise exception 'RESET ABORTED: accounting flags are ON/set. Will not clear customers.';
  end if;

  select already_clean into already from _fk_reset_state;
  select * into b from _fk_reset_before;

  if already then
    raise notice 'CUSTOMER RESET ALREADY_CLEAN: customers already 0. No-op.';
    return;
  end if;

  n := (select count(*) from public.invoices where status in ('sent', 'partial', 'paid'));
  if n <> 0 then
    raise exception 'RESET ABORTED: % issued invoices (sent/partial/paid) exist.', n;
  end if;

  n := (select count(*) from public.payments);
  if n <> 0 then
    raise exception 'RESET ABORTED: % payments exist.', n;
  end if;

  n := (select count(*) from public.credit_memos);
  if n <> 0 then
    raise exception 'RESET ABORTED: % credit_memos exist.', n;
  end if;

  n := (select count(*) from public.refunds);
  if n <> 0 then
    raise exception 'RESET ABORTED: % refunds exist.', n;
  end if;

  n := (select count(*) from public.customer_deposits);
  if n <> 0 then
    raise exception 'RESET ABORTED: % customer_deposits exist.', n;
  end if;

  n := (select count(*) from public.customer_deposit_applications);
  if n <> 0 then
    raise exception 'RESET ABORTED: % customer_deposit_applications exist.', n;
  end if;

  n := (select count(*) from public.credit_applications);
  if n <> 0 then
    raise exception 'RESET ABORTED: % credit_applications exist.', n;
  end if;

  n := (select count(*) from public.opening_ar_items);
  if n <> 0 then
    raise exception 'RESET ABORTED: % opening_ar_items exist.', n;
  end if;

  n := (select count(*) from public.invoice_write_offs);
  if n <> 0 then
    raise exception 'RESET ABORTED: % invoice_write_offs exist.', n;
  end if;

  n := (
    select count(*) from public.installer_bills
    where job_id in (select id from _fk_reset_jobs)
      and status is distinct from 'draft'
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % non-draft installer_bills exist (immutability trigger would block job delete).',
      n;
  end if;

  n := (
    select count(*) from public.bills
    where customer_id in (select id from _fk_reset_customers)
       or job_id in (select id from _fk_reset_jobs)
       or po_id in (select id from _fk_reset_pos)
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % vendor bills are tied to customers/jobs/customer POs (AP immutability).',
      n;
  end if;

  n := (
    select count(*) from public.journal_lines
    where customer_id in (select id from _fk_reset_customers)
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % journal_lines still carry reset customer_id.', n;
  end if;

  n := (
    select count(*) from public.journal_entries as je
    where je.source_id in (select id from _fk_reset_invoices)
       or je.source_id in (select id from public.payments)
       or je.source_id in (select id from _fk_reset_customers)
       or je.source_id in (select id from public.credit_memos)
       or je.source_id in (select id from public.refunds)
       or je.source_id in (select id from public.customer_deposits)
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % journal_entries are tied to customer money records.', n;
  end if;

  n := (
    select count(*) from public.stock_movements as sm
    where sm.customer_id in (select id from _fk_reset_customers)
       or sm.job_id in (select id from _fk_reset_jobs)
       or sm.po_id in (select id from _fk_reset_pos)
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % stock_movements are tied to customers/jobs/customer POs. Inventory will not be reversed or deleted.',
      n;
  end if;

  raise notice
    'CUSTOMER RESET running: customers=%, snapshots_preserved=%, storage_objects_inventoried=% (NOT deleted).',
    b.customers,
    b.snapshots,
    (select count(*) from _fk_storage_inventory);
end;
$assert$;

-- Fill frozen historical identity, then detach live FKs.
-- Allowed by 0188: historical fill-once + estimate_id/approved_by_customer_id to NULL.
update public.estimate_approval_snapshots as s
set
  historical_estimate_id = coalesce(
    s.historical_estimate_id,
    s.estimate_id,
    nullif(s.payload->>'estimate_id', '')::uuid
  ),
  historical_customer_id = coalesce(
    s.historical_customer_id,
    e.customer_id,
    s.approved_by_customer_id,
    nullif(s.payload->>'customer_id', '')::uuid
  ),
  historical_customer_name = coalesce(
    s.historical_customer_name,
    c.full_name
  ),
  estimate_id = null,
  approved_by_customer_id = null
from public.estimates as e
left join public.customers as c
  on c.id = e.customer_id
where s.estimate_id = e.id
  and e.id in (select id from _fk_reset_estimates);

update public.estimate_approval_snapshots as s
set approved_by_customer_id = null
where s.approved_by_customer_id in (select id from _fk_reset_customers);

-- Self-FK must be cleared before customer rows can be deleted (NO ACTION).
update public.customers
   set referred_by_customer_id = null
 where id in (select id from _fk_reset_customers)
   and referred_by_customer_id is not null;

-- Portal links: keep the login/profile; drop the customer pointer.
-- Do not delete auth.users or staff profiles.
update public.profiles
   set customer_id = null
 where customer_id in (select id from _fk_reset_customers);

-- RESTRICT child: service callbacks.
delete from public.service_callbacks
 where customer_id in (select id from _fk_reset_customers);

delete from public.customer_duplicate_overrides
 where created_customer_id in (select id from _fk_reset_customers)
    or matched_customer_id in (select id from _fk_reset_customers);

-- Customer-linked office tasks (SET NULL FK; delete so they do not linger).
delete from public.office_tasks
 where customer_id in (select id from _fk_reset_customers)
    or job_id in (select id from _fk_reset_jobs)
    or estimate_id in (select id from _fk_reset_estimates);

-- Work notes (renamed from job_notes in 0137). Keep shop-wide rows
-- (job_id and po_id both null).
delete from public.work_notes
 where job_id in (select id from _fk_reset_jobs)
    or po_id in (select id from _fk_reset_pos);

delete from public.job_schedule_overrides
 where job_id in (select id from _fk_reset_jobs);

-- Orders SET NULL on customer/job delete — remove them so they do not
-- become anonymous leftover orders.
delete from public.orders
 where id in (select id from _fk_reset_orders);

update public.po_items
   set for_customer_id = null,
       for_job_id = null
 where for_customer_id in (select id from _fk_reset_customers)
    or for_job_id in (select id from _fk_reset_jobs);

-- Customer/job/estimate POs. Warehouse unattributed POs are kept.
-- Safe because stock_movements on these POs were asserted to be zero.
delete from public.purchase_orders
 where id in (select id from _fk_reset_pos);

delete from public.installer_bills
 where job_id in (select id from _fk_reset_jobs)
   and status = 'draft';

delete from public.expenses
 where job_id in (select id from _fk_reset_jobs);

-- Draft/void invoices only (issued/paid already asserted empty).
delete from public.invoice_items
 where invoice_id in (select id from _fk_reset_invoices);

delete from public.invoices
 where id in (select id from _fk_reset_invoices);

-- Document metadata for reset customers/jobs. Storage objects are NOT
-- deleted here (Postgres cannot roll Storage back).
delete from public.documents
 where customer_id in (select id from _fk_reset_customers)
    or job_id in (select id from _fk_reset_jobs);

delete from public.job_files
 where job_id in (select id from _fk_reset_jobs);

-- Remaining operational children CASCADE from customers
-- (jobs, estimates, activities, messages, documents metadata, appointments,
--  addresses, samples, areas, handoffs, drafts, step_overrides, etc.).
-- Snapshots are already detached, so CASCADE/SET NULL cannot delete them.
delete from public.customers
 where id in (select id from _fk_reset_customers);

do $verify$
declare
  b record;
  n bigint;
  already boolean;
begin
  select already_clean into already from _fk_reset_state;
  select * into b from _fk_reset_before;

  n := (select count(*) from public.customers);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % customers remain.', n;
  end if;

  n := (select count(*) from public.jobs);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % jobs remain.', n;
  end if;

  n := (select count(*) from public.estimates);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % estimates remain.', n;
  end if;

  n := (
    select count(*) from public.orders
    where customer_id in (select id from _fk_reset_customers)
       or job_id in (select id from _fk_reset_jobs)
  );
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % customer/job orders remain.', n;
  end if;

  n := (
    select count(*) from public.appointments
    where customer_id is not null
  );
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % customer appointments remain.', n;
  end if;

  n := (select count(*) from public.activities);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % activities remain.', n;
  end if;

  n := (select count(*) from public.handoffs);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % handoffs remain.', n;
  end if;

  n := (select count(*) from public.messages);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % messages remain.', n;
  end if;

  n := (select count(*) from public.service_addresses);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % service_addresses remain.', n;
  end if;

  n := (select count(*) from public.customer_areas);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % customer_areas remain.', n;
  end if;

  n := (select count(*) from public.sample_checkouts);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % sample_checkouts remain.', n;
  end if;

  n := (select count(*) from public.service_callbacks);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % service_callbacks remain.', n;
  end if;

  n := (
    select count(*) from public.documents
    where customer_id is not null
       or job_id is not null
  );
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % customer/job documents remain.', n;
  end if;

  n := (select count(*) from public.job_files);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % job_files remain.', n;
  end if;

  n := (
    select count(*) from public.office_tasks
    where customer_id is not null
       or job_id is not null
       or estimate_id is not null
  );
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % customer office_tasks remain.', n;
  end if;

  n := (select count(*) from public.profiles where customer_id is not null);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % profiles still point at customers.', n;
  end if;

  n := (select count(*) from public.estimate_approval_snapshots);
  if n <> b.snapshots then
    raise exception
      'RESET ABORTED: snapshot count changed from % to % (snapshots are append-only).',
      b.snapshots,
      n;
  end if;

  if b.snapshots > 0 then
    n := (
      select count(*) from public.estimate_approval_snapshots
      where estimate_id is not null or approved_by_customer_id is not null
    );
    if n <> 0 then
      raise exception
        'RESET INCOMPLETE: % snapshots still attached to live estimate/customer FKs.',
        n;
    end if;
  end if;

  n := (select count(*) from public.invoices where status in ('sent', 'partial', 'paid'));
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: issued invoices are no longer zero.';
  end if;
  n := (select count(*) from public.payments);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: payments are no longer zero.';
  end if;
  n := (select count(*) from public.credit_memos);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: credit_memos are no longer zero.';
  end if;
  n := (select count(*) from public.refunds);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: refunds are no longer zero.';
  end if;
  n := (select count(*) from public.customer_deposits);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: customer_deposits are no longer zero.';
  end if;
  n := (select count(*) from public.opening_ar_items);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: opening_ar_items are no longer zero.';
  end if;
  n := (select count(*) from public.invoice_write_offs);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: invoice_write_offs are no longer zero.';
  end if;

  if (select count(*) from public.products) <> b.products then
    raise exception 'RESET ABORTED: product catalog count changed.';
  end if;
  if (select count(*) from public.suppliers) <> b.suppliers then
    raise exception 'RESET ABORTED: supplier catalog count changed.';
  end if;
  if (select count(*) from public.gl_accounts) <> b.gl_accounts then
    raise exception 'RESET ABORTED: gl_accounts count changed.';
  end if;
  if (select count(*) from public.profiles where role is distinct from 'customer')
       <> b.staff_profiles then
    raise exception 'RESET ABORTED: staff profile count changed.';
  end if;
  if (
    select count(*) from public.purchase_orders
    where customer_id is null and job_id is null and estimate_id is null
  ) <> b.warehouse_pos then
    raise exception 'RESET ABORTED: warehouse unattributed PO count changed.';
  end if;
  if (select count(*) from public.financial_audit_log) <> b.financial_audit_log then
    raise exception 'RESET ABORTED: financial_audit_log was mutated.';
  end if;
  if (select count(*) from public.workflow_stages) <> b.workflow_stages then
    raise exception 'RESET ABORTED: workflow_stages count changed.';
  end if;
  if (select count(*) from public.org_settings) <> b.org_settings then
    raise exception 'RESET ABORTED: org_settings count changed.';
  end if;
  if (select posting_enabled from public.accounting_settings where id = 1)
       is distinct from b.posting_enabled
     or (select books_of_record from public.accounting_settings where id = 1)
       is distinct from b.books_of_record then
    raise exception 'RESET ABORTED: accounting flags changed.';
  end if;

  if exists (
    select 1
    from pg_trigger as t
    join pg_class as c on c.oid = t.tgrelid
    join pg_namespace as ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname = 'estimate_approval_snapshots'
      and t.tgname in (
        'estimate_approval_snapshots_no_delete',
        'estimate_approval_snapshots_immutable'
      )
      and t.tgenabled = 'D'
  ) then
    raise exception 'RESET ABORTED: snapshot triggers were disabled during the run.';
  end if;

  if current_setting('session_replication_role', true) is distinct from 'origin' then
    raise exception 'RESET ABORTED: session_replication_role changed during the run.';
  end if;

  if already then
    raise notice 'CUSTOMER RESET ALREADY_CLEAN verified: customers=0.';
  else
    raise notice
      'CUSTOMER RESET complete: customers  % → 0; snapshots preserved=%; storage objects not deleted=%',
      b.customers,
      b.snapshots,
      (select count(*) from _fk_storage_inventory);
  end if;
end;
$verify$;

COMMIT;

-- Post-commit confirmation (read-only). Storage objects were NOT deleted.
select 'customers' as item, count(*)::bigint as n from public.customers
union all select 'jobs', count(*) from public.jobs
union all select 'estimates', count(*) from public.estimates
union all select 'invoices', count(*) from public.invoices
union all select 'payments', count(*) from public.payments
union all select 'credit_memos', count(*) from public.credit_memos
union all select 'refunds', count(*) from public.refunds
union all select 'customer_deposits', count(*) from public.customer_deposits
union all select 'opening_ar_items', count(*) from public.opening_ar_items
union all select 'invoice_write_offs', count(*) from public.invoice_write_offs
union all select 'appointments', count(*) from public.appointments
union all select 'activities', count(*) from public.activities
union all select 'handoffs', count(*) from public.handoffs
union all select 'messages', count(*) from public.messages
union all select 'service_addresses', count(*) from public.service_addresses
union all select 'customer_areas', count(*) from public.customer_areas
union all select 'sample_checkouts', count(*) from public.sample_checkouts
union all select 'service_callbacks', count(*) from public.service_callbacks
union all select 'estimate_approval_snapshots', count(*) from public.estimate_approval_snapshots
union all select 'snapshots_still_attached', (
  select count(*) from public.estimate_approval_snapshots
  where estimate_id is not null or approved_by_customer_id is not null
)
union all select 'warehouse_pos', (
  select count(*) from public.purchase_orders
  where customer_id is null and job_id is null and estimate_id is null
)
union all select 'products', count(*) from public.products
union all select 'suppliers', count(*) from public.suppliers
union all select 'staff_profiles', (
  select count(*) from public.profiles where role is distinct from 'customer'
)
union all select 'portal_customer_profiles_unlinked', (
  select count(*) from public.profiles where role = 'customer'
)
union all select 'accounting_posting_enabled', (
  select case when posting_enabled then 1 else 0 end
  from public.accounting_settings where id = 1
)
union all select 'snapshot_no_delete_enabled', (
  select count(*)
  from pg_trigger as t
  join pg_class as c on c.oid = t.tgrelid
  join pg_namespace as ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relname = 'estimate_approval_snapshots'
    and t.tgname = 'estimate_approval_snapshots_no_delete'
    and t.tgenabled in ('O', 'A')
)
order by 1;
