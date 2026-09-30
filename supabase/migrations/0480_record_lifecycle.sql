-- 0480 — Record lifecycle: archive, restore, and guarded permanent delete.
-- DO NOT APPLY until the owner reviews this file.
-- Safe to re-run. Does not delete business rows. Does not enable accounting.
-- Production 0477, 0478, and 0479 are unchanged.

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

-- 4) Stop silent cascade / set-null on the dangerous parents. ---------------
-- Unknown children then fail the delete instead of disappearing or detaching.
do $$
declare
  r record;
  newdef text;
begin
  for r in
    select c.conname,
           n.nspname,
           rel.relname as child,
           frel.relname as parent,
           pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class frel on frel.oid = c.confrelid
    where n.nspname = 'public'
      and c.contype = 'f'
      and c.confdeltype in ('c', 'n')
      and (
        frel.relname = 'customers'
        or (frel.relname = 'invoices' and rel.relname = 'payments')
        or (
          frel.relname = 'jobs'
          and rel.relname in (
            'invoices', 'purchase_orders', 'orders', 'stock_movements',
            'expenses', 'bills', 'stock_rolls', 'journal_lines', 'credit_memos',
            'job_files', 'job_labor', 'job_issues', 'installer_bills', 'service_callbacks'
          )
        )
        or (
          frel.relname = 'estimates'
          and rel.relname in ('jobs', 'invoices', 'purchase_orders', 'credit_memos', 'customer_deposits')
        )
        or (
          frel.relname = 'products'
          and rel.relname in (
            'stock_movements', 'stock_rolls', 'estimate_line_items', 'po_items',
            'order_items', 'sample_checkout_items'
          )
        )
        or (
          frel.relname = 'suppliers'
          and rel.relname in ('journal_lines', 'purchase_orders', 'bills', 'opening_ap_items', 'product_vendors')
        )
        or (
          frel.relname = 'install_crews'
          and rel.relname in ('jobs', 'installer_bills', 'job_labor')
        )
      )
  loop
    newdef := regexp_replace(r.def, 'ON DELETE (CASCADE|SET NULL)', 'ON DELETE RESTRICT', 'i');
    if newdef = r.def then
      newdef := r.def || ' ON DELETE RESTRICT';
    end if;
    execute format('alter table %I.%I drop constraint %I', r.nspname, r.child, r.conname);
    execute format('alter table %I.%I add constraint %I %s', r.nspname, r.child, r.conname, newdef);
  end loop;
end $$;

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

-- 6) Archive / restore. Idempotent. Does not touch money, inventory, or files.
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
  if not (public.is_admin() or public.is_staff()) then
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
