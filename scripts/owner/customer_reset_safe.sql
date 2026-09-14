-- =============================================================================
-- FLOOR KING — SAFE CUSTOMER RESET
--
-- OWNER ACTION. Run ONLY after customer_reset_preflight_readonly.sql returns
-- verdict = SAFE_TO_RESET and you have reviewed the customer list.
--
-- Schema target: repo migrations through 0187.
-- 0136 created public.job_notes; 0137 renamed it to public.work_notes.
-- This script never references public.job_notes.
--
-- NOT a migration. Does NOT disable triggers. Does NOT bypass foreign keys.
-- Does NOT change accounting flags. Does NOT delete storage objects.
-- Does NOT delete catalog, vendors, inventory master, staff, warehouse
-- unattributed purchase orders, or shop-wide work_notes.
--
-- If any safety assertion fails, the transaction rolls back.
-- =============================================================================

BEGIN;

-- Capture preserved baselines for post-delete verification.
drop table if exists pg_temp._fk_reset_before;
create temporary table _fk_reset_before as
select
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

do $assert$
declare
  s record;
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

  if (select count(*) from public.customers) = 0 then
    raise exception 'RESET ABORTED: no customers to remove (nothing to do).';
  end if;

  n := (select count(*) from public.estimate_approval_snapshots);
  if n <> 0 then
    raise exception
      'RESET ABORTED: % estimate_approval_snapshots exist. They are append-only and cannot be deleted without disabling triggers.',
      n;
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
    where job_id in (select id from public.jobs)
      and status is distinct from 'draft'
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % non-draft installer_bills exist (immutability trigger would block job delete).',
      n;
  end if;

  n := (
    select count(*) from public.bills
    where customer_id in (select id from public.customers)
       or job_id in (select id from public.jobs)
       or po_id in (
         select id from public.purchase_orders
         where customer_id in (select id from public.customers)
            or job_id in (select id from public.jobs)
            or estimate_id in (select id from public.estimates)
       )
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % vendor bills are tied to customers/jobs/customer POs (AP immutability).',
      n;
  end if;

  n := (select count(*) from public.journal_lines where customer_id is not null);
  if n <> 0 then
    raise exception 'RESET ABORTED: % journal_lines still carry customer_id.', n;
  end if;

  n := (
    select count(*) from public.journal_entries je
    where je.source_id in (select id from public.invoices)
       or je.source_id in (select id from public.payments)
       or je.source_id in (select id from public.customers)
       or je.source_id in (select id from public.credit_memos)
       or je.source_id in (select id from public.refunds)
       or je.source_id in (select id from public.customer_deposits)
  );
  if n <> 0 then
    raise exception 'RESET ABORTED: % journal_entries are tied to customer money records.', n;
  end if;

  n := (
    select count(*) from public.stock_movements sm
    where sm.customer_id in (select id from public.customers)
       or sm.job_id in (select id from public.jobs)
       or sm.po_id in (
         select id from public.purchase_orders
         where customer_id in (select id from public.customers)
            or job_id in (select id from public.jobs)
            or estimate_id in (select id from public.estimates)
       )
  );
  if n <> 0 then
    raise exception
      'RESET ABORTED: % stock_movements are tied to customers/jobs/customer POs. Inventory will not be reversed or deleted.',
      n;
  end if;
end;
$assert$;

-- Self-FK must be cleared before customer rows can be deleted (NO ACTION).
update public.customers
   set referred_by_customer_id = null
 where referred_by_customer_id is not null;

-- Portal links: keep the login/profile; drop the customer pointer.
update public.profiles
   set customer_id = null
 where customer_id is not null;

-- RESTRICT child: service callbacks (operational). Delete only after money asserts.
delete from public.service_callbacks
 where customer_id in (select id from public.customers);

-- Customer-linked office tasks (SET NULL FK; delete so they do not linger).
delete from public.office_tasks
 where customer_id in (select id from public.customers)
    or job_id in (select id from public.jobs)
    or estimate_id in (select id from public.estimates);

-- Work notes (renamed from job_notes in 0137). Keep shop-wide rows
-- (job_id and po_id both null). Job-linked CASCADE from jobs; PO-linked
-- CASCADE from purchase_orders. Delete customer-tied rows first.
delete from public.work_notes
 where job_id in (select id from public.jobs)
    or po_id in (
      select id from public.purchase_orders
      where customer_id in (select id from public.customers)
         or job_id in (select id from public.jobs)
         or estimate_id in (select id from public.estimates)
    );

delete from public.job_schedule_overrides
 where job_id in (select id from public.jobs);

-- Orders SET NULL on customer/job delete — remove customer/job-linked orders
-- explicitly so they do not become anonymous leftover orders.
delete from public.orders
 where customer_id in (select id from public.customers)
    or job_id in (select id from public.jobs);

-- Customer/job/estimate POs (warehouse unattributed POs are kept).
-- Safe because stock_movements on these POs were asserted to be zero.
update public.po_items
   set for_customer_id = null,
       for_job_id = null
 where for_customer_id in (select id from public.customers)
    or for_job_id in (select id from public.jobs);

delete from public.purchase_orders
 where customer_id in (select id from public.customers)
    or job_id in (select id from public.jobs)
    or estimate_id in (select id from public.estimates);

-- Draft installer labor only (non-draft asserted empty; immutability blocks those).
delete from public.installer_bills
 where job_id in (select id from public.jobs)
   and status = 'draft';

-- Job-linked expenses are operational test records for those jobs.
delete from public.expenses
 where job_id in (select id from public.jobs);

-- Draft/void invoices (issued/paid already asserted empty). Explicit child-first.
delete from public.invoice_items
 where invoice_id in (select id from public.invoices);

delete from public.invoices;

-- Customers last. Remaining children use ON DELETE CASCADE
-- (jobs, estimates, activities, messages, documents metadata, appointments,
--  addresses, samples, areas, handoffs, drafts, step_overrides, work_notes
--  already removed above, etc.).
-- estimate_approval_snapshots are append-only; count was asserted 0 so CASCADE
-- cannot hit the no-delete trigger.
delete from public.customers;

do $verify$
declare
  b record;
  n bigint;
begin
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

  n := (select count(*) from public.invoices);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % invoices remain.', n;
  end if;

  n := (select count(*) from public.estimate_approval_snapshots);
  if n <> 0 then
    raise exception 'RESET INCOMPLETE: % approval snapshots remain.', n;
  end if;

  select * into b from _fk_reset_before;
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

-- Post-commit confirmation (read-only).
select 'customers' as item, count(*)::bigint as n from public.customers
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
union all select 'portal_customer_profiles_unlinked', (
  select count(*) from public.profiles where role = 'customer'
)
order by 1;
