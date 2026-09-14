-- =============================================================================
-- FLOOR KING — CUSTOMER RESET PREFLIGHT (READ-ONLY)
-- Paste the ENTIRE file into the production Supabase SQL Editor and Run.
--
-- Schema target: repo migrations through 0187.
-- 0136 created public.job_notes; 0137 renamed it to public.work_notes.
--
-- NOT a migration. SELECT / WITH..SELECT only. Independent statements.
-- No unnest(), no WITH ORDINALITY, no giant file-wide UNION ALL.
-- Does NOT delete, update, insert, alter, drop, truncate, disable triggers,
-- change session_replication_role, enable accounting, or delete storage.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Expected 0187 tables (to_regclass cannot raise 42P01)
-- ---------------------------------------------------------------------------
select
  expected_table,
  to_regclass('public.' || expected_table) is not null as exists_in_db
from (
  values
    ('customers'),
    ('profiles'),
    ('activities'),
    ('handoffs'),
    ('messages'),
    ('service_addresses'),
    ('customer_areas'),
    ('appointments'),
    ('sample_checkouts'),
    ('sample_checkout_items'),
    ('documents'),
    ('office_tasks'),
    ('service_callbacks'),
    ('step_overrides'),
    ('estimate_drafts'),
    ('estimates'),
    ('estimate_options'),
    ('estimate_line_items'),
    ('estimate_events'),
    ('estimate_builder_drafts'),
    ('estimate_approval_snapshots'),
    ('jobs'),
    ('job_line_items'),
    ('job_files'),
    ('work_notes'),
    ('job_issues'),
    ('job_labor'),
    ('job_applications'),
    ('job_operational_holds'),
    ('job_schedule_overrides'),
    ('job_satisfaction'),
    ('installer_bills'),
    ('installer_bill_line_items'),
    ('orders'),
    ('order_items'),
    ('invoices'),
    ('invoice_items'),
    ('payments'),
    ('purchase_orders'),
    ('po_items'),
    ('bills'),
    ('expenses'),
    ('customer_duplicate_overrides'),
    ('credit_memos'),
    ('credit_applications'),
    ('refunds'),
    ('customer_deposits'),
    ('customer_deposit_applications'),
    ('opening_ar_items'),
    ('invoice_write_offs'),
    ('journal_entries'),
    ('journal_lines'),
    ('accounting_settings'),
    ('accounting_posting_outbox'),
    ('financial_audit_log'),
    ('stock_movements'),
    ('stock_rolls'),
    ('inventory_return_allocations'),
    ('products'),
    ('suppliers'),
    ('workflow_stages')
) as t(expected_table)
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
select item, n
from (
  select 'customers'::text as item, count(*)::bigint as n from public.customers
  union all
  select 'estimates'::text, count(*)::bigint from public.estimates
  union all
  select 'jobs'::text, count(*)::bigint from public.jobs
  union all
  select 'orders'::text, count(*)::bigint from public.orders
  union all
  select 'invoices'::text, count(*)::bigint from public.invoices
  union all
  select 'payments'::text, count(*)::bigint from public.payments
  union all
  select 'credit_memos'::text, count(*)::bigint from public.credit_memos
  union all
  select 'refunds'::text, count(*)::bigint from public.refunds
  union all
  select 'customer_deposits'::text, count(*)::bigint from public.customer_deposits
  union all
  select 'opening_ar_items'::text, count(*)::bigint from public.opening_ar_items
  union all
  select 'estimate_approval_snapshots'::text, count(*)::bigint from public.estimate_approval_snapshots
  union all
  select 'financial_audit_log'::text, count(*)::bigint from public.financial_audit_log
  union all
  select 'work_notes'::text, count(*)::bigint from public.work_notes
  union all
  select 'portal_customer_profiles'::text, (
    select count(*)::bigint from public.profiles where role = 'customer'
  )
  union all
  select 'staff_profiles'::text, (
    select count(*)::bigint from public.profiles where role is distinct from 'customer'
  )
) as headline
order by 1;

-- ---------------------------------------------------------------------------
-- 3) Status breakdowns
-- ---------------------------------------------------------------------------
select kind, status, n
from (
  select 'estimate'::text as kind, status::text as status, count(*)::bigint as n
  from public.estimates
  group by status
  union all
  select 'job'::text, status::text, count(*)::bigint
  from public.jobs
  group by status
  union all
  select 'order'::text, status::text, count(*)::bigint
  from public.orders
  group by status
  union all
  select 'invoice'::text, status::text, count(*)::bigint
  from public.invoices
  group by status
) as statuses
order by 1, 2;

-- ---------------------------------------------------------------------------
-- 4) Live FK graph touching customers, jobs, or purchase_orders.
--    generate_series + array subscript. No unnest. No WITH ORDINALITY.
-- ---------------------------------------------------------------------------
select
  con.conname as constraint_name,
  nsp_child.nspname || '.' || rel_child.relname as child_table,
  att_child.attname as child_column,
  nsp_parent.nspname || '.' || rel_parent.relname as parent_table,
  att_parent.attname as parent_column,
  case con.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else con.confdeltype::text
  end as on_delete
from pg_catalog.pg_constraint as con
join pg_catalog.pg_class as rel_child
  on rel_child.oid = con.conrelid
join pg_catalog.pg_namespace as nsp_child
  on nsp_child.oid = rel_child.relnamespace
join pg_catalog.pg_class as rel_parent
  on rel_parent.oid = con.confrelid
join pg_catalog.pg_namespace as nsp_parent
  on nsp_parent.oid = rel_parent.relnamespace
join generate_series(1, 32) as gs(i)
  on gs.i <= coalesce(pg_catalog.array_length(con.conkey, 1), 0)
join pg_catalog.pg_attribute as att_child
  on att_child.attrelid = con.conrelid
 and att_child.attnum = con.conkey[gs.i]
join pg_catalog.pg_attribute as att_parent
  on att_parent.attrelid = con.confrelid
 and att_parent.attnum = con.confkey[gs.i]
where con.contype = 'f'
  and (
    (
      nsp_child.nspname = 'public'
      and rel_child.relname in ('customers', 'jobs', 'purchase_orders')
    )
    or
    (
      nsp_parent.nspname = 'public'
      and rel_parent.relname in ('customers', 'jobs', 'purchase_orders')
    )
  )
order by
  case con.confdeltype
    when 'r' then 1
    when 'a' then 2
    when 'c' then 3
    when 'n' then 4
    else 5
  end,
  child_table,
  child_column;

-- ---------------------------------------------------------------------------
-- 5a) Dependent counts — CRM / portal / scheduling
-- ---------------------------------------------------------------------------
select item, n
from (
  select 'activities'::text as item, count(*)::bigint as n
  from public.activities
  where customer_id in (select id from public.customers)
  union all
  select 'handoffs'::text, count(*)::bigint
  from public.handoffs
  where customer_id in (select id from public.customers)
  union all
  select 'messages'::text, count(*)::bigint
  from public.messages
  where customer_id in (select id from public.customers)
  union all
  select 'service_addresses'::text, count(*)::bigint
  from public.service_addresses
  where customer_id in (select id from public.customers)
  union all
  select 'customer_areas'::text, count(*)::bigint
  from public.customer_areas
  where customer_id in (select id from public.customers)
  union all
  select 'appointments'::text, count(*)::bigint
  from public.appointments
  where customer_id in (select id from public.customers)
  union all
  select 'sample_checkouts'::text, count(*)::bigint
  from public.sample_checkouts
  where customer_id in (select id from public.customers)
  union all
  select 'sample_checkout_items'::text, count(*)::bigint
  from public.sample_checkout_items
  where checkout_id in (
    select id from public.sample_checkouts
    where customer_id in (select id from public.customers)
  )
  union all
  select 'documents_db_rows'::text, count(*)::bigint
  from public.documents
  where customer_id in (select id from public.customers)
  union all
  select 'office_tasks'::text, count(*)::bigint
  from public.office_tasks
  where customer_id in (select id from public.customers)
     or job_id in (select id from public.jobs)
     or estimate_id in (select id from public.estimates)
  union all
  select 'service_callbacks'::text, count(*)::bigint
  from public.service_callbacks
  where customer_id in (select id from public.customers)
  union all
  select 'step_overrides'::text, count(*)::bigint
  from public.step_overrides
  where customer_id in (select id from public.customers)
  union all
  select 'customer_duplicate_overrides'::text, count(*)::bigint
  from public.customer_duplicate_overrides
  where created_customer_id in (select id from public.customers)
     or matched_customer_id in (select id from public.customers)
) as crm_counts
order by 1;

-- ---------------------------------------------------------------------------
-- 5b) Dependent counts — estimates
-- ---------------------------------------------------------------------------
select item, n
from (
  select 'estimate_drafts'::text as item, count(*)::bigint as n
  from public.estimate_drafts
  where customer_id in (select id from public.customers)
  union all
  select 'estimates'::text, count(*)::bigint
  from public.estimates
  where customer_id in (select id from public.customers)
  union all
  select 'estimate_options'::text, count(*)::bigint
  from public.estimate_options
  where estimate_id in (select id from public.estimates)
  union all
  select 'estimate_line_items'::text, count(*)::bigint
  from public.estimate_line_items
  where option_id in (
    select id from public.estimate_options
    where estimate_id in (select id from public.estimates)
  )
  union all
  select 'estimate_events'::text, count(*)::bigint
  from public.estimate_events
  where estimate_id in (select id from public.estimates)
  union all
  select 'estimate_builder_drafts'::text, count(*)::bigint
  from public.estimate_builder_drafts
  where estimate_id in (select id from public.estimates)
  union all
  select 'estimate_approval_snapshots'::text, count(*)::bigint
  from public.estimate_approval_snapshots
  where estimate_id in (select id from public.estimates)
     or approved_by_customer_id in (select id from public.customers)
) as estimate_counts
order by 1;

-- ---------------------------------------------------------------------------
-- 5c) Dependent counts — jobs / work notes / installer
-- ---------------------------------------------------------------------------
select item, n
from (
  select 'jobs'::text as item, count(*)::bigint as n
  from public.jobs
  where customer_id in (select id from public.customers)
  union all
  select 'job_line_items'::text, count(*)::bigint
  from public.job_line_items
  where job_id in (select id from public.jobs)
  union all
  select 'job_files_db_rows'::text, count(*)::bigint
  from public.job_files
  where job_id in (select id from public.jobs)
  union all
  select 'work_notes_job_linked'::text, count(*)::bigint
  from public.work_notes
  where job_id in (select id from public.jobs)
  union all
  select 'work_notes_po_customer_linked'::text, count(*)::bigint
  from public.work_notes
  where po_id in (
    select id from public.purchase_orders
    where customer_id in (select id from public.customers)
       or job_id in (select id from public.jobs)
       or estimate_id in (select id from public.estimates)
  )
  union all
  select 'work_notes_shop_wide'::text, count(*)::bigint
  from public.work_notes
  where job_id is null
    and po_id is null
  union all
  select 'job_issues'::text, count(*)::bigint
  from public.job_issues
  where job_id in (select id from public.jobs)
  union all
  select 'job_labor'::text, count(*)::bigint
  from public.job_labor
  where job_id in (select id from public.jobs)
  union all
  select 'job_applications'::text, count(*)::bigint
  from public.job_applications
  where job_id in (select id from public.jobs)
  union all
  select 'job_operational_holds'::text, count(*)::bigint
  from public.job_operational_holds
  where job_id in (select id from public.jobs)
  union all
  select 'job_schedule_overrides'::text, count(*)::bigint
  from public.job_schedule_overrides
  where job_id in (select id from public.jobs)
  union all
  select 'installer_bills'::text, count(*)::bigint
  from public.installer_bills
  where job_id in (select id from public.jobs)
  union all
  select 'installer_bill_line_items'::text, count(*)::bigint
  from public.installer_bill_line_items
  where bill_id in (
    select id from public.installer_bills
    where job_id in (select id from public.jobs)
  )
  union all
  select 'job_satisfaction'::text, count(*)::bigint
  from public.job_satisfaction
  where job_id in (select id from public.jobs)
) as job_counts
order by 1;

-- ---------------------------------------------------------------------------
-- 5d) Dependent counts — orders / invoices / POs / bills / inventory remnants
-- ---------------------------------------------------------------------------
select item, n
from (
  select 'orders_customer_linked'::text as item, count(*)::bigint as n
  from public.orders
  where customer_id in (select id from public.customers)
  union all
  select 'orders_job_linked'::text, count(*)::bigint
  from public.orders
  where job_id in (select id from public.jobs)
  union all
  select 'order_items_customer_linked'::text, count(*)::bigint
  from public.order_items as oi
  join public.orders as o on o.id = oi.order_id
  where o.customer_id in (select id from public.customers)
     or o.job_id in (select id from public.jobs)
  union all
  select 'invoices'::text, count(*)::bigint
  from public.invoices
  where customer_id in (select id from public.customers)
  union all
  select 'invoice_items'::text, count(*)::bigint
  from public.invoice_items
  where invoice_id in (select id from public.invoices)
  union all
  select 'payments'::text, count(*)::bigint
  from public.payments
  where invoice_id in (select id from public.invoices)
  union all
  select 'purchase_orders_customer_job_or_estimate'::text, count(*)::bigint
  from public.purchase_orders
  where customer_id in (select id from public.customers)
     or job_id in (select id from public.jobs)
     or estimate_id in (select id from public.estimates)
  union all
  select 'purchase_orders_warehouse_unattributed'::text, count(*)::bigint
  from public.purchase_orders
  where customer_id is null
    and job_id is null
    and estimate_id is null
  union all
  select 'po_items_for_customer'::text, count(*)::bigint
  from public.po_items
  where for_customer_id in (select id from public.customers)
     or for_job_id in (select id from public.jobs)
  union all
  select 'bills_customer_or_job'::text, count(*)::bigint
  from public.bills
  where customer_id in (select id from public.customers)
     or job_id in (select id from public.jobs)
  union all
  select 'bills_on_customer_pos'::text, count(*)::bigint
  from public.bills
  where po_id in (
    select id from public.purchase_orders
    where customer_id in (select id from public.customers)
       or job_id in (select id from public.jobs)
       or estimate_id in (select id from public.estimates)
  )
  union all
  select 'expenses_job_linked'::text, count(*)::bigint
  from public.expenses
  where job_id in (select id from public.jobs)
  union all
  select 'stock_rolls_job_linked'::text, count(*)::bigint
  from public.stock_rolls
  where job_id in (select id from public.jobs)
) as money_counts
order by 1;

-- ---------------------------------------------------------------------------
-- 6) Protected financial / historical / inventory / accounting checks
-- ---------------------------------------------------------------------------
select check_name, n
from (
  select 'issued_invoices_sent_partial_paid'::text as check_name, count(*)::bigint as n
  from public.invoices
  where status in ('sent', 'partial', 'paid')
  union all
  select 'non_draft_invoices_including_void'::text, count(*)::bigint
  from public.invoices
  where status is distinct from 'draft'
  union all
  select 'payments'::text, count(*)::bigint
  from public.payments
  union all
  select 'credit_memos'::text, count(*)::bigint
  from public.credit_memos
  union all
  select 'credit_applications'::text, count(*)::bigint
  from public.credit_applications
  union all
  select 'refunds'::text, count(*)::bigint
  from public.refunds
  union all
  select 'customer_deposits'::text, count(*)::bigint
  from public.customer_deposits
  union all
  select 'customer_deposit_applications'::text, count(*)::bigint
  from public.customer_deposit_applications
  union all
  select 'invoice_write_offs'::text, count(*)::bigint
  from public.invoice_write_offs
  union all
  select 'opening_ar_items'::text, count(*)::bigint
  from public.opening_ar_items
  union all
  select 'estimate_approval_snapshots'::text, count(*)::bigint
  from public.estimate_approval_snapshots
  union all
  select 'journal_lines_with_customer_id'::text, count(*)::bigint
  from public.journal_lines
  where customer_id is not null
  union all
  select 'journal_entries_posted_any'::text, count(*)::bigint
  from public.journal_entries
  where status = 'posted'
  union all
  select 'journal_entries_tied_to_customer_invoices_or_payments'::text, count(*)::bigint
  from public.journal_entries as je
  where je.source_id in (select id from public.invoices)
     or je.source_id in (select id from public.payments)
     or je.source_id in (select id from public.customers)
     or je.source_id in (select id from public.credit_memos)
     or je.source_id in (select id from public.refunds)
     or je.source_id in (select id from public.customer_deposits)
  union all
  select 'accounting_posting_outbox_pending_or_error'::text, count(*)::bigint
  from public.accounting_posting_outbox
  where status in ('pending', 'error')
  union all
  select 'installer_bills_non_draft'::text, count(*)::bigint
  from public.installer_bills
  where job_id in (select id from public.jobs)
    and status is distinct from 'draft'
  union all
  select 'bills_tied_to_customers_jobs_or_customer_pos'::text, count(*)::bigint
  from public.bills
  where customer_id in (select id from public.customers)
     or job_id in (select id from public.jobs)
     or po_id in (
       select id from public.purchase_orders
       where customer_id in (select id from public.customers)
          or job_id in (select id from public.jobs)
          or estimate_id in (select id from public.estimates)
     )
  union all
  select 'stock_movements_customer_job_or_customer_po'::text, count(*)::bigint
  from public.stock_movements as sm
  where sm.customer_id in (select id from public.customers)
     or sm.job_id in (select id from public.jobs)
     or sm.po_id in (
       select id from public.purchase_orders
       where customer_id in (select id from public.customers)
          or job_id in (select id from public.jobs)
          or estimate_id in (select id from public.estimates)
     )
  union all
  select 'inventory_return_allocations_on_those_movements'::text, count(*)::bigint
  from public.inventory_return_allocations as a
  where a.return_movement_id in (
          select sm.id
          from public.stock_movements as sm
          where sm.customer_id in (select id from public.customers)
             or sm.job_id in (select id from public.jobs)
        )
     or a.pull_movement_id in (
          select sm.id
          from public.stock_movements as sm
          where sm.customer_id in (select id from public.customers)
             or sm.job_id in (select id from public.jobs)
        )
) as protected_counts
order by 1;

-- ---------------------------------------------------------------------------
-- 7) Accounting flags (read-only; must stay OFF)
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
from pg_trigger as t
join pg_class as c on c.oid = t.tgrelid
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'estimate_approval_snapshots'
  and not t.tgisinternal
order by t.tgname;

-- ---------------------------------------------------------------------------
-- 9) Storage impact (read-only counts — do NOT delete objects)
-- ---------------------------------------------------------------------------
select item, n
from (
  select 'documents_bucket_customer_prefix'::text as item, count(*)::bigint as n
  from storage.objects
  where bucket_id = 'documents'
    and name like 'customer/%'
  union all
  select 'documents_bucket_jobs_prefix'::text, count(*)::bigint
  from storage.objects
  where bucket_id = 'documents'
    and name like 'jobs/%'
  union all
  select 'documents_bucket_all'::text, count(*)::bigint
  from storage.objects
  where bucket_id = 'documents'
  union all
  select 'job_files_bucket_all'::text, count(*)::bigint
  from storage.objects
  where bucket_id = 'job-files'
  union all
  select 'documents_db_rows_with_path'::text, count(*)::bigint
  from public.documents
  where path is not null
  union all
  select 'job_files_db_rows_with_path'::text, count(*)::bigint
  from public.job_files
  where path is not null
) as storage_counts
order by 1;

-- ---------------------------------------------------------------------------
-- 10) VERDICT — SAFE_TO_RESET only if every blocker is zero / off
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
      select count(*)
      from public.installer_bills
      where job_id in (select id from public.jobs)
        and status is distinct from 'draft'
    ) as installer_labor_locked,
    (
      select count(*)
      from public.bills
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
      select count(*)
      from public.journal_entries as je
      where je.source_id in (select id from public.invoices)
         or je.source_id in (select id from public.payments)
         or je.source_id in (select id from public.customers)
         or je.source_id in (select id from public.credit_memos)
         or je.source_id in (select id from public.refunds)
         or je.source_id in (select id from public.customer_deposits)
    ) as journals_tied_to_customers,
    (
      select count(*)
      from public.stock_movements as sm
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
        from pg_trigger as t
        join pg_class as c on c.oid = t.tgrelid
        join pg_namespace as n on n.oid = c.relnamespace
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
