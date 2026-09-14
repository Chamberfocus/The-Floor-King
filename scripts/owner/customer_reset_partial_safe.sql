-- =============================================================================
-- FLOOR KING — PARTIAL CUSTOMER RESET (KEEP SNAPSHOT-PROTECTED CUSTOMERS)
--
-- OWNER ACTION. Run ONLY after customer_reset_preflight_readonly.sql shows
-- the sole blocker is estimate_approval_snapshots, and you have reviewed
-- the protected vs deletable customer counts this script prints first.
--
-- Schema target: repo migrations through 0187.
-- 0136 created public.job_notes; 0137 renamed it to public.work_notes.
-- This script never references public.job_notes.
--
-- Same fail-closed path as customer_reset_safe.sql, scoped to customers
-- who are NOT linked to estimate_approval_snapshots.
--
-- Protected customers:
--   distinct estimates.customer_id for rows in estimate_approval_snapshots
--   UNION snapshot.approved_by_customer_id when not null
-- Those customers, their estimates, snapshots, and related history stay.
--
-- NOT a migration. Does NOT disable triggers. Does NOT bypass foreign keys.
-- Does NOT change accounting flags. Does NOT delete storage objects.
-- Does NOT delete catalog, vendors, inventory master, staff, warehouse
-- unattributed purchase orders, shop-wide work_notes, or snapshot history.
--
-- If any safety assertion fails, the transaction rolls back.
-- =============================================================================

BEGIN;

drop table if exists _fk_protected_customers;
drop table if exists _fk_safe_customers;
drop table if exists _fk_safe_jobs;
drop table if exists _fk_safe_estimates;
drop table if exists _fk_safe_invoices;
drop table if exists _fk_safe_pos;
drop table if exists _fk_reset_before;

create temporary table _fk_protected_customers as
select distinct x.id
from (
  select e.customer_id as id
  from public.estimate_approval_snapshots as s
  join public.estimates as e
    on e.id = s.estimate_id
  union
  select s.approved_by_customer_id as id
  from public.estimate_approval_snapshots as s
  where s.approved_by_customer_id is not null
) as x
where x.id is not null;

create temporary table _fk_safe_customers as
select c.id
from public.customers as c
where not exists (
  select 1
  from _fk_protected_customers as p
  where p.id = c.id
);

create temporary table _fk_safe_jobs as
select j.id
from public.jobs as j
where j.customer_id in (select id from _fk_safe_customers);

create temporary table _fk_safe_estimates as
select e.id
from public.estimates as e
where e.customer_id in (select id from _fk_safe_customers);

create temporary table _fk_safe_invoices as
select i.id
from public.invoices as i
where i.customer_id in (select id from _fk_safe_customers);

create temporary table _fk_safe_pos as
select po.id
from public.purchase_orders as po
where po.customer_id in (select id from _fk_safe_customers)
   or po.job_id in (select id from _fk_safe_jobs)
   or po.estimate_id in (select id from _fk_safe_estimates);

create temporary table _fk_reset_before as
select
  (select count(*) from public.customers) as customers_total,
  (select count(*) from _fk_protected_customers) as customers_protected,
  (select count(*) from _fk_safe_customers) as customers_deletable,
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
  (select posting_enabled from public.accounting_settings where id = 1) as posting_enabled,
  (select books_of_record from public.accounting_settings where id = 1) as books_of_record;

select
  'customers_total' as item,
  customers_total as n
from _fk_reset_before
union all
select 'customers_protected', customers_protected from _fk_reset_before
union all
select 'customers_deletable', customers_deletable from _fk_reset_before
union all
select 'snapshots_kept', snapshots from _fk_reset_before
order by 1;

do $assert$
declare
  s record;
  b record;
  n bigint;
begin
  if current_setting('session_replication_role', true) is distinct from 'origin' then
    raise exception
      'RESET ABORTED: session_replication_role is %, triggers/FKs would be bypassed.',
      current_setting('session_replication_role', true);
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
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
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname = 'estimate_approval_snapshots'
      and t.tgname = 'estimate_approval_snapshots_no_delete'
      and t.tgenabled in ('O', 'A')
  ) then
    raise exception 'RESET ABORTED: snapshot no-delete trigger is missing or not enabled.';
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

  select * into b from _fk_reset_before;

  if b.customers_total = 0 then
    raise exception 'RESET ABORTED: no customers to remove (nothing to do).';
  end if;

  if b.customers_protected = 0 then
    raise exception
      'RESET ABORTED: no snapshot-protected customers. Use customer_reset_safe.sql instead.';
  end if;

  if b.customers_deletable = 0 then
    raise exception 'RESET ABORTED: every customer is snapshot-protected. Nothing safe to delete.';
  end if;

  if b.snapshots = 0 then
    raise exception 'RESET ABORTED: expected protected snapshots; found none.';
  end if;

  n := (
    select count(*)
    from public.estimate_approval_snapshots as snap
    join public.estimates as e on e.id = snap.estimate_id
    where e.customer_id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % snapshots are tied to customers marked deletable.',
      n;
  end if;

  n := (
    select count(*)
    from public.estimate_approval_snapshots as snap
    where snap.approved_by_customer_id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % snapshots have approved_by_customer_id in the deletable set.',
      n;
  end if;

  n := (
    select count(*)
    from public.invoices
    where customer_id in (select id from _fk_safe_customers)
      and status in ('sent', 'partial', 'paid')
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % issued invoices on deletable customers.', n;
  end if;

  n := (
    select count(*)
    from public.payments
    where invoice_id in (select id from _fk_safe_invoices)
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % payments on deletable-customer invoices.', n;
  end if;

  n := (
    select count(*) from public.credit_memos
    where customer_id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % credit_memos on deletable customers.', n;
  end if;

  n := (
    select count(*) from public.refunds
    where customer_id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % refunds on deletable customers.', n;
  end if;

  n := (
    select count(*) from public.customer_deposits
    where customer_id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % customer_deposits on deletable customers.', n;
  end if;

  n := (
    select count(*) from public.customer_deposit_applications
    where deposit_id in (
      select id from public.customer_deposits
      where customer_id in (select id from _fk_safe_customers)
    )
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % customer_deposit_applications on deletable customers.', n;
  end if;

  n := (
    select count(*) from public.credit_applications
    where credit_memo_id in (
      select id from public.credit_memos
      where customer_id in (select id from _fk_safe_customers)
    )
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % credit_applications on deletable customers.', n;
  end if;

  n := (
    select count(*) from public.opening_ar_items
    where customer_id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % opening_ar_items on deletable customers.', n;
  end if;

  n := (
    select count(*) from public.invoice_write_offs
    where invoice_id in (select id from _fk_safe_invoices)
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % invoice_write_offs on deletable customers.', n;
  end if;

  n := (
    select count(*) from public.installer_bills
    where job_id in (select id from _fk_safe_jobs)
      and status is distinct from 'draft'
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % non-draft installer_bills on deletable-customer jobs.',
      n;
  end if;

  n := (
    select count(*) from public.bills
    where customer_id in (select id from _fk_safe_customers)
       or job_id in (select id from _fk_safe_jobs)
       or po_id in (select id from _fk_safe_pos)
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % vendor bills are tied to deletable customers/jobs/POs.',
      n;
  end if;

  n := (
    select count(*) from public.journal_lines
    where customer_id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % journal_lines still carry a deletable customer_id.', n;
  end if;

  n := (
    select count(*) from public.journal_entries je
    where je.source_id in (select id from _fk_safe_invoices)
       or je.source_id in (
         select p.id from public.payments p
         where p.invoice_id in (select id from _fk_safe_invoices)
       )
       or je.source_id in (select id from _fk_safe_customers)
       or je.source_id in (
         select cm.id from public.credit_memos cm
         where cm.customer_id in (select id from _fk_safe_customers)
       )
       or je.source_id in (
         select r.id from public.refunds r
         where r.customer_id in (select id from _fk_safe_customers)
       )
       or je.source_id in (
         select d.id from public.customer_deposits d
         where d.customer_id in (select id from _fk_safe_customers)
       )
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % journal_entries are tied to deletable-customer money records.', n;
  end if;

  n := (
    select count(*) from public.stock_movements sm
    where sm.customer_id in (select id from _fk_safe_customers)
       or sm.job_id in (select id from _fk_safe_jobs)
       or sm.po_id in (select id from _fk_safe_pos)
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % stock_movements are tied to deletable customers/jobs/POs.',
      n;
  end if;
end;
$assert$;

-- Self-FK: clear pointers that would block deleting the safe set (NO ACTION).
-- Do not rewrite referred_by among protected customers.
update public.customers
   set referred_by_customer_id = null
 where id in (select id from _fk_safe_customers)
    or referred_by_customer_id in (select id from _fk_safe_customers);

-- Portal links for deletable customers only. Keep protected customer_id.
update public.profiles
   set customer_id = null
 where customer_id in (select id from _fk_safe_customers);

delete from public.service_callbacks
 where customer_id in (select id from _fk_safe_customers);

delete from public.office_tasks
 where (customer_id in (select id from _fk_safe_customers)
     or job_id in (select id from _fk_safe_jobs)
     or estimate_id in (select id from _fk_safe_estimates))
   and (customer_id is null or customer_id in (select id from _fk_safe_customers))
   and (job_id is null or job_id in (select id from _fk_safe_jobs))
   and (estimate_id is null or estimate_id in (select id from _fk_safe_estimates));

delete from public.work_notes
 where (
         job_id in (select id from _fk_safe_jobs)
         or po_id in (select id from _fk_safe_pos)
       )
   and (job_id is null or job_id in (select id from _fk_safe_jobs))
   and (po_id is null or po_id in (select id from _fk_safe_pos));

delete from public.job_schedule_overrides
 where job_id in (select id from _fk_safe_jobs);

delete from public.orders
 where customer_id in (select id from _fk_safe_customers)
    or job_id in (select id from _fk_safe_jobs);

update public.po_items
   set for_customer_id = null,
       for_job_id = null
 where for_customer_id in (select id from _fk_safe_customers)
    or for_job_id in (select id from _fk_safe_jobs);

delete from public.purchase_orders
 where id in (select id from _fk_safe_pos);

delete from public.installer_bills
 where job_id in (select id from _fk_safe_jobs)
   and status = 'draft';

delete from public.expenses
 where job_id in (select id from _fk_safe_jobs);

delete from public.invoice_items
 where invoice_id in (select id from _fk_safe_invoices);

delete from public.invoices
 where id in (select id from _fk_safe_invoices);

delete from public.customers
 where id in (select id from _fk_safe_customers);

do $verify$
declare
  b record;
  n bigint;
begin
  select * into b from _fk_reset_before;

  n := (select count(*) from public.customers);
  if n <> b.customers_protected then
    raise exception
      'RESET INCOMPLETE: % customers remain, expected % protected.',
      n, b.customers_protected;
  end if;

  n := (
    select count(*)
    from _fk_protected_customers p
    where not exists (select 1 from public.customers c where c.id = p.id)
  );
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % protected customers were deleted.', n;
  end if;

  n := (
    select count(*)
    from public.customers c
    where c.id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % deletable customers remain.', n;
  end if;

  n := (select count(*) from public.estimate_approval_snapshots);
  if n <> b.snapshots then
    raise exception
      'RESET INCOMPLETE: snapshot count changed from % to %.',
      b.snapshots, n;
  end if;

  n := (
    select count(*) from public.jobs
    where customer_id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % jobs remain for deletable customers.', n;
  end if;

  n := (
    select count(*) from public.estimates
    where customer_id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % estimates remain for deletable customers.', n;
  end if;

  n := (
    select count(*) from public.invoices
    where customer_id in (select id from _fk_safe_customers)
  );
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % invoices remain for deletable customers.', n;
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
  if (select posting_enabled from public.accounting_settings where id = 1)
       is distinct from b.posting_enabled
     or (select books_of_record from public.accounting_settings where id = 1)
       is distinct from b.books_of_record then
    raise exception 'RESET ABORTED: accounting flags changed.';
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
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
end;
$verify$;

COMMIT;

select 'customers_remaining' as item, count(*)::bigint as n from public.customers
union all select 'customers_protected_still_present', (
  select count(*) from _fk_protected_customers p
  join public.customers c on c.id = p.id
)
union all select 'snapshots', count(*) from public.estimate_approval_snapshots
union all select 'jobs', count(*) from public.jobs
union all select 'estimates', count(*) from public.estimates
union all select 'invoices', count(*) from public.invoices
union all select 'payments', count(*) from public.payments
union all select 'warehouse_pos', (
  select count(*) from public.purchase_orders
  where customer_id is null and job_id is null and estimate_id is null
)
union all select 'products', count(*) from public.products
union all select 'staff_profiles', (
  select count(*) from public.profiles where role is distinct from 'customer'
)
order by 1;
