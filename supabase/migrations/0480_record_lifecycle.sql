-- 0480 — Record lifecycle: archive, restore, and guarded permanent delete.
-- DO NOT APPLY until the owner reviews this file.
-- Does not remove, rewrite, or insert business rows. Does not enable accounting.
-- Does not rerun 0477, 0478, or 0479.
--
-- Atomicity
-- Supabase CLI db push applies this file inside one transaction and writes
-- supabase_migrations.schema_migrations only after every statement succeeds.
-- A COMMIT inside the file would end that wrapper early (the statements after
-- it would not roll back with the migration), so this file has no BEGIN and
-- no COMMIT.
-- SETUP.md applies repository SQL by pasting it into the Supabase SQL Editor.
-- This file is a single DO statement. PostgreSQL runs that statement as one
-- transaction. Preflight raises before any lifecycle DDL. If preflight or any
-- later statement inside the DO raises, the whole statement rolls back:
-- no archive column, index, audit table, function, trigger, or foreign-key
-- change from this file remains.
-- CREATE INDEX in this file is not CONCURRENTLY, so it stays inside that
-- transaction. The Supabase CLI therefore keeps the file in its normal
-- single-batch transaction instead of splitting it.
--
-- Re-run
-- A finished apply can be pasted again. New columns use IF NOT EXISTS,
-- functions use CREATE OR REPLACE of the same signature, triggers use
-- DROP IF EXISTS, and a foreign key that is already ON DELETE RESTRICT is
-- not dropped. That second full run is safe.
-- A preflight failure, or a failure later inside this DO, leaves no partial
-- lifecycle schema when the file is executed as written.
-- This file is not idempotent if someone copies part of it out and commits
-- that part separately. Do not split it.
--
-- Migration history
-- When supabase_migrations.schema_migrations exists and has a version column,
-- recorded versions 0477, 0478, and 0479 are required. This file does not
-- insert history rows and does not execute those files.
-- When that history table is absent, this file cannot prove the CLI history.
-- SQL Editor applies are not written there. Absence is a notice, not a
-- fabricated pass. The object checks for 0477 (invoices.idempotency_key and
-- customer_strong_identifier_taken), 0478 (job_queue_page and
-- customer_queue_page), and 0479 (estimate_queue_page and invoice_queue_page)
-- are what actually stop an incompatible database.

do $fk0480mig$
declare
  v_rel text;
  v_spec text;
  v_table text;
  v_column text;
  v_type text;
  v_actual text;
  v_count bigint;
  v_args text;
  v_result text;
  v_src text;
  v_definer boolean;
  v_lang text;
  v_volatile "char";
  v_has_name boolean;
  v_hist bigint;
  v_orphans bigint;
  v_newdef text;
  r record;
  fkexp record;
begin
  perform set_config('search_path', 'public, pg_catalog', true);

  -- Relations used by lifecycle_set_archived, lifecycle_commit_delete,
  -- lifecycle_delete_guard, lifecycle_archive_column_guard,
  -- estimate_queue_page, invoice_queue_page, search_products, and the
  -- delete-impact reads. Missing relations abort. They are not skipped.
  foreach v_rel in array array[
      'activities',
      'appointments',
      'bills',
      'credit_applications',
      'credit_memos',
      'customer_areas',
      'customer_deposit_applications',
      'customer_deposits',
      'customer_duplicate_overrides',
      'customers',
      'documents',
      'estimate_approval_snapshots',
      'estimate_drafts',
      'estimate_line_items',
      'estimates',
      'expenses',
      'handoffs',
      'install_crews',
      'installer_bills',
      'invoice_write_offs',
      'invoices',
      'job_files',
      'job_issues',
      'job_labor',
      'job_line_items',
      'jobs',
      'journal_lines',
      'messages',
      'office_tasks',
      'opening_ap_items',
      'opening_ar_items',
      'order_items',
      'orders',
      'payments',
      'po_items',
      'product_vendors',
      'products',
      'profiles',
      'purchase_orders',
      'refunds',
      'sample_checkout_items',
      'sample_checkouts',
      'service_addresses',
      'service_callbacks',
      'step_overrides',
      'stock_movements',
      'stock_rolls',
      'suppliers'
    ]
  loop
    if to_regclass('public.' || v_rel) is null then
      raise exception '0480 preflight: required relation public.% is missing', v_rel;
    end if;
    if (
      select c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_rel
    ) not in ('r', 'p') then
      raise exception '0480 preflight: public.% is not a table', v_rel;
    end if;
  end loop;

  foreach v_rel in array array[
      'estimate_builder_drafts',
      'estimate_events',
      'estimate_options',
      'install_preferences',
      'invoice_items',
      'job_applications',
      'job_operational_holds',
      'job_satisfaction',
      'job_schedule_overrides',
      'price_import_lines',
      'price_imports',
      'product_price_history',
      'supplier_feeds',
      'work_notes'
    ]
  loop
    if to_regclass('public.' || v_rel) is null then
      raise exception '0480 preflight: required relation public.% is missing', v_rel;
    end if;
  end loop;

  if to_regclass('auth.users') is null then
    raise exception '0480 preflight: required relation auth.users is missing';
  end if;
  select n.nspname || '.' || t.typname
    into v_actual
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_type t on t.oid = a.atttypid
  join pg_namespace n on n.oid = t.typnamespace
  where c.oid = 'auth.users'::regclass
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;
  if v_actual is distinct from 'pg_catalog.uuid' then
    raise exception '0480 preflight: auth.users.id is missing or incompatible';
  end if;

  foreach v_spec in array array[
      'customers|id|pg_catalog.uuid',
      'customers|referred_by_customer_id|pg_catalog.uuid',
      'customers|full_name|pg_catalog.text',
      'customers|street|pg_catalog.text',
      'customers|city|pg_catalog.text',
      'customers|assigned_to|pg_catalog.uuid',
      'estimates|id|pg_catalog.uuid',
      'estimates|customer_id|pg_catalog.uuid',
      'estimates|status|public.estimate_status',
      'estimates|sent_at|pg_catalog.timestamptz',
      'estimates|title|pg_catalog.text',
      'estimates|created_at|pg_catalog.timestamptz',
      'estimates|approved_by_customer_id|pg_catalog.uuid',
      'jobs|id|pg_catalog.uuid',
      'jobs|customer_id|pg_catalog.uuid',
      'jobs|estimate_id|pg_catalog.uuid',
      'jobs|status|public.job_status',
      'jobs|scheduled_date|pg_catalog.date',
      'jobs|assigned_crew_id|pg_catalog.uuid',
      'jobs|created_at|pg_catalog.timestamptz',
      'invoices|id|pg_catalog.uuid',
      'invoices|customer_id|pg_catalog.uuid',
      'invoices|job_id|pg_catalog.uuid',
      'invoices|estimate_id|pg_catalog.uuid',
      'invoices|status|public.invoice_status',
      'invoices|number|pg_catalog.text',
      'invoices|created_at|pg_catalog.timestamptz',
      'invoices|idempotency_key|pg_catalog.text',
      'products|id|pg_catalog.uuid',
      'products|sku|pg_catalog.text',
      'products|name|pg_catalog.text',
      'products|active|pg_catalog.bool',
      'products|category|public.product_category',
      'products|search_text|pg_catalog.text',
      'products|avg_unit_cost|pg_catalog.numeric',
      'products|inventory_carrying_value|pg_catalog.numeric',
      'suppliers|id|pg_catalog.uuid',
      'install_crews|id|pg_catalog.uuid',
      'payments|id|pg_catalog.uuid',
      'payments|invoice_id|pg_catalog.uuid',
      'credit_memos|customer_id|pg_catalog.uuid',
      'credit_memos|estimate_id|pg_catalog.uuid',
      'refunds|customer_id|pg_catalog.uuid',
      'customer_deposits|customer_id|pg_catalog.uuid',
      'customer_deposits|estimate_id|pg_catalog.uuid',
      'orders|customer_id|pg_catalog.uuid',
      'orders|job_id|pg_catalog.uuid',
      'purchase_orders|customer_id|pg_catalog.uuid',
      'purchase_orders|job_id|pg_catalog.uuid',
      'purchase_orders|estimate_id|pg_catalog.uuid',
      'purchase_orders|supplier_id|pg_catalog.uuid',
      'stock_movements|customer_id|pg_catalog.uuid',
      'stock_movements|job_id|pg_catalog.uuid',
      'stock_movements|product_id|pg_catalog.uuid',
      'job_files|job_id|pg_catalog.uuid',
      'service_callbacks|customer_id|pg_catalog.uuid',
      'service_callbacks|job_id|pg_catalog.uuid',
      'opening_ar_items|customer_id|pg_catalog.uuid',
      'bills|customer_id|pg_catalog.uuid',
      'bills|job_id|pg_catalog.uuid',
      'bills|supplier_id|pg_catalog.uuid',
      'journal_lines|customer_id|pg_catalog.uuid',
      'journal_lines|invoice_id|pg_catalog.uuid',
      'journal_lines|vendor_id|pg_catalog.uuid',
      'sample_checkouts|customer_id|pg_catalog.uuid',
      'office_tasks|customer_id|pg_catalog.uuid',
      'profiles|customer_id|pg_catalog.uuid',
      'po_items|for_customer_id|pg_catalog.uuid',
      'po_items|product_id|pg_catalog.uuid',
      'customer_duplicate_overrides|created_customer_id|pg_catalog.uuid',
      'customer_duplicate_overrides|matched_customer_id|pg_catalog.uuid',
      'estimate_approval_snapshots|approved_by_customer_id|pg_catalog.uuid',
      'estimate_approval_snapshots|estimate_id|pg_catalog.uuid',
      'documents|customer_id|pg_catalog.uuid',
      'documents|path|pg_catalog.text',
      'activities|customer_id|pg_catalog.uuid',
      'messages|customer_id|pg_catalog.uuid',
      'appointments|customer_id|pg_catalog.uuid',
      'handoffs|customer_id|pg_catalog.uuid',
      'customer_areas|customer_id|pg_catalog.uuid',
      'estimate_drafts|customer_id|pg_catalog.uuid',
      'step_overrides|customer_id|pg_catalog.uuid',
      'service_addresses|customer_id|pg_catalog.uuid',
      'job_line_items|job_id|pg_catalog.uuid',
      'credit_applications|invoice_id|pg_catalog.uuid',
      'customer_deposit_applications|invoice_id|pg_catalog.uuid',
      'invoice_write_offs|invoice_id|pg_catalog.uuid',
      'job_labor|job_id|pg_catalog.uuid',
      'job_labor|crew_id|pg_catalog.uuid',
      'job_issues|job_id|pg_catalog.uuid',
      'installer_bills|job_id|pg_catalog.uuid',
      'installer_bills|crew_id|pg_catalog.uuid',
      'expenses|job_id|pg_catalog.uuid',
      'stock_rolls|product_id|pg_catalog.uuid',
      'estimate_line_items|product_id|pg_catalog.uuid',
      'order_items|product_id|pg_catalog.uuid',
      'sample_checkout_items|product_id|pg_catalog.uuid',
      'opening_ap_items|vendor_id|pg_catalog.uuid',
      'product_vendors|vendor_id|pg_catalog.uuid',
      'product_vendors|product_id|pg_catalog.uuid'
    ]
  loop
    v_table := split_part(v_spec, '|', 1);
    v_column := split_part(v_spec, '|', 2);
    v_type := split_part(v_spec, '|', 3);
    select n.nspname || '.' || t.typname
      into v_actual
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    join pg_namespace n on n.oid = t.typnamespace
    where a.attrelid = to_regclass('public.' || v_table)
      and a.attname = v_column
      and a.attnum > 0
      and not a.attisdropped;
    if v_actual is null then
      raise exception '0480 preflight: required column public.%.% is missing', v_table, v_column;
    end if;
    if v_actual is distinct from v_type then
      raise exception '0480 preflight: public.%.% type is incompatible', v_table, v_column;
    end if;
  end loop;

  -- archived_at / archived_by are added by this file. They are not required
  -- yet. A pre-existing column with the wrong type is incompatible.
  foreach v_table in array array[
    'customers', 'estimates', 'jobs', 'invoices', 'products', 'suppliers', 'install_crews'
  ]
  loop
    select n.nspname || '.' || t.typname
      into v_actual
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    join pg_namespace n on n.oid = t.typnamespace
    where a.attrelid = to_regclass('public.' || v_table)
      and a.attname = 'archived_at'
      and a.attnum > 0
      and not a.attisdropped;
    if v_actual is not null and v_actual is distinct from 'pg_catalog.timestamptz' then
      raise exception '0480 preflight: public.%.archived_at type is incompatible', v_table;
    end if;
    select n.nspname || '.' || t.typname
      into v_actual
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    join pg_namespace n on n.oid = t.typnamespace
    where a.attrelid = to_regclass('public.' || v_table)
      and a.attname = 'archived_by'
      and a.attnum > 0
      and not a.attisdropped;
    if v_actual is not null and v_actual is distinct from 'pg_catalog.uuid' then
      raise exception '0480 preflight: public.%.archived_by type is incompatible', v_table;
    end if;
  end loop;

  -- Status and category enums used by comparisons inside the lifecycle functions.
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'estimate_status' and e.enumlabel = 'draft'
  ) then
    raise exception '0480 preflight: estimate_status must include draft';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'estimate_status'
      and e.enumlabel in ('sent', 'approved', 'declined', 'changes_requested')
    having count(*) = 4
  ) then
    raise exception '0480 preflight: estimate_status is missing a canonical label';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'job_status' and e.enumlabel = 'unscheduled'
  ) then
    raise exception '0480 preflight: job_status must include unscheduled';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'job_status'
      and e.enumlabel in ('scheduled', 'in_progress', 'completed', 'cancelled')
    having count(*) = 4
  ) then
    raise exception '0480 preflight: job_status is missing a canonical label';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'invoice_status' and e.enumlabel = 'draft'
  ) then
    raise exception '0480 preflight: invoice_status must include draft';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'invoice_status'
      and e.enumlabel in ('sent', 'partial', 'paid', 'void')
    having count(*) = 4
  ) then
    raise exception '0480 preflight: invoice_status is missing a canonical label';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'product_category' and e.enumlabel = 'labor'
  ) then
    raise exception '0480 preflight: product_category must include labor';
  end if;
  foreach v_rel in array array[
    'admin', 'office', 'crew', 'customer', 'warehouse', 'sales_manager', 'salesman', 'scheduler'
  ]
  loop
    if not exists (
      select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = 'user_role' and e.enumlabel = v_rel
    ) then
      raise exception '0480 preflight: user_role is missing a canonical role';
    end if;
  end loop;

  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    raise exception '0480 preflight: pg_trgm is required by search_products';
  end if;

  -- Canonical functions that this file replaces. An unexpected signature is
  -- left untouched because execution stops here.
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'estimate_queue_page';
  if v_count <> 1 then
    raise exception '0480 preflight: estimate_queue_page must already exist as one function';
  end if;
  select pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
         p.prosecdef, l.lanname, p.provolatile
    into v_args, v_result, v_definer, v_lang, v_volatile
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname = 'estimate_queue_page';
  if v_args is distinct from 'p_status text, p_sent_before timestamp with time zone, p_mine uuid, p_search text, p_limit integer, p_offset integer'
     or v_result is distinct from 'TABLE(id uuid, total_count bigint)'
     or v_definer
     or v_lang is distinct from 'plpgsql'
     or v_volatile is distinct from 's' then
    raise exception '0480 preflight: estimate_queue_page signature is unexpected';
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'invoice_queue_page';
  if v_count <> 1 then
    raise exception '0480 preflight: invoice_queue_page must already exist as one function';
  end if;
  select pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
         p.prosecdef, l.lanname, p.provolatile
    into v_args, v_result, v_definer, v_lang, v_volatile
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname = 'invoice_queue_page';
  if v_args is distinct from 'p_statuses text[], p_search text, p_limit integer, p_offset integer'
     or v_result is distinct from 'TABLE(id uuid, total_count bigint)'
     or v_definer
     or v_lang is distinct from 'plpgsql'
     or v_volatile is distinct from 's' then
    raise exception '0480 preflight: invoice_queue_page signature is unexpected';
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'search_products';
  if v_count <> 1 then
    raise exception '0480 preflight: search_products must already exist as one function';
  end if;
  select pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
         p.prosecdef, l.lanname, p.provolatile
    into v_args, v_result, v_definer, v_lang, v_volatile
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname = 'search_products';
  if v_args is distinct from 'q text, lim integer, include_labor boolean, active_only boolean'
     or v_result is distinct from 'SETOF products'
     or v_definer
     or v_lang is distinct from 'plpgsql'
     or v_volatile is distinct from 's' then
    raise exception '0480 preflight: search_products signature is unexpected';
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'my_role';
  if v_count <> 1 then
    raise exception '0480 preflight: my_role must already exist as one function';
  end if;
  select pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
         p.prosecdef, l.lanname, p.prosrc
    into v_args, v_result, v_definer, v_lang, v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname = 'my_role';
  if coalesce(v_args, '') <> ''
     or v_result is distinct from 'text'
     or not v_definer
     or v_lang is distinct from 'sql'
     or v_src !~ 'user_role[[:space:]]*\([[:space:]]*auth\.uid\(\)[[:space:]]*\)[[:space:]]*::[[:space:]]*text' then
    raise exception '0480 preflight: my_role() signature is unexpected';
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'is_admin';
  if v_count <> 1 then
    raise exception '0480 preflight: is_admin must already exist as one function';
  end if;
  select pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
         p.prosecdef, l.lanname, p.prosrc
    into v_args, v_result, v_definer, v_lang, v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname = 'is_admin';
  if coalesce(v_args, '') <> ''
     or v_result is distinct from 'boolean'
     or not v_definer
     or v_lang is distinct from 'sql'
     or v_src !~ 'user_role[[:space:]]*\([[:space:]]*auth\.uid\(\)[[:space:]]*\)[[:space:]]*=[[:space:]]*''admin''' then
    raise exception '0480 preflight: is_admin() signature is unexpected';
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'is_staff';
  if v_count <> 1 then
    raise exception '0480 preflight: is_staff must already exist as one function';
  end if;
  select pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
         p.prosecdef, l.lanname, p.prosrc
    into v_args, v_result, v_definer, v_lang, v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public' and p.proname = 'is_staff';
  if coalesce(v_args, '') <> ''
     or v_result is distinct from 'boolean'
     or not v_definer
     or v_lang is distinct from 'sql'
     or v_src !~ 'user_role[[:space:]]*\([[:space:]]*auth\.uid\(\)[[:space:]]*\)[[:space:]]+in[[:space:]]*\([[:space:]]*''admin''[[:space:]]*,[[:space:]]*''office''[[:space:]]*\)'
     or v_src ~ 'sales_manager|salesman|scheduler|warehouse|''crew''|''customer''' then
    raise exception '0480 preflight: is_staff() is not limited to administrator and office';
  end if;

  -- 0478 queue functions are checked, not replaced.
  if to_regprocedure('public.job_queue_page(text, text, text, text, uuid, uuid, uuid[], boolean, integer, integer)') is null then
    raise exception '0480 preflight: job_queue_page signature from 0478 is missing';
  end if;
  if to_regprocedure('public.customer_queue_page(text, text, text, text, uuid[], uuid[], uuid, boolean, boolean, integer, integer)') is null then
    raise exception '0480 preflight: customer_queue_page signature from 0478 is missing';
  end if;
  if to_regprocedure('public.customer_strong_identifier_taken(text, text)') is null then
    raise exception '0480 preflight: customer_strong_identifier_taken signature from 0477 is missing';
  end if;

  -- Lifecycle functions are new. An existing unexpected overload is not replaced.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'lifecycle_commit_delete'
      and pg_get_function_identity_arguments(p.oid) is distinct from 'p_type text, p_id uuid, p_phrase text'
  ) then
    raise exception '0480 preflight: lifecycle_commit_delete has an unexpected signature';
  end if;
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'lifecycle_set_archived'
      and pg_get_function_identity_arguments(p.oid) is distinct from 'p_type text, p_id uuid, p_archive boolean'
  ) then
    raise exception '0480 preflight: lifecycle_set_archived has an unexpected signature';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception '0480 preflight: role authenticated is missing';
  end if;

  -- Products use column SELECT. The later grant is only archived_at and
  -- archived_by. Valuation columns and a table-level SELECT are incompatible
  -- with that grant, and this file does not revoke or widen them.
  if has_column_privilege('authenticated', 'public.products', 'id', 'select') is distinct from true
     or has_column_privilege('authenticated', 'public.products', 'name', 'select') is distinct from true
     or has_column_privilege('authenticated', 'public.products', 'active', 'select') is distinct from true
     or has_column_privilege('authenticated', 'public.products', 'category', 'select') is distinct from true
     or has_column_privilege('authenticated', 'public.products', 'search_text', 'select') is distinct from true
     or has_column_privilege('authenticated', 'public.products', 'sku', 'select') is distinct from true then
    raise exception '0480 preflight: products permission model is not the column-level catalog grant';
  end if;
  if has_column_privilege('authenticated', 'public.products', 'avg_unit_cost', 'select')
     or has_column_privilege('authenticated', 'public.products', 'inventory_carrying_value', 'select') then
    raise exception '0480 preflight: authenticated can read product valuation columns';
  end if;
  if exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    left join pg_roles role_row on role_row.oid = a.grantee
    where c.oid = 'public.products'::regclass
      and a.privilege_type = 'SELECT'
      and (role_row.rolname = 'authenticated' or a.grantee = 0)
  ) then
    raise exception '0480 preflight: products has table-level SELECT; archive columns will not widen it';
  end if;

  -- History, only when the Supabase migration table is actually present.
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise notice '0480 preflight: migration history table is absent; 0477, 0478, and 0479 are not rerun';
  else
    if not exists (
      select 1 from pg_attribute a
      where a.attrelid = 'supabase_migrations.schema_migrations'::regclass
        and a.attname = 'version'
        and a.attnum > 0
        and not a.attisdropped
    ) then
      raise exception '0480 preflight: migration history has no version column';
    end if;
    select exists (
      select 1 from pg_attribute a
      where a.attrelid = 'supabase_migrations.schema_migrations'::regclass
        and a.attname = 'name'
        and a.attnum > 0
        and not a.attisdropped
    ) into v_has_name;
    foreach v_rel in array array['0477', '0478', '0479']
    loop
      if v_has_name then
        execute
          'select count(*) from supabase_migrations.schema_migrations where version::text = $1 or version::text like $2 or name::text like $3'
          into v_hist
          using v_rel, v_rel || '%', v_rel || '%';
      else
        execute
          'select count(*) from supabase_migrations.schema_migrations where version::text = $1 or version::text like $2'
          into v_hist
          using v_rel, v_rel || '%';
      end if;
      if v_hist < 1 then
        raise exception '0480 preflight: migration % is not recorded', v_rel;
      end if;
    end loop;
  end if;

  create temp table lifecycle_0480_fk (
    child_table text not null,
    child_col text not null,
    parent_table text not null,
    parent_col text not null,
    delaction text not null,
    rewrite boolean not null,
    primary key (child_table, child_col, parent_table, parent_col)
  ) on commit drop;

  insert into lifecycle_0480_fk (
    child_table, child_col, parent_table, parent_col, delaction, rewrite
  ) values
    ('credit_memos', 'customer_id', 'customers', 'id', 'r', false),
    ('customer_deposits', 'customer_id', 'customers', 'id', 'r', false),
    ('customers', 'referred_by_customer_id', 'customers', 'id', 'a', false),
    ('opening_ar_items', 'customer_id', 'customers', 'id', 'r', false),
    ('refunds', 'customer_id', 'customers', 'id', 'r', false),
    ('service_callbacks', 'customer_id', 'customers', 'id', 'r', false),
    ('appointments', 'estimate_id', 'estimates', 'id', 'n', false),
    ('estimate_approval_snapshots', 'estimate_id', 'estimates', 'id', 'c', false),
    ('estimate_builder_drafts', 'estimate_id', 'estimates', 'id', 'c', false),
    ('estimate_events', 'estimate_id', 'estimates', 'id', 'c', false),
    ('estimate_options', 'estimate_id', 'estimates', 'id', 'c', false),
    ('office_tasks', 'estimate_id', 'estimates', 'id', 'n', false),
    ('credit_applications', 'invoice_id', 'invoices', 'id', 'r', false),
    ('customer_deposit_applications', 'invoice_id', 'invoices', 'id', 'r', false),
    ('customer_deposits', 'applied_invoice_id', 'invoices', 'id', 'n', false),
    ('invoice_items', 'invoice_id', 'invoices', 'id', 'c', false),
    ('invoice_write_offs', 'invoice_id', 'invoices', 'id', 'r', false),
    ('journal_lines', 'invoice_id', 'invoices', 'id', 'n', false),
    ('orders', 'invoice_id', 'invoices', 'id', 'n', false),
    ('customer_deposits', 'job_id', 'jobs', 'id', 'n', false),
    ('documents', 'job_id', 'jobs', 'id', 'n', false),
    ('install_preferences', 'job_id', 'jobs', 'id', 'c', false),
    ('job_applications', 'job_id', 'jobs', 'id', 'c', false),
    ('job_line_items', 'job_id', 'jobs', 'id', 'c', false),
    ('job_operational_holds', 'job_id', 'jobs', 'id', 'c', false),
    ('job_satisfaction', 'job_id', 'jobs', 'id', 'c', false),
    ('job_schedule_overrides', 'job_id', 'jobs', 'id', 'c', false),
    ('office_tasks', 'job_id', 'jobs', 'id', 'n', false),
    ('opening_ar_items', 'job_id', 'jobs', 'id', 'n', false),
    ('po_items', 'for_job_id', 'jobs', 'id', 'n', false),
    ('step_overrides', 'job_id', 'jobs', 'id', 'c', false),
    ('work_notes', 'job_id', 'jobs', 'id', 'c', false),
    ('price_import_lines', 'product_id', 'products', 'id', 'n', false),
    ('product_price_history', 'product_id', 'products', 'id', 'c', false),
    ('product_vendors', 'product_id', 'products', 'id', 'c', false),
    ('expenses', 'supplier_id', 'suppliers', 'id', 'n', false),
    ('install_crews', 'supplier_id', 'suppliers', 'id', 'n', false),
    ('job_issues', 'blame_supplier_id', 'suppliers', 'id', 'n', false),
    ('opening_ap_items', 'vendor_id', 'suppliers', 'id', 'r', false),
    ('price_imports', 'supplier_id', 'suppliers', 'id', 'n', false),
    ('products', 'supplier_id', 'suppliers', 'id', 'n', false),
    ('supplier_feeds', 'supplier_id', 'suppliers', 'id', 'c', false),
    ('activities', 'customer_id', 'customers', 'id', 'c', true),
    ('appointments', 'customer_id', 'customers', 'id', 'c', true),
    ('bills', 'customer_id', 'customers', 'id', 'n', true),
    ('customer_areas', 'customer_id', 'customers', 'id', 'c', true),
    ('customer_duplicate_overrides', 'created_customer_id', 'customers', 'id', 'n', true),
    ('customer_duplicate_overrides', 'matched_customer_id', 'customers', 'id', 'n', true),
    ('documents', 'customer_id', 'customers', 'id', 'c', true),
    ('estimate_approval_snapshots', 'approved_by_customer_id', 'customers', 'id', 'n', true),
    ('estimate_drafts', 'customer_id', 'customers', 'id', 'c', true),
    ('estimates', 'approved_by_customer_id', 'customers', 'id', 'n', true),
    ('estimates', 'customer_id', 'customers', 'id', 'c', true),
    ('handoffs', 'customer_id', 'customers', 'id', 'c', true),
    ('invoices', 'customer_id', 'customers', 'id', 'c', true),
    ('jobs', 'customer_id', 'customers', 'id', 'c', true),
    ('journal_lines', 'customer_id', 'customers', 'id', 'n', true),
    ('messages', 'customer_id', 'customers', 'id', 'c', true),
    ('office_tasks', 'customer_id', 'customers', 'id', 'n', true),
    ('orders', 'customer_id', 'customers', 'id', 'n', true),
    ('po_items', 'for_customer_id', 'customers', 'id', 'n', true),
    ('profiles', 'customer_id', 'customers', 'id', 'n', true),
    ('purchase_orders', 'customer_id', 'customers', 'id', 'n', true),
    ('sample_checkouts', 'customer_id', 'customers', 'id', 'c', true),
    ('service_addresses', 'customer_id', 'customers', 'id', 'c', true),
    ('step_overrides', 'customer_id', 'customers', 'id', 'c', true),
    ('stock_movements', 'customer_id', 'customers', 'id', 'n', true),
    ('credit_memos', 'estimate_id', 'estimates', 'id', 'n', true),
    ('customer_deposits', 'estimate_id', 'estimates', 'id', 'n', true),
    ('invoices', 'estimate_id', 'estimates', 'id', 'n', true),
    ('jobs', 'estimate_id', 'estimates', 'id', 'n', true),
    ('purchase_orders', 'estimate_id', 'estimates', 'id', 'n', true),
    ('installer_bills', 'crew_id', 'install_crews', 'id', 'n', true),
    ('job_labor', 'crew_id', 'install_crews', 'id', 'n', true),
    ('jobs', 'assigned_crew_id', 'install_crews', 'id', 'n', true),
    ('payments', 'invoice_id', 'invoices', 'id', 'c', true),
    ('bills', 'job_id', 'jobs', 'id', 'n', true),
    ('credit_memos', 'job_id', 'jobs', 'id', 'n', true),
    ('expenses', 'job_id', 'jobs', 'id', 'n', true),
    ('installer_bills', 'job_id', 'jobs', 'id', 'c', true),
    ('invoices', 'job_id', 'jobs', 'id', 'n', true),
    ('job_files', 'job_id', 'jobs', 'id', 'c', true),
    ('job_issues', 'job_id', 'jobs', 'id', 'c', true),
    ('job_labor', 'job_id', 'jobs', 'id', 'c', true),
    ('journal_lines', 'job_id', 'jobs', 'id', 'n', true),
    ('orders', 'job_id', 'jobs', 'id', 'n', true),
    ('purchase_orders', 'job_id', 'jobs', 'id', 'n', true),
    ('service_callbacks', 'job_id', 'jobs', 'id', 'n', true),
    ('stock_movements', 'job_id', 'jobs', 'id', 'n', true),
    ('stock_rolls', 'job_id', 'jobs', 'id', 'n', true),
    ('estimate_line_items', 'product_id', 'products', 'id', 'n', true),
    ('order_items', 'product_id', 'products', 'id', 'n', true),
    ('po_items', 'product_id', 'products', 'id', 'n', true),
    ('sample_checkout_items', 'product_id', 'products', 'id', 'n', true),
    ('stock_movements', 'product_id', 'products', 'id', 'c', true),
    ('stock_rolls', 'product_id', 'products', 'id', 'c', true),
    ('bills', 'supplier_id', 'suppliers', 'id', 'n', true),
    ('journal_lines', 'vendor_id', 'suppliers', 'id', 'n', true),
    ('product_vendors', 'vendor_id', 'suppliers', 'id', 'c', true),
    ('purchase_orders', 'supplier_id', 'suppliers', 'id', 'n', true);

  for r in
    select
      cn.nspname as child_schema,
      child.relname as child_table,
      (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as child_col,
      parent.relname as parent_table,
      (select a.attname from pg_attribute a where a.attrelid = c.confrelid and a.attnum = c.confkey[1]) as parent_col,
      c.confdeltype::text as delaction,
      c.convalidated,
      cardinality(c.conkey) as ncols
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_namespace cn on cn.oid = child.relnamespace
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace pn on pn.oid = parent.relnamespace
    where c.contype = 'f'
      and pn.nspname = 'public'
      and parent.relname in (
        'customers', 'estimates', 'jobs', 'invoices', 'products', 'suppliers', 'install_crews'
      )
  loop
    if r.child_schema is distinct from 'public' or r.ncols is distinct from 1 then
      raise exception '0480 preflight: unexpected foreign key shape on %.%', r.child_schema, r.child_table;
    end if;
    if not exists (
      select 1 from lifecycle_0480_fk e
      where e.child_table = r.child_table
        and e.child_col = r.child_col
        and e.parent_table = r.parent_table
        and e.parent_col = r.parent_col
    ) then
      raise exception '0480 preflight: unexpected foreign key %.% referencing %.%',
        r.child_table, r.child_col, r.parent_table, r.parent_col;
    end if;
    if not r.convalidated then
      raise exception '0480 preflight: foreign key %.% is not validated', r.child_table, r.child_col;
    end if;
  end loop;

  for fkexp in select * from lifecycle_0480_fk
  loop
    select count(*) into v_count
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_namespace cn on cn.oid = child.relnamespace
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace pn on pn.oid = parent.relnamespace
    where c.contype = 'f'
      and cn.nspname = 'public'
      and pn.nspname = 'public'
      and child.relname = fkexp.child_table
      and parent.relname = fkexp.parent_table
      and cardinality(c.conkey) = 1
      and (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = fkexp.child_col
      and (select a.attname from pg_attribute a where a.attrelid = c.confrelid and a.attnum = c.confkey[1]) = fkexp.parent_col;
    if v_count <> 1 then
      raise exception '0480 preflight: expected foreign key %.% referencing %.% was not found',
        fkexp.child_table, fkexp.child_col, fkexp.parent_table, fkexp.parent_col;
    end if;
    select c.confdeltype::text, c.convalidated
      into v_actual, v_definer
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_namespace cn on cn.oid = child.relnamespace
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace pn on pn.oid = parent.relnamespace
    where c.contype = 'f'
      and cn.nspname = 'public'
      and pn.nspname = 'public'
      and child.relname = fkexp.child_table
      and parent.relname = fkexp.parent_table
      and cardinality(c.conkey) = 1
      and (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = fkexp.child_col
      and (select a.attname from pg_attribute a where a.attrelid = c.confrelid and a.attnum = c.confkey[1]) = fkexp.parent_col;
    if fkexp.rewrite then
      if v_actual is distinct from fkexp.delaction and v_actual is distinct from 'r' then
        raise exception '0480 preflight: foreign key %.% has an unexpected delete action',
          fkexp.child_table, fkexp.child_col;
      end if;
      if v_actual in ('c', 'n') then
        execute format(
          'select count(*) from public.%I as child_row where child_row.%I is not null and not exists (select 1 from public.%I as parent_row where parent_row.%I = child_row.%I)',
          fkexp.child_table, fkexp.child_col, fkexp.parent_table, fkexp.parent_col, fkexp.child_col
        ) into v_orphans;
        if v_orphans > 0 then
          raise exception '0480 preflight: existing rows do not satisfy %.% referencing %.%',
            fkexp.child_table, fkexp.child_col, fkexp.parent_table, fkexp.parent_col;
        end if;
      end if;
    else
      if v_actual is distinct from fkexp.delaction then
        raise exception '0480 preflight: foreign key %.% has an unexpected delete action',
          fkexp.child_table, fkexp.child_col;
      end if;
    end if;
  end loop;

  -- Drop only the constraint just proven above. The catalog name is read
  -- again here; it is not assumed from a previous migration file.
  for fkexp in select * from lifecycle_0480_fk where rewrite
  loop
    select c.conname as conname,
           c.confdeltype::text as confdeltype,
           pg_get_constraintdef(c.oid) as def
      into r
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_namespace cn on cn.oid = child.relnamespace
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace pn on pn.oid = parent.relnamespace
    where c.contype = 'f'
      and cn.nspname = 'public'
      and pn.nspname = 'public'
      and child.relname = fkexp.child_table
      and parent.relname = fkexp.parent_table
      and cardinality(c.conkey) = 1
      and (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = fkexp.child_col
      and (select a.attname from pg_attribute a where a.attrelid = c.confrelid and a.attnum = c.confkey[1]) = fkexp.parent_col;
    if r.confdeltype is distinct from 'c' and r.confdeltype is distinct from 'n' then
      continue;
    end if;
    v_newdef := regexp_replace(r.def, 'ON DELETE (CASCADE|SET NULL)', 'ON DELETE RESTRICT', 'i');
    if v_newdef is not distinct from r.def then
      raise exception '0480 preflight: could not prove the delete action for %.%', fkexp.child_table, fkexp.child_col;
    end if;
    execute format('alter table public.%I drop constraint %I', fkexp.child_table, r.conname);
    execute format('alter table public.%I add constraint %I %s', fkexp.child_table, r.conname, v_newdef);
  end loop;

  execute $fk0480ddl$
-- 1) Archive columns. Business statuses are not reused. --------------------
alter table public.customers
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;
alter table public.estimates
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;
alter table public.jobs
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;
alter table public.invoices
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;
alter table public.products
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;
-- Products use column-level SELECT. New columns stay invisible until granted,
-- which made lifecycle_set_archived and search_products fail for every role.
grant select (archived_at, archived_by) on public.products to authenticated;
alter table public.suppliers
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;
alter table public.install_crews
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;

create index if not exists customers_archived_idx on public.customers (archived_at) where archived_at is not null;
create index if not exists estimates_archived_idx on public.estimates (archived_at) where archived_at is not null;
create index if not exists jobs_archived_idx on public.jobs (archived_at) where archived_at is not null;
create index if not exists invoices_archived_idx on public.invoices (archived_at) where archived_at is not null;
create index if not exists products_archived_idx on public.products (archived_at) where archived_at is not null;
create index if not exists suppliers_archived_idx on public.suppliers (archived_at) where archived_at is not null;

-- 2) Audit trail that survives deletion of the business row. ----------------
create table if not exists public.record_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('archive', 'restore', 'delete_forever', 'delete_blocked')),
  record_type text not null,
  record_id uuid not null,
  performed_by uuid references auth.users (id) on delete set null,
  performed_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);
create index if not exists record_lifecycle_events_record_idx
  on public.record_lifecycle_events (record_type, record_id, performed_at desc);

alter table public.record_lifecycle_events enable row level security;
drop policy if exists record_lifecycle_events_staff_read on public.record_lifecycle_events;
create policy record_lifecycle_events_staff_read on public.record_lifecycle_events
  for select to authenticated
  using (public.is_staff());
drop policy if exists record_lifecycle_events_staff_insert on public.record_lifecycle_events;
create policy record_lifecycle_events_staff_insert on public.record_lifecycle_events
  for insert to authenticated
  with check (public.is_staff());
revoke update, delete on public.record_lifecycle_events from authenticated;
revoke update, delete on public.record_lifecycle_events from anon;

-- 3) Storage cleanup outbox. Paths only. No file display names. -------------
create table if not exists public.record_lifecycle_storage_outbox (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  record_type text not null,
  record_id uuid not null,
  created_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  completed_at timestamptz
);
alter table public.record_lifecycle_storage_outbox enable row level security;
drop policy if exists record_lifecycle_storage_admin on public.record_lifecycle_storage_outbox;
create policy record_lifecycle_storage_admin on public.record_lifecycle_storage_outbox
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5) Direct deletes are refused. The lifecycle function sets a transaction
--    flag after it has rechecked dependencies and confirmed the caller is admin.
create or replace function public.lifecycle_delete_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.lifecycle_delete', true), '') = 'on' then
    if public.is_admin() then
      return old;
    end if;
    raise exception 'permanent delete requires an administrator';
  end if;
  raise exception 'permanent delete must use the lifecycle confirmation';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'estimates', 'jobs', 'invoices', 'payments', 'products',
    'suppliers', 'install_crews', 'credit_memos', 'refunds',
    'customer_deposits'
  ]
  loop
    execute format('drop trigger if exists lifecycle_delete_guard on public.%I', t);
    execute format(
      'create trigger lifecycle_delete_guard before delete on public.%I for each row execute function public.lifecycle_delete_guard()',
      t
    );
  end loop;
end $$;

-- 6) Archive / restore. Administrator or office only.
-- is_staff() is not the check: archive must stay administrator and office
-- even if that helper is ever widened. Other roles that can update a row
-- (scheduler on jobs, warehouse on jobs, sales on customers) still cannot
-- change archived_at. The column guard enforces that on every update.
create or replace function public.lifecycle_may_archive()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role() in ('admin', 'office');
$$;

revoke all on function public.lifecycle_may_archive() from public;
revoke all on function public.lifecycle_may_archive() from anon;
grant execute on function public.lifecycle_may_archive() to authenticated;

create or replace function public.lifecycle_archive_column_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.lifecycle_may_archive() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.archived_at is null and new.archived_by is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.archived_at is not distinct from old.archived_at
     and new.archived_by is not distinct from old.archived_by then
    return new;
  end if;
  raise exception 'archive requires an administrator or office role';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'estimates', 'jobs', 'invoices', 'products', 'suppliers', 'install_crews'
  ]
  loop
    execute format('drop trigger if exists lifecycle_archive_column_guard on public.%I', t);
    execute format(
      'create trigger lifecycle_archive_column_guard before insert or update on public.%I for each row execute function public.lifecycle_archive_column_guard()',
      t
    );
  end loop;
end $$;

-- Idempotent. Does not touch money, inventory, or files.
create or replace function public.lifecycle_set_archived(
  p_type text,
  p_id uuid,
  p_archive boolean
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_table text;
  v_archived timestamptz;
begin
  if not public.lifecycle_may_archive() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  v_table := case p_type
    when 'customer' then 'customers'
    when 'estimate' then 'estimates'
    when 'job' then 'jobs'
    when 'invoice' then 'invoices'
    when 'product' then 'products'
    when 'supplier' then 'suppliers'
    when 'installer' then 'install_crews'
    else null
  end;
  if v_table is null then
    return jsonb_build_object('ok', false, 'error', 'unsupported');
  end if;
  execute format('select archived_at from public.%I where id = $1', v_table)
    into v_archived
    using p_id;
  if v_archived is null and not p_archive then
    return jsonb_build_object('ok', true, 'status', 'already_active');
  end if;
  if v_archived is not null and p_archive then
    return jsonb_build_object('ok', true, 'status', 'already_archived');
  end if;
  if p_archive then
    execute format(
      'update public.%I set archived_at = now(), archived_by = $2 where id = $1',
      v_table
    ) using p_id, auth.uid();
  else
    execute format(
      'update public.%I set archived_at = null, archived_by = null where id = $1',
      v_table
    ) using p_id;
  end if;
  insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
  values (
    case when p_archive then 'archive' else 'restore' end,
    p_type,
    p_id,
    auth.uid(),
    '{}'::jsonb
  );
  return jsonb_build_object(
    'ok', true,
    'status', case when p_archive then 'archived' else 'restored' end
  );
end;
$$;

revoke all on function public.lifecycle_set_archived(text, uuid, boolean) from public;
revoke all on function public.lifecycle_set_archived(text, uuid, boolean) from anon;
grant execute on function public.lifecycle_set_archived(text, uuid, boolean) to authenticated;

-- Confirmation code matches docRef(): PREFIX- plus the last 6 alphanumeric
-- characters of the id. No customer name is required or accepted.
create or replace function public.lifecycle_public_code(p_prefix text, p_id uuid)
returns text
language sql
immutable
as $$
  select p_prefix || '-' || upper(right(replace(p_id::text, '-', ''), 6));
$$;

create or replace function public.lifecycle_phrase_ok(p_phrase text, p_expected text)
returns boolean
language sql
immutable
as $$
  select upper(btrim(coalesce(p_phrase, ''))) = upper(btrim(coalesce(p_expected, '')));
$$;

revoke all on function public.lifecycle_public_code(text, uuid) from public;
revoke all on function public.lifecycle_public_code(text, uuid) from anon;
grant execute on function public.lifecycle_public_code(text, uuid) to authenticated;
revoke all on function public.lifecycle_phrase_ok(text, text) from public;
revoke all on function public.lifecycle_phrase_ok(text, text) from anon;
grant execute on function public.lifecycle_phrase_ok(text, text) to authenticated;

-- 7) Permanent delete. Locks the row, recounts, and blocks if protection appears.
create or replace function public.lifecycle_commit_delete(
  p_type text,
  p_id uuid,
  p_phrase text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_number text;
  v_phrase text;
  v_expected text;
  v_invoices int := 0;
  v_payments int := 0;
  v_credits int := 0;
  v_refunds int := 0;
  v_deposits int := 0;
  v_orders int := 0;
  v_pos int := 0;
  v_jobs int := 0;
  v_other_estimates int := 0;
  v_snapshots int := 0;
  v_stock int := 0;
  v_blocked boolean := false;
  v_callbacks int := 0;
  v_opening int := 0;
  v_bills int := 0;
  v_journal int := 0;
  v_samples int := 0;
  v_tasks int := 0;
  v_profiles int := 0;
  v_links int := 0;
  v_dupes int := 0;
  v_refs int := 0;
  v_writeoffs int := 0;
  v_labor int := 0;
  v_issues int := 0;
  v_expenses int := 0;
  v_service int := 0;
  v_files int := 0;
  v_when text;
begin
  if not public.is_admin() then
    insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
    values ('delete_blocked', p_type, p_id, auth.uid(), jsonb_build_object('error', 'not_authorized'));
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  perform set_config('app.lifecycle_delete', 'on', true);

  if p_type = 'payment' then
    insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
    values ('delete_blocked', 'payment', p_id, auth.uid(), jsonb_build_object('reason', 'financial_record'));
    return jsonb_build_object('ok', false, 'error', 'blocked', 'blocked', jsonb_build_array('financial_record'));
  elsif p_type = 'customer' then
    select c.id into v_number from public.customers c where c.id = p_id for update;
    if not found then
      return jsonb_build_object('ok', true, 'status', 'already_deleted');
    end if;
    v_expected := 'DELETE ' || public.lifecycle_public_code('CUS', p_id);
    if not public.lifecycle_phrase_ok(p_phrase, v_expected) then
      return jsonb_build_object('ok', false, 'error', 'confirmation');
    end if;
    select count(*) into v_invoices from public.invoices where customer_id = p_id;
    select count(*) into v_credits from public.credit_memos where customer_id = p_id;
    select count(*) into v_refunds from public.refunds where customer_id = p_id;
    select count(*) into v_deposits from public.customer_deposits where customer_id = p_id;
    select count(*) into v_orders from public.orders where customer_id = p_id;
    select count(*) into v_pos from public.purchase_orders where customer_id = p_id;
    select count(*) into v_stock from public.stock_movements where customer_id = p_id;
    select count(*) into v_other_estimates from public.estimates where customer_id = p_id and status::text <> 'draft';
    select count(*) into v_jobs from public.jobs
      where customer_id = p_id
        and (status::text <> 'unscheduled' or scheduled_date is not null);
    select count(*) into v_payments from public.job_files jf
      join public.jobs j on j.id = jf.job_id
      where j.customer_id = p_id;
    select count(*) into v_callbacks from public.service_callbacks where customer_id = p_id;
    select count(*) into v_opening from public.opening_ar_items where customer_id = p_id;
    select count(*) into v_bills from public.bills where customer_id = p_id;
    select count(*) into v_journal from public.journal_lines where customer_id = p_id;
    select count(*) into v_samples from public.sample_checkouts where customer_id = p_id;
    select count(*) into v_tasks from public.office_tasks where customer_id = p_id;
    select count(*) into v_profiles from public.profiles where customer_id = p_id;
    select count(*) into v_links from public.po_items where for_customer_id = p_id;
    select count(*) into v_dupes from public.customer_duplicate_overrides
      where created_customer_id = p_id or matched_customer_id = p_id;
    select count(*) into v_refs from public.customers where referred_by_customer_id = p_id;
    select count(*) into v_snapshots from public.estimate_approval_snapshots
      where approved_by_customer_id = p_id;
    select count(*) into v_files from public.estimates
      where approved_by_customer_id = p_id
        and customer_id is distinct from p_id;
    v_snapshots := v_snapshots + v_files;
    v_blocked := v_invoices > 0 or v_credits > 0 or v_refunds > 0 or v_deposits > 0
      or v_orders > 0 or v_pos > 0 or v_stock > 0 or v_other_estimates > 0
      or v_jobs > 0 or v_payments > 0
      or v_callbacks > 0 or v_opening > 0 or v_bills > 0 or v_journal > 0
      or v_samples > 0 or v_tasks > 0 or v_profiles > 0 or v_links > 0
      or v_dupes > 0 or v_refs > 0 or v_snapshots > 0;
    if v_blocked then
      insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
      values ('delete_blocked', 'customer', p_id, auth.uid(), jsonb_build_object(
        'invoices', v_invoices, 'orders', v_orders, 'purchase_orders', v_pos,
        'sample_checkouts', v_samples, 'service_callbacks', v_callbacks
      ));
      return jsonb_build_object('ok', false, 'error', 'blocked');
    end if;
    insert into public.record_lifecycle_storage_outbox (bucket, path, record_type, record_id)
    select 'documents', d.path, 'customer', p_id
    from public.documents d
    where d.customer_id = p_id and d.path is not null;
    insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
    values ('delete_forever', 'customer', p_id, auth.uid(), jsonb_build_object('invoices', 0, 'orders', 0));
    delete from public.activities where customer_id = p_id;
    delete from public.messages where customer_id = p_id;
    delete from public.appointments where customer_id = p_id;
    delete from public.documents where customer_id = p_id;
    delete from public.handoffs where customer_id = p_id;
    delete from public.customer_areas where customer_id = p_id;
    delete from public.estimate_drafts where customer_id = p_id;
    delete from public.step_overrides where customer_id = p_id;
    delete from public.service_addresses where customer_id = p_id;
    delete from public.job_line_items li
      using public.jobs j
      where li.job_id = j.id
        and j.customer_id = p_id
        and j.status::text = 'unscheduled'
        and j.scheduled_date is null;
    delete from public.jobs where customer_id = p_id and status::text = 'unscheduled' and scheduled_date is null;
    delete from public.estimates where customer_id = p_id and status::text = 'draft';
    delete from public.customers where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'deleted');
  elsif p_type = 'estimate' then
    select e.status::text into v_status from public.estimates e where e.id = p_id for update;
    if not found then
      return jsonb_build_object('ok', true, 'status', 'already_deleted');
    end if;
    if not public.lifecycle_phrase_ok(p_phrase, 'DELETE ' || public.lifecycle_public_code('EST', p_id)) then
      return jsonb_build_object('ok', false, 'error', 'confirmation');
    end if;
    select count(*) into v_jobs from public.jobs where estimate_id = p_id;
    select count(*) into v_invoices from public.invoices where estimate_id = p_id;
    select count(*) into v_deposits from public.customer_deposits where estimate_id = p_id;
    select count(*) into v_pos from public.purchase_orders where estimate_id = p_id;
    select count(*) into v_snapshots from public.estimate_approval_snapshots where estimate_id = p_id;
    select count(*) into v_credits from public.credit_memos where estimate_id = p_id;
    if v_status is distinct from 'draft' or v_jobs > 0 or v_invoices > 0 or v_deposits > 0 or v_pos > 0 or v_snapshots > 0 or v_credits > 0 then
      insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
      values ('delete_blocked', 'estimate', p_id, auth.uid(), jsonb_build_object('status', v_status));
      return jsonb_build_object('ok', false, 'error', 'blocked');
    end if;
    insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
    values ('delete_forever', 'estimate', p_id, auth.uid(), '{}'::jsonb);
    delete from public.estimates where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'deleted');
  elsif p_type = 'job' then
    select j.status::text, j.scheduled_date::text into v_status, v_when
      from public.jobs j where j.id = p_id for update;
    if not found then
      return jsonb_build_object('ok', true, 'status', 'already_deleted');
    end if;
    if not public.lifecycle_phrase_ok(p_phrase, 'DELETE ' || public.lifecycle_public_code('JOB', p_id)) then
      return jsonb_build_object('ok', false, 'error', 'confirmation');
    end if;
    select count(*) into v_invoices from public.invoices where job_id = p_id;
    select count(*) into v_pos from public.purchase_orders where job_id = p_id;
    select count(*) into v_stock from public.stock_movements where job_id = p_id;
    select count(*) into v_files from public.job_files where job_id = p_id;
    select count(*) into v_labor from public.job_labor where job_id = p_id;
    select count(*) into v_issues from public.job_issues where job_id = p_id;
    select count(*) into v_credits from public.installer_bills where job_id = p_id;
    select count(*) into v_service from public.service_callbacks where job_id = p_id;
    select count(*) into v_orders from public.orders where job_id = p_id;
    select count(*) into v_expenses from public.expenses where job_id = p_id;
    select count(*) into v_bills from public.bills where job_id = p_id;
    if v_status is distinct from 'unscheduled'
       or coalesce(btrim(v_when), '') <> ''
       or v_invoices > 0 or v_pos > 0 or v_stock > 0 or v_files > 0
       or v_labor > 0 or v_issues > 0 or v_credits > 0 or v_service > 0
       or v_orders > 0 or v_expenses > 0 or v_bills > 0 then
      insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
      values ('delete_blocked', 'job', p_id, auth.uid(), jsonb_build_object('status', v_status, 'files', v_files));
      return jsonb_build_object('ok', false, 'error', 'blocked');
    end if;
    insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
    values ('delete_forever', 'job', p_id, auth.uid(), '{}'::jsonb);
    delete from public.job_line_items where job_id = p_id;
    delete from public.jobs where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'deleted');
  elsif p_type = 'invoice' then
    select i.status::text, i.number into v_status, v_number from public.invoices i where i.id = p_id for update;
    if not found then
      return jsonb_build_object('ok', true, 'status', 'already_deleted');
    end if;
    v_expected := case when coalesce(btrim(v_number), '') = '' then 'DELETE' else 'DELETE ' || btrim(v_number) end;
    if upper(btrim(coalesce(p_phrase, ''))) is distinct from upper(v_expected) then
      return jsonb_build_object('ok', false, 'error', 'confirmation');
    end if;
    select count(*) into v_payments from public.payments where invoice_id = p_id;
    select count(*) into v_credits from public.credit_applications where invoice_id = p_id;
    select count(*) into v_deposits from public.customer_deposit_applications where invoice_id = p_id;
    select count(*) into v_writeoffs from public.invoice_write_offs where invoice_id = p_id;
    select count(*) into v_journal from public.journal_lines where invoice_id = p_id;
    if v_status is distinct from 'draft'
       or v_payments > 0 or v_credits > 0 or v_deposits > 0
       or v_writeoffs > 0 or v_journal > 0 then
      insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
      values ('delete_blocked', 'invoice', p_id, auth.uid(), jsonb_build_object(
        'payments', v_payments, 'write_offs', v_writeoffs, 'journal_lines', v_journal
      ));
      return jsonb_build_object('ok', false, 'error', 'blocked');
    end if;
    insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
    values ('delete_forever', 'invoice', p_id, auth.uid(), jsonb_build_object('payments', 0));
    delete from public.invoices where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'deleted');
  elsif p_type in ('product', 'supplier', 'installer') then
    if p_type = 'product' then
      select p.sku into v_number from public.products p where p.id = p_id for update;
      if not found then
        return jsonb_build_object('ok', true, 'status', 'already_deleted');
      end if;
      v_expected := case
        when coalesce(btrim(v_number), '') = '' then 'DELETE ' || public.lifecycle_public_code('PRD', p_id)
        else 'DELETE ' || btrim(v_number)
      end;
      if not public.lifecycle_phrase_ok(p_phrase, v_expected) then
        return jsonb_build_object('ok', false, 'error', 'confirmation');
      end if;
      select count(*) into v_pos from public.po_items where product_id = p_id;
      select count(*) into v_stock from public.stock_movements where product_id = p_id;
      select count(*) into v_jobs from public.estimate_line_items where product_id = p_id;
      select count(*) into v_files from public.stock_rolls where product_id = p_id;
      select count(*) into v_orders from public.order_items where product_id = p_id;
      select count(*) into v_samples from public.sample_checkout_items where product_id = p_id;
      v_blocked := v_pos > 0 or v_stock > 0 or v_jobs > 0 or v_files > 0 or v_orders > 0 or v_samples > 0;
    elsif p_type = 'supplier' then
      perform 1 from public.suppliers where id = p_id for update;
      if not found then
        return jsonb_build_object('ok', true, 'status', 'already_deleted');
      end if;
      if not public.lifecycle_phrase_ok(p_phrase, 'DELETE ' || public.lifecycle_public_code('VND', p_id)) then
        return jsonb_build_object('ok', false, 'error', 'confirmation');
      end if;
      select count(*) into v_pos from public.purchase_orders where supplier_id = p_id;
      select count(*) into v_credits from public.bills where supplier_id = p_id;
      select count(*) into v_journal from public.journal_lines where vendor_id = p_id;
      select count(*) into v_opening from public.opening_ap_items where vendor_id = p_id;
      select count(*) into v_links from public.product_vendors where vendor_id = p_id;
      v_blocked := v_pos > 0 or v_credits > 0 or v_journal > 0 or v_opening > 0 or v_links > 0;
    else
      perform 1 from public.install_crews where id = p_id for update;
      if not found then
        return jsonb_build_object('ok', true, 'status', 'already_deleted');
      end if;
      if not public.lifecycle_phrase_ok(p_phrase, 'DELETE ' || public.lifecycle_public_code('CRW', p_id)) then
        return jsonb_build_object('ok', false, 'error', 'confirmation');
      end if;
      select count(*) into v_jobs from public.jobs where assigned_crew_id = p_id;
      select count(*) into v_credits from public.installer_bills where crew_id = p_id;
      select count(*) into v_labor from public.job_labor where crew_id = p_id;
      v_blocked := v_jobs > 0 or v_credits > 0 or v_labor > 0;
    end if;
    if v_blocked then
      insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
      values ('delete_blocked', p_type, p_id, auth.uid(), '{}'::jsonb);
      return jsonb_build_object('ok', false, 'error', 'blocked');
    end if;
    insert into public.record_lifecycle_events (action, record_type, record_id, performed_by, detail)
    values ('delete_forever', p_type, p_id, auth.uid(), '{}'::jsonb);
    if p_type = 'product' then
      delete from public.product_vendors where product_id = p_id;
      delete from public.products where id = p_id;
    elsif p_type = 'supplier' then
      delete from public.suppliers where id = p_id;
    else
      delete from public.install_crews where id = p_id;
    end if;
    if not found then
      return jsonb_build_object('ok', true, 'status', 'already_deleted');
    end if;
    return jsonb_build_object('ok', true, 'status', 'deleted');
  end if;

  return jsonb_build_object('ok', false, 'error', 'unsupported');
end;
$$;

revoke all on function public.lifecycle_commit_delete(text, uuid, text) from public;
revoke all on function public.lifecycle_commit_delete(text, uuid, text) from anon;
grant execute on function public.lifecycle_commit_delete(text, uuid, text) to authenticated;

-- 8) Active queues hide archived rows once this migration is applied.
--    The previous function signatures stay callable. These replacements keep
--    the same arguments and add the archive predicate.
create or replace function public.estimate_queue_page(
  p_status text default null,
  p_sent_before timestamptz default null,
  p_mine uuid default null,
  p_search text default null,
  p_limit int default 40,
  p_offset int default 0
) returns table (id uuid, total_count bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 80);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_total bigint;
begin
  if v_search is not null and char_length(v_search) >= 2 then
    v_like := '%' || replace(replace(v_search, '%', ''), '_', '') || '%';
  else
    v_like := null;
  end if;

  select count(*) into v_total
  from public.estimates e
  left join public.customers c on c.id = e.customer_id
  where e.archived_at is null
    and (p_status is null or e.status::text = p_status)
    and (p_sent_before is null or e.sent_at < p_sent_before)
    and (p_mine is null or c.assigned_to = p_mine)
    and (
      v_like is null
      or e.title ilike v_like
      or c.full_name ilike v_like
      or c.street ilike v_like
      or c.city ilike v_like
    );

  return query
  select picked.id, v_total
  from (
    select e.id
    from public.estimates e
    left join public.customers c on c.id = e.customer_id
    where e.archived_at is null
      and (p_status is null or e.status::text = p_status)
      and (p_sent_before is null or e.sent_at < p_sent_before)
      and (p_mine is null or c.assigned_to = p_mine)
      and (
        v_like is null
        or e.title ilike v_like
        or c.full_name ilike v_like
        or c.street ilike v_like
        or c.city ilike v_like
      )
    order by e.created_at desc, e.id desc
    limit v_limit
    offset v_offset
  ) picked;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;

create or replace function public.invoice_queue_page(
  p_statuses text[] default null,
  p_search text default null,
  p_limit int default 40,
  p_offset int default 0
) returns table (id uuid, total_count bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 80);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_total bigint;
begin
  if v_search is not null and char_length(v_search) >= 2 then
    v_like := '%' || replace(replace(v_search, '%', ''), '_', '') || '%';
  else
    v_like := null;
  end if;

  select count(*) into v_total
  from public.invoices i
  left join public.customers c on c.id = i.customer_id
  where i.archived_at is null
    and (
      p_statuses is null
      or cardinality(p_statuses) = 0
      or i.status::text = any (p_statuses)
    )
    and (
      v_like is null
      or i.number ilike v_like
      or c.full_name ilike v_like
    );

  return query
  select picked.id, v_total
  from (
    select i.id
    from public.invoices i
    left join public.customers c on c.id = i.customer_id
    where i.archived_at is null
      and (
        p_statuses is null
        or cardinality(p_statuses) = 0
        or i.status::text = any (p_statuses)
      )
      and (
        v_like is null
        or i.number ilike v_like
        or c.full_name ilike v_like
      )
    order by i.created_at desc, i.id desc
    limit v_limit
    offset v_offset
  ) picked;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;

-- 9) Estimate and purchase-order product search skips archived products.
--    Same signature as 0187. Ranking is unchanged.
create or replace function public.search_products(
  q text,
  lim int default 50,
  include_labor boolean default false,
  active_only boolean default true
)
returns setof public.products
language plpgsql
stable
as $$
declare
  toks text[];
  n    int;
  cols text;
begin
  select string_agg(
    case
      when a.attname in ('avg_unit_cost', 'inventory_carrying_value') then
        format('null::%s as %I', format_type(a.atttypid, a.atttypmod), a.attname)
      else format('p.%I', a.attname)
    end,
    ', ' order by a.attnum
  )
  into cols
  from pg_attribute a
  where a.attrelid = 'public.products'::regclass
    and a.attnum > 0
    and not a.attisdropped;

  if cols is null or length(cols) = 0 then
    raise exception '0480_SEARCH: no products columns to project';
  end if;

  q := trim(coalesce(q, ''));
  if q = '' then
    return query execute format(
      $sql$
        select %s
          from public.products p
         where p.archived_at is null
           and ($1 is not true or p.active)
           and ($2 is true or p.category is distinct from 'labor')
         order by p.name
         limit $3
      $sql$, cols)
      using active_only, include_labor, lim;
    return;
  end if;

  toks := array_remove(regexp_split_to_array(lower(q), '[^a-z0-9/.]+'), '');
  n := coalesce(array_length(toks, 1), 0);
  if n = 0 then
    return query execute format(
      $sql$
        select %s
          from public.products p
         where p.archived_at is null
           and ($1 is not true or p.active)
           and ($2 is true or p.category is distinct from 'labor')
         order by p.name
         limit $3
      $sql$, cols)
      using active_only, include_labor, lim;
    return;
  end if;

  return query execute format(
    $sql$
    with base as (
      select
        %s,
        lower(p.name) as _nm,
        lower(p.search_text || ' ' || coalesce(p.category::text, '')) as _hay
      from public.products p
      where p.archived_at is null
        and ($1 is not true or p.active)
        and ($2 is true or p.category is distinct from 'labor')
    ),
    scored as (
      select
        b.*,
        (select coalesce(sum(
           case
             when position(t in b._nm) > 0 then 4
             when position(t in b._hay) > 0 then 3
             when length(t) >= 4
                  and word_similarity(t, b._hay) >= 0.6 then 2
             else 0
           end), 0)
         from unnest($4::text[]) t) as _score,
        (select count(*) from unnest($4::text[]) t
          where position(t in b._hay) > 0
             or (length(t) >= 4 and word_similarity(t, b._hay) >= 0.6)
        ) as _hits
      from base b
    )
    select %s
      from scored s
     where s._score > 0
     order by
       (s._hits = $5) desc,
       s._score desc,
       similarity(s._nm, lower($6)) desc,
       s.name
     limit $3
    $sql$,
    cols,
    (
      select string_agg(format('s.%I', a.attname), ', ' order by a.attnum)
      from pg_attribute a
      where a.attrelid = 'public.products'::regclass
        and a.attnum > 0
        and not a.attisdropped
    )
  )
  using active_only, include_labor, lim, toks, n, q;
end;
$$;

$fk0480ddl$;
end
$fk0480mig$;
