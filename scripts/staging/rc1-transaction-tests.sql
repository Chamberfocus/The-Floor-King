-- RC1 database tests for migrations 0487–0491.
-- Fictional rows only. This file always ends with ROLLBACK.
-- Run it only through scripts/staging-migrate.mjs prove, and only after
-- 0001–0491 have been applied to lsrapxmkspocxeeakkcx.
-- Do not paste this file into the production SQL editor.

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim', '{"role":"service_role"}', true);

do $rc1_preflight$
begin
  if to_regclass('public.workflow_stages') is null
     or to_regclass('public.customers') is null
     or to_regclass('public.jobs') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.job_labor') is null
     or to_regclass('public.products') is null
     or to_regclass('public.purchase_orders') is null
     or to_regclass('public.po_items') is null
     or to_regclass('public.stock_movements') is null
     or to_regclass('public.inventory_action_idempotency') is null
  then
    raise exception 'RC1_ASSERT: staging schema is incomplete';
  end if;

  if to_regprocedure('public.cancel_job_with_reservations(uuid)') is null
     or to_regprocedure('public.receive_po_lines_safe(uuid,jsonb,uuid)') is null
     or to_regprocedure('public.accounting_request_jwt_role()') is null
  then
    raise exception 'RC1_ASSERT: RC1 functions are missing';
  end if;

  if public.accounting_request_jwt_role() is distinct from 'service_role' then
    raise exception 'RC1_ASSERT: service_role JWT was not visible (got %)',
      public.accounting_request_jwt_role();
  end if;
end
$rc1_preflight$;

-- 0487: an explicit outcome beats the display name.
do $rc1_0487$
declare
  v_id uuid;
  v_outcome text;
begin
  insert into public.workflow_stages (name, position, outcome)
  values ('RC1 install follow-up', 9487, 'lost')
  returning id into v_id;

  select outcome into v_outcome
  from public.workflow_stages
  where id = v_id;

  if v_outcome is distinct from 'lost' then
    raise exception 'RC1_ASSERT: explicit lost outcome was stored as %', v_outcome;
  end if;

  begin
    insert into public.workflow_stages (name, position, outcome)
    values ('RC1 bad outcome', 9488, 'nope');
    raise exception 'RC1_ASSERT: invalid outcome was accepted';
  exception
    when check_violation then
      null;
  end;
end
$rc1_0487$;

-- 0488: posted invoices and any payment row cannot be deleted.
do $rc1_0488$
declare
  v_customer uuid;
  v_sent uuid;
  v_bare uuid;
  v_draft uuid;
  v_payment uuid;
begin
  insert into public.customers (full_name)
  values ('RC1 Staging Fiction')
  returning id into v_customer;

  insert into public.invoices (customer_id, status, number)
  values (v_customer, 'sent', 'RC1-SENT')
  returning id into v_sent;

  begin
    delete from public.invoices where id = v_sent;
    raise exception 'RC1_ASSERT: posted invoice delete was allowed';
  exception
    when others then
      if sqlerrm not like '%POSTED_INVOICE%' then
        raise;
      end if;
  end;

  if not exists (select 1 from public.invoices where id = v_sent) then
    raise exception 'RC1_ASSERT: posted invoice row disappeared';
  end if;

  insert into public.invoices (customer_id, status, number)
  values (v_customer, 'draft', 'RC1-BARE')
  returning id into v_bare;

  delete from public.invoices where id = v_bare;
  if exists (select 1 from public.invoices where id = v_bare) then
    raise exception 'RC1_ASSERT: bare draft invoice was kept';
  end if;

  insert into public.invoices (customer_id, status, number)
  values (v_customer, 'draft', 'RC1-DRAFT')
  returning id into v_draft;

  insert into public.payments (invoice_id, amount)
  values (v_draft, 25.00)
  returning id into v_payment;

  begin
    delete from public.invoices where id = v_draft;
    raise exception 'RC1_ASSERT: invoice with a payment was deleted';
  exception
    when others then
      if sqlerrm not like '%PAYMENT_HISTORY%' then
        raise;
      end if;
  end;

  begin
    delete from public.payments where id = v_payment;
    raise exception 'RC1_ASSERT: payment delete was allowed';
  exception
    when others then
      if sqlerrm not like '%PAYMENT_HISTORY%' then
        raise;
      end if;
  end;

  if not exists (select 1 from public.payments where id = v_payment) then
    raise exception 'RC1_ASSERT: payment row disappeared';
  end if;
end
$rc1_0488$;

-- 0489: completed jobs stay completed; a failed release does not cancel the job.
do $rc1_0489$
declare
  v_customer uuid;
  v_product uuid;
  v_completed uuid;
  v_bare uuid;
  v_held uuid;
  v_res jsonb;
  v_status text;
  v_key text;
  v_groups int;
begin
  insert into public.customers (full_name)
  values ('RC1 Cancel Fiction')
  returning id into v_customer;

  insert into public.products (name, track_stock)
  values ('RC1 fiction plank', false)
  returning id into v_product;

  insert into public.jobs (customer_id, status, title)
  values (v_customer, 'completed', 'RC1 completed job')
  returning id into v_completed;

  v_res := public.cancel_job_with_reservations(v_completed);
  if coalesce((v_res->>'ok')::boolean, true)
     or v_res->>'code' is distinct from 'JOB_COMPLETED' then
    raise exception 'RC1_ASSERT: completed job was not refused (got %)', v_res;
  end if;

  select status::text into v_status from public.jobs where id = v_completed;
  if v_status is distinct from 'completed' then
    raise exception 'RC1_ASSERT: completed job status changed to %', v_status;
  end if;

  insert into public.jobs (customer_id, title)
  values (v_customer, 'RC1 bare job')
  returning id into v_bare;

  v_res := public.cancel_job_with_reservations(v_bare);
  if coalesce((v_res->>'ok')::boolean, false) is distinct from true then
    raise exception 'RC1_ASSERT: bare cancel failed (got %)', v_res;
  end if;

  select status::text into v_status from public.jobs where id = v_bare;
  if v_status is distinct from 'cancelled' then
    raise exception 'RC1_ASSERT: bare job status is %', v_status;
  end if;

  insert into public.jobs (customer_id, title)
  values (v_customer, 'RC1 held job')
  returning id into v_held;

  insert into public.stock_movements (product_id, qty, kind, job_id, source_type)
  values (v_product, 4, 'reserve', v_held, 'job_reserve');

  select count(*) into v_groups
  from (
    select product_id, line_id
    from public.stock_movements
    where job_id = v_held
      and product_id is not null
      and voided_at is null
      and kind in ('reserve', 'release', 'pull')
    group by product_id, line_id
  ) groups;

  if v_groups is distinct from 1 then
    raise exception 'RC1_ASSERT: expected one reservation group, found %', v_groups;
  end if;

  select
    'cancel-job:' || v_held::text || ':' || product_id::text || ':'
      || coalesce(line_id::text, '_') || ':'
      || round(greatest(0, coalesce(sum(
           case
             when kind = 'reserve' then qty
             when kind = 'release' then qty
             when kind = 'pull' then -abs(qty)
             else 0
           end
         ), 0)), 4)::text || ':'
      || count(*)::int::text
  into v_key
  from public.stock_movements
  where job_id = v_held
    and product_id is not null
    and voided_at is null
    and kind in ('reserve', 'release', 'pull')
  group by product_id, line_id;

  -- A reused key with a different action makes release_inventory_safe return
  -- ok=false. cancel_job_with_reservations must raise and leave the job open.
  insert into public.inventory_action_idempotency (idempotency_key, action, context_hash, status)
  values (v_key, 'not_release_inventory', 'rc1-mismatch', 'pending');

  begin
    perform public.cancel_job_with_reservations(v_held);
    raise exception 'RC1_ASSERT: held cancel should have raised';
  exception
    when others then
      if sqlerrm not like '%RESERVATION_RELEASE_FAILED%' then
        raise;
      end if;
  end;

  select status::text into v_status from public.jobs where id = v_held;
  if v_status is distinct from 'unscheduled' then
    raise exception 'RC1_ASSERT: failed release changed job status to %', v_status;
  end if;
end
$rc1_0489$;

-- 0490: labor history blocks its own delete and the job delete.
do $rc1_0490$
declare
  v_customer uuid;
  v_job uuid;
  v_labor uuid;
begin
  insert into public.customers (full_name)
  values ('RC1 Labor Fiction')
  returning id into v_customer;

  insert into public.jobs (customer_id, title)
  values (v_customer, 'RC1 labor job')
  returning id into v_job;

  insert into public.job_labor (job_id, payee, amount)
  values (v_job, 'RC1 Fiction Crew', 40)
  returning id into v_labor;

  begin
    delete from public.job_labor where id = v_labor;
    raise exception 'RC1_ASSERT: labor delete was allowed';
  exception
    when others then
      if sqlerrm not like '%JOB_FINANCIAL_HISTORY%' then
        raise;
      end if;
  end;

  if not exists (select 1 from public.job_labor where id = v_labor) then
    raise exception 'RC1_ASSERT: labor row disappeared';
  end if;

  begin
    delete from public.jobs where id = v_job;
    raise exception 'RC1_ASSERT: job with labor was deleted';
  exception
    when others then
      if sqlerrm not like '%JOB_FINANCIAL_HISTORY%' then
        raise;
      end if;
  end;

  if not exists (select 1 from public.jobs where id = v_job) then
    raise exception 'RC1_ASSERT: job row disappeared';
  end if;
end
$rc1_0490$;

-- 0491: the second line's over-receive rolls back the first line.
-- Fixed ids keep po_item_id order stable (0000… is applied before ffff…).
do $rc1_0491$
declare
  v_customer uuid := '11111111-1111-4111-8111-111111111111';
  v_product uuid := '22222222-2222-4222-8222-222222222222';
  v_po uuid := '33333333-3333-4333-8333-333333333333';
  v_line1 uuid := '00000000-0000-4000-8000-000000000001';
  v_line2 uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  v_ok_po uuid := '44444444-4444-4444-8444-444444444444';
  v_ok_line uuid := '55555555-5555-4555-8555-555555555555';
  v_res jsonb;
  v_count int;
  v_status text;
begin
  insert into public.customers (id, full_name)
  values (v_customer, 'RC1 Receive Fiction');

  insert into public.products (id, name, track_stock, stock_kind)
  values (v_product, 'RC1 fiction tile', true, 'discrete');

  insert into public.purchase_orders (id, customer_id, supplier, status)
  values (v_po, v_customer, 'RC1 Fiction Supply', 'ordered');

  insert into public.po_items (id, po_id, product_id, description, quantity, unit_cost)
  values
    (v_line1, v_po, v_product, 'RC1 line A', 10, 2.50),
    (v_line2, v_po, v_product, 'RC1 line B', 1, 2.50);

  begin
    perform public.receive_po_lines_safe(
      v_po,
      jsonb_build_array(
        jsonb_build_object('po_item_id', v_line1, 'target_received_qty', 2),
        jsonb_build_object('po_item_id', v_line2, 'target_received_qty', 5)
      )
    );
    raise exception 'RC1_ASSERT: over-receive was accepted';
  exception
    when others then
      if sqlerrm not like '%INV_OVER_RECEIVE%'
         and sqlerrm not like '%PO_RECEIVE_FAILED%' then
        raise;
      end if;
  end;

  select count(*) into v_count
  from public.stock_movements
  where po_id = v_po;
  if v_count <> 0 then
    raise exception 'RC1_ASSERT: failed receive left % stock movements', v_count;
  end if;

  select status::text into v_status
  from public.purchase_orders
  where id = v_po;
  if v_status is distinct from 'ordered' then
    raise exception 'RC1_ASSERT: failed receive changed PO status to %', v_status;
  end if;

  insert into public.purchase_orders (id, customer_id, supplier, status)
  values (v_ok_po, v_customer, 'RC1 Fiction Supply', 'ordered');

  insert into public.po_items (id, po_id, product_id, description, quantity, unit_cost)
  values (v_ok_line, v_ok_po, v_product, 'RC1 line ok', 10, 2.50);

  v_res := public.receive_po_lines_safe(
    v_ok_po,
    jsonb_build_array(
      jsonb_build_object('po_item_id', v_ok_line, 'target_received_qty', 3)
    )
  );
  if coalesce((v_res->>'ok')::boolean, false) is distinct from true then
    raise exception 'RC1_ASSERT: in-range receive failed (got %)', v_res;
  end if;

  select count(*) into v_count
  from public.stock_movements
  where po_id = v_ok_po and kind = 'receive';
  if v_count < 1 then
    raise exception 'RC1_ASSERT: in-range receive posted no movement';
  end if;

  select status::text into v_status
  from public.purchase_orders
  where id = v_ok_po;
  if v_status is distinct from 'ordered' then
    raise exception 'RC1_ASSERT: receive function changed PO status to %', v_status;
  end if;
end
$rc1_0491$;

rollback;
