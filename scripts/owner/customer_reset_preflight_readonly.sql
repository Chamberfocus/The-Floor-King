-- =============================================================================
-- FLOOR KING — CUSTOMER RESET PREFLIGHT (READ-ONLY)
-- Paste into the production Supabase SQL Editor and Run.
--
-- Schema target: repo migrations through 0187.
-- 0136 created public.job_notes; 0137 renamed it to public.work_notes.
-- This script never references public.job_notes.
--
-- NOT a migration. Does NOT delete, update, insert, alter, disable triggers,
-- or change schema. Does NOT enable accounting. Does NOT delete storage objects.
--
-- Run this FIRST. Send every result set back before any delete SQL is run.
-- If the VERDICT row is not SAFE_TO_RESET, do not run customer_reset_safe.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Expected 0187 tables — existence only (cannot 42P01; missing shows false)
-- ---------------------------------------------------------------------------
select
  expected_table,
  to_regclass('public.' || expected_table) is not null as exists_in_db
from unnest(array[
  'customers',
  'profiles',
  'activities',
  'handoffs',
  'messages',
  'service_addresses',
  'customer_areas',
  'appointments',
  'sample_checkouts',
  'sample_checkout_items',
  'documents',
  'office_tasks',
  'service_callbacks',
  'step_overrides',
  'estimate_drafts',
  'estimates',
  'estimate_options',
  'estimate_line_items',
  'estimate_events',
  'estimate_builder_drafts',
  'estimate_approval_snapshots',
  'jobs',
  'job_line_items',
  'job_files',
  'work_notes',
  'job_issues',
  'job_labor',
  'job_applications',
  'job_operational_holds',
  'job_schedule_overrides',
  'job_satisfaction',
  'installer_bills',
  'installer_bill_line_items',
  'orders',
  'order_items',
  'invoices',
  'invoice_items',
  'payments',
  'purchase_orders',
  'po_items',
  'bills',
  'expenses',
  'customer_duplicate_overrides',
  'credit_memos',
  'credit_applications',
  'refunds',
  'customer_deposits',
  'customer_deposit_applications',
  'opening_ar_items',
  'invoice_write_offs',
  'journal_entries',
  'journal_lines',
  'accounting_settings',
  'accounting_posting_outbox',
  'financial_audit_log',
  'stock_movements',
  'stock_rolls',
  'inventory_return_allocations',
  'products',
  'suppliers',
  'workflow_stages'
]::text[]) as expected_table
order by 1;

-- ---------------------------------------------------------------------------
-- 1) Customers that would be removed
-- ---------------------------------------------------------------------------
select
  id,
  full_name,
  company,
  email,
  phone,
  stage::text as stage,
  created_at
from public.customers
order by created_at, full_name;

-- ---------------------------------------------------------------------------
-- 2) Headline operational counts
-- ---------------------------------------------------------------------------
select 'customers' as item, count(*)::bigint as n from public.customers
union all select 'estimates', count(*) from public.estimates
union all select 'jobs', count(*) from public.jobs
union all select 'orders', count(*) from public.orders
union all select 'invoices', count(*) from public.invoices
union all select 'payments', count(*) from public.payments
union all select 'credit_memos', count(*) from public.credit_memos
union all select 'refunds', count(*) from public.refunds
union all select 'customer_deposits', count(*) from public.customer_deposits
union all select 'opening_ar_items', count(*) from public.opening_ar_items
union all select 'estimate_approval_snapshots', count(*) from public.estimate_approval_snapshots
union all select 'financial_audit_log', count(*) from public.financial_audit_log
union all select 'work_notes', count(*) from public.work_notes
union all select 'portal_customer_profiles', (
  select count(*) from public.profiles where role = 'customer'
)
union all select 'staff_profiles', (
  select count(*) from public.profiles where role is distinct from 'customer'
)
order by 1;

-- ---------------------------------------------------------------------------
-- 3) Status breakdowns
-- ---------------------------------------------------------------------------
select 'estimate' as kind, status::text as status, count(*)::bigint as n
from public.estimates
group by 1, 2
union all
select 'job', status::text, count(*) from public.jobs group by 1, 2
union all
select 'order', status, count(*) from public.orders group by 1, 2
union all
select 'invoice', status::text, count(*) from public.invoices group by 1, 2
order by 1, 2;

-- ---------------------------------------------------------------------------
-- 4) Live FK graph pointing at public.customers
-- ---------------------------------------------------------------------------
select
  src.relname as from_table,
  src_att.attname as from_column,
  tgt.relname as to_table,
  tgt_att.attname as to_column,
  case con.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else con.confdeltype::text
  end as on_delete
from pg_constraint con
join pg_class src on src.oid = con.conrelid
join pg_namespace src_ns on src_ns.oid = src.relnamespace
join pg_class tgt on tgt.oid = con.confrelid
join pg_namespace tgt_ns on tgt_ns.oid = tgt.relnamespace
join unnest(con.conkey) with ordinality as src_k(attnum, ord) on true
join unnest(con.confkey) with ordinality as tgt_k(attnum, ord) on tgt_k.ord = src_k.ord
join pg_attribute src_att
  on src_att.attrelid = src.oid and src_att.attnum = src_k.attnum
join pg_attribute tgt_att
  on tgt_att.attrelid = tgt.oid and tgt_att.attnum = tgt_k.attnum
where con.contype = 'f'
  and src_ns.nspname = 'public'
  and tgt_ns.nspname = 'public'
  and tgt.relname = 'customers'
order by
  case con.confdeltype
    when 'r' then 1
    when 'a' then 2
    when 'c' then 3
    when 'n' then 4
    else 5
  end,
  src.relname,
  src_att.attname;

-- ---------------------------------------------------------------------------
-- 5) Dependent record counts by table (scoped to current customers)
-- ---------------------------------------------------------------------------
select 'activities' as item, count(*)::bigint as n
from public.activities where customer_id in (select id from public.customers)
union all select 'handoffs', count(*)
from public.handoffs where customer_id in (select id from public.customers)
union all select 'messages', count(*)
from public.messages where customer_id in (select id from public.customers)
union all select 'service_addresses', count(*)
from public.service_addresses where customer_id in (select id from public.customers)
union all select 'customer_areas', count(*)
from public.customer_areas where customer_id in (select id from public.customers)
union all select 'appointments', count(*)
from public.appointments where customer_id in (select id from public.customers)
union all select 'sample_checkouts', count(*)
from public.sample_checkouts where customer_id in (select id from public.customers)
union all select 'sample_checkout_items', count(*)
from public.sample_checkout_items
where checkout_id in (
  select id from public.sample_checkouts
  where customer_id in (select id from public.customers)
)
union all select 'documents_db_rows', count(*)
from public.documents where customer_id in (select id from public.customers)
union all select 'office_tasks', count(*)
from public.office_tasks
where customer_id in (select id from public.customers)
   or job_id in (select id from public.jobs)
   or estimate_id in (select id from public.estimates)
union all select 'service_callbacks', count(*)
from public.service_callbacks where customer_id in (select id from public.customers)
union all select 'step_overrides', count(*)
from public.step_overrides where customer_id in (select id from public.customers)
union all select 'estimate_drafts', count(*)
from public.estimate_drafts where customer_id in (select id from public.customers)
union all select 'estimates', count(*)
from public.estimates where customer_id in (select id from public.customers)
union all select 'estimate_options', count(*)
from public.estimate_options
where estimate_id in (select id from public.estimates)
union all select 'estimate_line_items', count(*)
from public.estimate_line_items
where option_id in (
  select id from public.estimate_options
  where estimate_id in (select id from public.estimates)
)
union all select 'estimate_events', count(*)
from public.estimate_events
where estimate_id in (select id from public.estimates)
union all select 'estimate_builder_drafts', count(*)
from public.estimate_builder_drafts
where estimate_id in (select id from public.estimates)
union all select 'estimate_approval_snapshots', count(*)
from public.estimate_approval_snapshots
where estimate_id in (select id from public.estimates)
   or approved_by_customer_id in (select id from public.customers)
union all select 'jobs', count(*)
from public.jobs where customer_id in (select id from public.customers)
union all select 'job_line_items', count(*)
from public.job_line_items
where job_id in (select id from public.jobs)
union all select 'job_files_db_rows', count(*)
from public.job_files
where job_id in (select id from public.jobs)
union all select 'work_notes_job_linked', count(*)
from public.work_notes
where job_id in (select id from public.jobs)
union all select 'work_notes_po_customer_linked', count(*)
from public.work_notes
where po_id in (
  select id from public.purchase_orders
  where customer_id in (select id from public.customers)
     or job_id in (select id from public.jobs)
     or estimate_id in (select id from public.estimates)
)
union all select 'work_notes_shop_wide', count(*)
from public.work_notes
where job_id is null and po_id is null
union all select 'job_issues', count(*)
from public.job_issues
where job_id in (select id from public.jobs)
union all select 'job_labor', count(*)
from public.job_labor
where job_id in (select id from public.jobs)
union all select 'job_applications', count(*)
from public.job_applications
where job_id in (select id from public.jobs)
union all select 'job_operational_holds', count(*)
from public.job_operational_holds
where job_id in (select id from public.jobs)
union all select 'job_schedule_overrides', count(*)
from public.job_schedule_overrides
where job_id in (select id from public.jobs)
union all select 'installer_bills', count(*)
from public.installer_bills
where job_id in (select id from public.jobs)
union all select 'installer_bill_line_items', count(*)
from public.installer_bill_line_items
where bill_id in (
  select id from public.installer_bills
  where job_id in (select id from public.jobs)
)
union all select 'job_satisfaction', count(*)
from public.job_satisfaction
where job_id in (select id from public.jobs)
union all select 'orders_customer_linked', count(*)
from public.orders
where customer_id in (select id from public.customers)
union all select 'orders_job_linked', count(*)
from public.orders
where job_id in (select id from public.jobs)
union all select 'order_items_customer_linked', count(*)
from public.order_items oi
join public.orders o on o.id = oi.order_id
where o.customer_id in (select id from public.customers)
   or o.job_id in (select id from public.jobs)
union all select 'invoices', count(*)
from public.invoices where customer_id in (select id from public.customers)
union all select 'invoice_items', count(*)
from public.invoice_items
where invoice_id in (select id from public.invoices)
union all select 'payments', count(*)
from public.payments
where invoice_id in (select id from public.invoices)
union all select 'purchase_orders_customer_job_or_estimate', count(*)
from public.purchase_orders
where customer_id in (select id from public.customers)
   or job_id in (select id from public.jobs)
   or estimate_id in (select id from public.estimates)
union all select 'purchase_orders_warehouse_unattributed', count(*)
from public.purchase_orders
where customer_id is null and job_id is null and estimate_id is null
union all select 'po_items_for_customer', count(*)
from public.po_items
where for_customer_id in (select id from public.customers)
   or for_job_id in (select id from public.jobs)
union all select 'bills_customer_or_job', count(*)
from public.bills
where customer_id in (select id from public.customers)
   or job_id in (select id from public.jobs)
union all select 'bills_on_customer_pos', count(*)
from public.bills
where po_id in (
  select id from public.purchase_orders
  where customer_id in (select id from public.customers)
     or job_id in (select id from public.jobs)
     or estimate_id in (select id from public.estimates)
)
union all select 'expenses_job_linked', count(*)
from public.expenses
where job_id in (select id from public.jobs)
union all select 'customer_duplicate_overrides', count(*)
from public.customer_duplicate_overrides
where created_customer_id in (select id from public.customers)
   or matched_customer_id in (select id from public.customers)
union all select 'stock_rolls_job_linked', count(*)
from public.stock_rolls
where job_id in (select id from public.jobs)
order by 1;

-- ---------------------------------------------------------------------------
-- 6) Protected financial / historical / inventory / accounting checks
--     Any n > 0 in this result means the reset must NOT run.
-- ---------------------------------------------------------------------------
select 'issued_invoices_sent_partial_paid' as check_name, count(*)::bigint as n
from public.invoices
where status in ('sent', 'partial', 'paid')
union all select 'non_draft_invoices_including_void', count(*)
from public.invoices
where status is distinct from 'draft'
union all select 'payments', count(*)
from public.payments
union all select 'credit_memos', count(*)
from public.credit_memos
union all select 'credit_applications', count(*)
from public.credit_applications
union all select 'refunds', count(*)
from public.refunds
union all select 'customer_deposits', count(*)
from public.customer_deposits
union all select 'customer_deposit_applications', count(*)
from public.customer_deposit_applications
union all select 'invoice_write_offs', count(*)
from public.invoice_write_offs
union all select 'opening_ar_items', count(*)
from public.opening_ar_items
union all select 'estimate_approval_snapshots', count(*)
from public.estimate_approval_snapshots
union all select 'journal_lines_with_customer_id', count(*)
from public.journal_lines
where customer_id is not null
union all select 'journal_entries_posted_any', count(*)
from public.journal_entries
where status = 'posted'
union all select 'journal_entries_tied_to_customer_invoices_or_payments', count(*)
from public.journal_entries je
where je.source_id in (select id from public.invoices)
   or je.source_id in (select id from public.payments)
   or je.source_id in (select id from public.customers)
   or je.source_id in (select id from public.credit_memos)
   or je.source_id in (select id from public.refunds)
   or je.source_id in (select id from public.customer_deposits)
union all select 'accounting_posting_outbox_pending_or_error', count(*)
from public.accounting_posting_outbox
where status in ('pending', 'error')
union all select 'installer_bills_non_draft', count(*)
from public.installer_bills
where job_id in (select id from public.jobs)
  and status is distinct from 'draft'
union all select 'bills_tied_to_customers_jobs_or_customer_pos', count(*)
from public.bills
where customer_id in (select id from public.customers)
   or job_id in (select id from public.jobs)
   or po_id in (
     select id from public.purchase_orders
     where customer_id in (select id from public.customers)
        or job_id in (select id from public.jobs)
        or estimate_id in (select id from public.estimates)
   )
union all select 'stock_movements_customer_job_or_customer_po', count(*)
from public.stock_movements sm
where sm.customer_id in (select id from public.customers)
   or sm.job_id in (select id from public.jobs)
   or sm.po_id in (
     select id from public.purchase_orders
     where customer_id in (select id from public.customers)
        or job_id in (select id from public.jobs)
        or estimate_id in (select id from public.estimates)
   )
union all select 'inventory_return_allocations_on_those_movements', count(*)
from public.inventory_return_allocations a
where a.return_movement_id in (
        select sm.id from public.stock_movements sm
        where sm.customer_id in (select id from public.customers)
           or sm.job_id in (select id from public.jobs)
      )
   or a.pull_movement_id in (
        select sm.id from public.stock_movements sm
        where sm.customer_id in (select id from public.customers)
           or sm.job_id in (select id from public.jobs)
      )
order by 1;

-- ---------------------------------------------------------------------------
-- 7) Accounting flags (must stay OFF; this query does not change them)
-- ---------------------------------------------------------------------------
select
  id,
  posting_enabled,
  inventory_posting_enabled,
  ap_posting_enabled,
  installer_posting_enabled,
  invoice_posting_enabled,
  payment_posting_enabled,
  credit_posting_enabled,
  expense_posting_enabled,
  deposit_posting_enabled,
  books_of_record,
  opening_balances_entered,
  accountant_validated,
  cutover_date
from public.accounting_settings
where id = 1;

-- ---------------------------------------------------------------------------
-- 8) Snapshot immutability triggers — must remain enabled
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  t.tgname as trigger_name,
  case t.tgenabled
    when 'O' then 'enabled_origin'
    when 'A' then 'enabled_always'
    when 'R' then 'enabled_replica'
    when 'D' then 'DISABLED'
    else t.tgenabled::text
  end as trigger_state
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'estimate_approval_snapshots'
  and not t.tgisinternal
order by t.tgname;

-- ---------------------------------------------------------------------------
-- 9) Storage impact (read-only counts — do NOT delete objects)
-- ---------------------------------------------------------------------------
select 'documents_bucket_customer_prefix' as item, count(*)::bigint as n
from storage.objects
where bucket_id = 'documents' and name like 'customer/%'
union all select 'documents_bucket_jobs_prefix', count(*)
from storage.objects
where bucket_id = 'documents' and name like 'jobs/%'
union all select 'documents_bucket_all', count(*)
from storage.objects
where bucket_id = 'documents'
union all select 'job_files_bucket_all', count(*)
from storage.objects
where bucket_id = 'job-files'
union all select 'documents_db_rows_with_path', count(*)
from public.documents
where path is not null
union all select 'job_files_db_rows_with_path', count(*)
from public.job_files
where path is not null
order by 1;

-- ---------------------------------------------------------------------------
-- 10) VERDICT — one row. SAFE_TO_RESET only if every blocker is zero / off.
-- ---------------------------------------------------------------------------
with blockers as (
  select
    (select count(*) from public.customers) as customers,
    (select count(*) from public.invoices where status in ('sent', 'partial', 'paid')) as issued_invoices,
    (select count(*) from public.payments) as payments,
    (select count(*) from public.credit_memos) as credit_memos,
    (select count(*) from public.refunds) as refunds,
    (select count(*) from public.customer_deposits) as deposits,
    (select count(*) from public.opening_ar_items) as opening_ar,
    (select count(*) from public.invoice_write_offs) as write_offs,
    (select count(*) from public.estimate_approval_snapshots) as snapshots,
    (
      select count(*) from public.installer_bills
      where job_id in (select id from public.jobs)
        and status is distinct from 'draft'
    ) as installer_labor_locked,
    (
      select count(*) from public.bills
      where customer_id in (select id from public.customers)
         or job_id in (select id from public.jobs)
         or po_id in (
           select id from public.purchase_orders
           where customer_id in (select id from public.customers)
              or job_id in (select id from public.jobs)
              or estimate_id in (select id from public.estimates)
         )
    ) as vendor_bills_tied,
    (select count(*) from public.journal_lines where customer_id is not null) as journal_customer_dims,
    (
      select count(*) from public.journal_entries je
      where je.source_id in (select id from public.invoices)
         or je.source_id in (select id from public.payments)
         or je.source_id in (select id from public.customers)
         or je.source_id in (select id from public.credit_memos)
         or je.source_id in (select id from public.refunds)
         or je.source_id in (select id from public.customer_deposits)
    ) as journals_tied_to_customers,
    (
      select count(*) from public.stock_movements sm
      where sm.customer_id in (select id from public.customers)
         or sm.job_id in (select id from public.jobs)
         or sm.po_id in (
           select id from public.purchase_orders
           where customer_id in (select id from public.customers)
              or job_id in (select id from public.jobs)
              or estimate_id in (select id from public.estimates)
         )
    ) as inventory_deps,
    (
      select
        coalesce(posting_enabled, false)
        or coalesce(inventory_posting_enabled, false)
        or coalesce(ap_posting_enabled, false)
        or coalesce(installer_posting_enabled, false)
        or coalesce(invoice_posting_enabled, false)
        or coalesce(payment_posting_enabled, false)
        or coalesce(credit_posting_enabled, false)
        or coalesce(expense_posting_enabled, false)
        or coalesce(deposit_posting_enabled, false)
        or coalesce(books_of_record, false)
        or coalesce(opening_balances_entered, false)
        or coalesce(accountant_validated, false)
        or cutover_date is not null
      from public.accounting_settings
      where id = 1
    ) as accounting_on,
    (
      select exists (
        select 1
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'estimate_approval_snapshots'
          and t.tgname in (
            'estimate_approval_snapshots_no_delete',
            'estimate_approval_snapshots_immutable'
          )
          and t.tgenabled = 'D'
      )
    ) as snapshot_triggers_disabled
)
select
  customers,
  issued_invoices,
  payments,
  credit_memos,
  refunds,
  deposits,
  opening_ar,
  write_offs,
  snapshots,
  installer_labor_locked,
  vendor_bills_tied,
  journal_customer_dims,
  journals_tied_to_customers,
  inventory_deps,
  accounting_on,
  snapshot_triggers_disabled,
  case
    when customers = 0 then 'NO_CUSTOMERS'
    when snapshot_triggers_disabled then 'BLOCKED_SNAPSHOT_TRIGGERS_DISABLED'
    when accounting_on then 'BLOCKED_ACCOUNTING_ON'
    when issued_invoices > 0
      or payments > 0
      or credit_memos > 0
      or refunds > 0
      or deposits > 0
      or opening_ar > 0
      or write_offs > 0
      or snapshots > 0
      or installer_labor_locked > 0
      or vendor_bills_tied > 0
      or journal_customer_dims > 0
      or journals_tied_to_customers > 0
      or inventory_deps > 0
      then 'BLOCKED_PROTECTED_DATA'
    else 'SAFE_TO_RESET'
  end as verdict
from blockers;
