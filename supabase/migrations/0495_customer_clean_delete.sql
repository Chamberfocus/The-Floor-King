-- Clean delete of one customer, including files and the records that belong to them.
-- An administrator who types DELETE is removing that customer from the CRM.
-- Other customers are not touched. Warehouse quantities stay; the job link is cleared.
-- Does not enable accounting. Does not change posting flags.
--
-- Ordinary deletes still refuse posted invoices, payments, and job cost history.
-- Those guards step aside only while app.customer_purge is on, and only this
-- function turns that setting on.

create or replace function public.customer_purge_in_progress()
returns boolean
language sql
stable
as $$
  select current_setting('app.customer_purge', true) = 'on';
$$;

revoke all on function public.customer_purge_in_progress() from public, anon, authenticated;

create or replace function public.refuse_payment_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.customer_purge_in_progress() then
    return old;
  end if;
  raise exception 'PAYMENT_HISTORY'
    using errcode = 'P0001',
          hint = 'Void the payment. Payment rows are not deleted.';
end;
$$;

create or replace function public.refuse_posted_invoice_delete()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_payments int;
  v_credits int;
  v_deposits int;
  v_writeoffs int;
begin
  if public.customer_purge_in_progress() then
    return old;
  end if;

  if old.status is distinct from 'draft'::public.invoice_status then
    raise exception 'POSTED_INVOICE'
      using errcode = 'P0001',
            hint = 'Void the invoice. Do not delete posted invoice history.';
  end if;

  select count(*) into v_payments
  from public.payments
  where invoice_id = old.id;
  if v_payments > 0 then
    raise exception 'PAYMENT_HISTORY'
      using errcode = 'P0001',
            hint = 'Void payments. Do not delete payment history.';
  end if;

  select count(*) into v_credits
  from public.credit_applications
  where invoice_id = old.id;
  if v_credits > 0 then
    raise exception 'CREDIT_APPLICATION'
      using errcode = 'P0001',
            hint = 'Void the credit application. Do not delete the invoice.';
  end if;

  select count(*) into v_deposits
  from public.customer_deposit_applications
  where invoice_id = old.id;
  if v_deposits > 0 then
    raise exception 'DEPOSIT_APPLICATION'
      using errcode = 'P0001',
            hint = 'Void the deposit application. Do not delete the invoice.';
  end if;

  select count(*) into v_writeoffs
  from public.invoice_write_offs
  where invoice_id = old.id;
  if v_writeoffs > 0 then
    raise exception 'WRITE_OFF'
      using errcode = 'P0001',
            hint = 'Void the write-off. Do not delete the invoice.';
  end if;

  return old;
end;
$$;

create or replace function public.refuse_job_cost_history_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.customer_purge_in_progress() then
    return old;
  end if;
  raise exception 'JOB_FINANCIAL_HISTORY'
    using errcode = 'P0001',
          hint = 'Labor, installer bills, true-ups, and commission rows are not deleted.';
end;
$$;

create or replace function public.refuse_job_delete_with_financial_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.customer_purge_in_progress() then
    return old;
  end if;

  if old.status is distinct from 'unscheduled'::public.job_status
     or old.scheduled_date is not null
     or old.completed_at is not null
     or old.actual_labor_cost is not null
  then
    raise exception 'OPERATIONAL_JOB'
      using errcode = 'P0001',
            hint = 'Scheduled, in-progress, completed, and cancelled jobs are not deleted.';
  end if;

  if exists (select 1 from public.job_labor where job_id = old.id)
     or exists (select 1 from public.installer_bills where job_id = old.id)
     or exists (select 1 from public.job_true_ups where job_id = old.id)
     or exists (select 1 from public.job_commission_ledger where job_id = old.id)
  then
    raise exception 'JOB_FINANCIAL_HISTORY'
      using errcode = 'P0001',
            hint = 'Job cost history stays on the books.';
  end if;

  if public.job_has_posted_invoice(old.id) then
    raise exception 'POSTED_INVOICE'
      using errcode = 'P0001',
            hint = 'Do not delete a job that still has posted invoice history.';
  end if;

  if exists (select 1 from public.expenses where job_id = old.id) then
    raise exception 'EXPENSE_HISTORY'
      using errcode = 'P0001',
            hint = 'Expenses stay on the books.';
  end if;

  if exists (select 1 from public.bills where job_id = old.id) then
    raise exception 'SUPPLIER_BILL'
      using errcode = 'P0001',
            hint = 'Supplier bills stay on the books.';
  end if;

  if exists (select 1 from public.orders where job_id = old.id) then
    raise exception 'MATERIAL_ORDER'
      using errcode = 'P0001',
            hint = 'Customer orders stay on the books.';
  end if;

  if exists (
    select 1
    from public.purchase_orders po
    join public.po_items pi on pi.po_id = po.id
    where po.job_id = old.id
      and coalesce(pi.received_qty, 0) > 0
  ) then
    raise exception 'PURCHASE_ORDER_RECEIPTS'
      using errcode = 'P0001',
            hint = 'Receiving history stays on the books.';
  end if;

  if exists (
    select 1
    from public.purchase_orders po
    where po.job_id = old.id
      and po.status is distinct from 'draft'::public.po_status
  ) then
    raise exception 'ISSUED_PURCHASE_ORDER'
      using errcode = 'P0001',
            hint = 'Issued purchase orders stay on the books.';
  end if;

  if exists (
    select 1 from public.stock_movements
    where job_id = old.id and kind = 'pull'
  ) then
    raise exception 'INVENTORY_PULL'
      using errcode = 'P0001',
            hint = 'Pulled inventory stays on the books.';
  end if;

  if exists (select 1 from public.stock_rolls where job_id = old.id) then
    raise exception 'STOCK_ALLOCATION'
      using errcode = 'P0001',
            hint = 'Allocated rolls stay on the books.';
  end if;

  if exists (
    select 1
    from (
      select
        coalesce(sum(case when kind in ('reserve', 'release') then qty else 0 end), 0)
          - coalesce(sum(case when kind = 'pull' then abs(qty) else 0 end), 0) as outstanding
      from public.stock_movements
      where job_id = old.id
        and product_id is not null
      group by product_id, line_id
    ) held
    where held.outstanding > 0
  ) then
    raise exception 'RESERVATION_RELEASE_FAILED'
      using errcode = 'P0001',
            hint = 'Release reservations before deleting a bare draft job.';
  end if;

  return old;
end;
$$;

create or replace function public.refuse_estimate_delete_with_financial_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.customer_purge_in_progress() then
    return old;
  end if;

  if exists (
    select 1 from public.estimate_approval_snapshots where estimate_id = old.id
  ) then
    raise exception 'APPROVAL_HISTORY'
      using errcode = 'P0001',
            hint = 'Approval snapshots stay on the books.';
  end if;

  if exists (
    select 1
    from public.invoices i
    where i.estimate_id = old.id
      and (
        i.status is distinct from 'draft'::public.invoice_status
        or exists (select 1 from public.payments p where p.invoice_id = i.id)
        or exists (select 1 from public.credit_applications c where c.invoice_id = i.id)
        or exists (select 1 from public.customer_deposit_applications d where d.invoice_id = i.id)
        or exists (select 1 from public.invoice_write_offs w where w.invoice_id = i.id)
      )
  ) then
    raise exception 'POSTED_INVOICE'
      using errcode = 'P0001',
            hint = 'Do not delete an estimate that still has posted invoice history.';
  end if;

  if exists (
    select 1
    from public.jobs j
    where j.estimate_id = old.id
      and (
        j.status is distinct from 'unscheduled'::public.job_status
        or j.scheduled_date is not null
        or j.completed_at is not null
        or j.actual_labor_cost is not null
        or public.job_has_posted_invoice(j.id)
        or exists (select 1 from public.job_labor where job_id = j.id)
        or exists (select 1 from public.installer_bills where job_id = j.id)
        or exists (select 1 from public.job_true_ups where job_id = j.id)
        or exists (select 1 from public.job_commission_ledger where job_id = j.id)
      )
  ) then
    raise exception 'OPERATIONAL_JOB'
      using errcode = 'P0001',
            hint = 'The estimate still has a committed work order.';
  end if;

  return old;
end;
$$;

create or replace function public.refuse_customer_delete_with_financial_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.customer_purge_in_progress() then
    return old;
  end if;

  if exists (
    select 1
    from public.invoices i
    where i.customer_id = old.id
      and (
        i.status is distinct from 'draft'::public.invoice_status
        or exists (select 1 from public.payments p where p.invoice_id = i.id)
        or exists (select 1 from public.credit_applications c where c.invoice_id = i.id)
        or exists (select 1 from public.customer_deposit_applications d where d.invoice_id = i.id)
        or exists (select 1 from public.invoice_write_offs w where w.invoice_id = i.id)
      )
  ) then
    raise exception 'POSTED_INVOICE'
      using errcode = 'P0001',
            hint = 'Do not delete a customer who still has posted invoice history.';
  end if;

  if exists (
    select 1
    from public.estimates e
    join public.estimate_approval_snapshots s on s.estimate_id = e.id
    where e.customer_id = old.id
  ) then
    raise exception 'APPROVAL_HISTORY'
      using errcode = 'P0001',
            hint = 'Approval snapshots stay on the books.';
  end if;

  if exists (
    select 1
    from public.jobs j
    where j.customer_id = old.id
      and (
        j.status is distinct from 'unscheduled'::public.job_status
        or j.scheduled_date is not null
        or j.completed_at is not null
        or j.actual_labor_cost is not null
        or public.job_has_posted_invoice(j.id)
        or exists (select 1 from public.job_labor where job_id = j.id)
        or exists (select 1 from public.installer_bills where job_id = j.id)
        or exists (select 1 from public.job_true_ups where job_id = j.id)
        or exists (select 1 from public.job_commission_ledger where job_id = j.id)
        or exists (select 1 from public.expenses where job_id = j.id)
        or exists (select 1 from public.bills where job_id = j.id)
        or exists (select 1 from public.orders where job_id = j.id)
        or exists (
          select 1 from public.stock_movements sm
          where sm.job_id = j.id and sm.kind = 'pull'
        )
      )
  ) then
    raise exception 'JOB_FINANCIAL_HISTORY'
      using errcode = 'P0001',
            hint = 'Customer financial history stays on the books.';
  end if;

  if exists (select 1 from public.bills where customer_id = old.id)
     or exists (select 1 from public.orders where customer_id = old.id)
  then
    raise exception 'MATERIAL_ORDER'
      using errcode = 'P0001',
            hint = 'Supplier bills and customer orders stay on the books.';
  end if;

  return old;
end;
$$;

create or replace function public.prevent_approval_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.estimate_id is distinct from old.estimate_id
       or new.version is distinct from old.version
       or new.payload is distinct from old.payload
       or new.accepted_option_id is distinct from old.accepted_option_id
       or new.approved_at is distinct from old.approved_at
       or new.approval_source is distinct from old.approval_source
       or new.approved_by_user_id is distinct from old.approved_by_user_id
       or new.approved_by_customer_id is distinct from old.approved_by_customer_id
    then
      raise exception 'estimate_approval_snapshots are immutable';
    end if;
  elsif tg_op = 'DELETE' then
    if public.customer_purge_in_progress() then
      return old;
    end if;
    raise exception 'estimate_approval_snapshots are append-only; delete is not allowed';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.delete_customer_clean(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_files jsonb := '[]'::jsonb;
  v_pass int;
  v_deleted int;
  v_row_count int;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;

  if to_regclass('public.documents') is not null then
    select coalesce(
      jsonb_agg(jsonb_build_object('bucket', 'documents', 'path', d.path))
        filter (where d.path is not null and length(btrim(d.path)) > 0),
      '[]'::jsonb
    )
      into v_files
    from public.documents d
    where d.customer_id = p_customer_id;
  end if;

  if to_regclass('public.job_files') is not null and to_regclass('public.jobs') is not null then
    select v_files || coalesce(
      jsonb_agg(jsonb_build_object('bucket', 'job-files', 'path', f.path))
        filter (where f.path is not null and length(btrim(f.path)) > 0),
      '[]'::jsonb
    )
      into v_files
    from public.job_files f
    join public.jobs j on j.id = f.job_id
    where j.customer_id = p_customer_id;
  end if;

  perform set_config('app.customer_purge', 'on', true);
  perform set_config('app.allow_customer_delete', 'on', true);

  for r in
    select
      n.nspname as child_schema,
      c.relname as child_table,
      a.attname as child_column,
      a.attnotnull as not_null,
      array_length(con.conkey, 1) as child_key_count,
      array_length(con.confkey, 1) as parent_key_count,
      pa.attname as parent_column
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = con.conrelid
     and a.attnum = con.conkey[1]
    join pg_attribute pa
      on pa.attrelid = con.confrelid
     and pa.attnum = con.confkey[1]
    where con.contype = 'f'
      and con.confrelid = 'public.customers'::regclass
  loop
    if r.child_key_count <> 1 or r.parent_key_count <> 1 or r.parent_column <> 'id' then
      raise exception 'CUSTOMER_DELETE_UNSUPPORTED'
        using hint = format('%I.%I', r.child_schema, r.child_table);
    end if;
    if not r.not_null and r.child_schema = 'public' then
      execute format(
        'update %I.%I set %I = null where %I = $1',
        r.child_schema, r.child_table, r.child_column, r.child_column
      )
      using p_customer_id;
    end if;
  end loop;

  if to_regclass('public.job_commission_payment_lines') is not null
     and to_regclass('public.job_commission_ledger') is not null
     and to_regclass('public.jobs') is not null then
    delete from public.job_commission_payment_lines
    where ledger_id in (
      select l.id
      from public.job_commission_ledger l
      join public.jobs j on j.id = l.job_id
      where j.customer_id = p_customer_id
    );
  end if;

  if to_regclass('public.refunds') is not null then
    delete from public.refunds where customer_id = p_customer_id;
  end if;

  if to_regclass('public.credit_applications') is not null
     and to_regclass('public.credit_memos') is not null
     and to_regclass('public.invoices') is not null then
    delete from public.credit_applications
    where credit_memo_id in (
        select id from public.credit_memos where customer_id = p_customer_id
      )
       or invoice_id in (
        select id from public.invoices where customer_id = p_customer_id
      );
  end if;

  if to_regclass('public.credit_memos') is not null then
    delete from public.credit_memos where customer_id = p_customer_id;
  end if;

  if to_regclass('public.customer_deposit_applications') is not null
     and to_regclass('public.customer_deposits') is not null
     and to_regclass('public.invoices') is not null then
    delete from public.customer_deposit_applications
    where deposit_id in (
        select id from public.customer_deposits where customer_id = p_customer_id
      )
       or invoice_id in (
        select id from public.invoices where customer_id = p_customer_id
      );
  end if;

  if to_regclass('public.customer_deposits') is not null then
    delete from public.customer_deposits where customer_id = p_customer_id;
  end if;

  if to_regclass('public.service_callbacks') is not null then
    delete from public.service_callbacks where customer_id = p_customer_id;
  end if;

  if to_regclass('public.opening_ar_items') is not null then
    delete from public.opening_ar_items where customer_id = p_customer_id;
  end if;

  for v_pass in 1..8 loop
    v_deleted := 0;
    for r in
      select n.nspname as child_schema, c.relname as child_table, a.attname as child_column
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a
        on a.attrelid = con.conrelid
       and a.attnum = con.conkey[1]
       and a.attnotnull
      join pg_attribute pa
        on pa.attrelid = con.confrelid
       and pa.attnum = con.confkey[1]
      where con.contype = 'f'
        and con.confrelid = 'public.customers'::regclass
        and array_length(con.conkey, 1) = 1
        and array_length(con.confkey, 1) = 1
        and pa.attname = 'id'
        and n.nspname = 'public'
        and c.relname <> 'customers'
    loop
      begin
        execute format(
          'delete from %I.%I where %I = $1',
          r.child_schema, r.child_table, r.child_column
        )
        using p_customer_id;
        get diagnostics v_row_count = row_count;
        v_deleted := v_deleted + v_row_count;
      exception
        when others then
          if v_pass = 8 then
            raise;
          end if;
      end;
    end loop;
    exit when v_deleted = 0;
  end loop;

  insert into public.customer_delete_audit (customer_id, deleted_by)
  values (p_customer_id, auth.uid());

  delete from public.customers where id = p_customer_id;

  return jsonb_build_object(
    'ok', true,
    'deleted', true,
    'files', coalesce(v_files, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.delete_customer_clean(uuid) from public, anon;
grant execute on function public.delete_customer_clean(uuid) to authenticated;
