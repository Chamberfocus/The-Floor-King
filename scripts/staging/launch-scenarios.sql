-- Isolated staging scenarios. Always ends with ROLLBACK.
-- Run only against lsrapxmkspocxeeakkcx.

begin;

do $launch_identity$
begin
  if (select project_ref from public.floor_king_database_identity where id = 1)
     is distinct from 'lsrapxmkspocxeeakkcx' then
    raise exception 'LAUNCH_ASSERT: refusing tests outside staging';
  end if;
end
$launch_identity$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- A + D: customer, estimate, job, invoice, payment, then deletion is refused.
do $launch_a$
declare
  v_customer uuid;
  v_estimate uuid;
  v_job uuid;
  v_invoice uuid;
  v_payment uuid;
  v_street text;
begin
  insert into public.customers (full_name, street, city, state, zip, phone, email)
  values (
    'Launch Fiction Homeowner',
    '4500 Euclid Ave Apt 4B',
    'Cleveland',
    'OH',
    '44103',
    '216-555-0199',
    'launch-fiction@example.com'
  )
  returning id into v_customer;

  select street into v_street from public.customers where id = v_customer;
  if v_street is distinct from '4500 Euclid Ave Apt 4B' then
    raise exception 'LAUNCH_ASSERT: address was not stored';
  end if;

  insert into public.estimates (customer_id, status, tax_rate)
  values (v_customer, 'approved', 0.08)
  returning id into v_estimate;

  insert into public.jobs (customer_id, title, status)
  values (v_customer, 'Launch fiction install', 'unscheduled')
  returning id into v_job;

  insert into public.invoices (customer_id, status, number)
  values (v_customer, 'sent', 'LAUNCH-A')
  returning id into v_invoice;

  insert into public.payments (invoice_id, amount, method)
  values (v_invoice, 150.00, 'cash')
  returning id into v_payment;

  if (select amount from public.payments where id = v_payment) <> 150 then
    raise exception 'LAUNCH_ASSERT: deposit amount changed';
  end if;

  begin
    delete from public.invoices where id = v_invoice;
    raise exception 'LAUNCH_ASSERT: invoice with a payment was deleted';
  exception
    when others then
      if sqlerrm not like '%PAYMENT_HISTORY%' and sqlerrm not like '%POSTED_INVOICE%' then
        raise;
      end if;
  end;

  begin
    delete from public.customers where id = v_customer;
    raise exception 'LAUNCH_ASSERT: customer with financial activity was deleted';
  exception
    when others then
      if sqlerrm like '%LAUNCH_ASSERT%' then
        raise;
      end if;
      if sqlerrm not like '%violates foreign key%'
         and sqlerrm not like '%FINANCIAL%'
         and sqlerrm not like '%POSTED_INVOICE%'
         and sqlerrm not like '%PAYMENT_HISTORY%'
         and sqlerrm not like '%restrict%' then
        raise exception 'LAUNCH_ASSERT: customer delete failed for an unexpected reason: %', sqlerrm;
      end if;
  end;

  if not exists (select 1 from public.customers where id = v_customer) then
    raise exception 'LAUNCH_ASSERT: customer row disappeared';
  end if;
  if not exists (select 1 from public.estimates where id = v_estimate) then
    raise exception 'LAUNCH_ASSERT: estimate disappeared';
  end if;
  if not exists (select 1 from public.jobs where id = v_job) then
    raise exception 'LAUNCH_ASSERT: job disappeared';
  end if;
end
$launch_a$;

-- B: reserve material, cancel, stock net returns to zero, job stays cancelled.
do $launch_b$
declare
  v_customer uuid;
  v_product uuid;
  v_job uuid;
  v_res jsonb;
  v_net numeric;
begin
  insert into public.customers (full_name)
  values ('Launch Cancel Fiction')
  returning id into v_customer;

  insert into public.products (name, track_stock, stock_kind)
  values ('Launch fiction carpet', true, 'discrete')
  returning id into v_product;

  insert into public.jobs (customer_id, title)
  values (v_customer, 'Launch reserved job')
  returning id into v_job;

  insert into public.purchase_orders (customer_id, supplier, status)
  values (v_customer, 'Launch Fiction Supply', 'ordered');

  insert into public.po_items (po_id, product_id, description, quantity, unit_cost)
  select id, v_product, 'Launch reserve stock', 10, 1
  from public.purchase_orders
  where customer_id = v_customer
    and supplier = 'Launch Fiction Supply'
  limit 1;

  v_res := public.receive_po_lines_safe(
    (select id from public.purchase_orders where customer_id = v_customer and supplier = 'Launch Fiction Supply' limit 1),
    (
      select jsonb_build_array(jsonb_build_object(
        'po_item_id', id,
        'target_received_qty', 10
      ))
      from public.po_items
      where product_id = v_product
      limit 1
    )
  );
  if coalesce((v_res->>'ok')::boolean, false) is distinct from true then
    raise exception 'LAUNCH_ASSERT: stock receipt before reserve failed (%)', v_res;
  end if;

  v_res := public.reserve_inventory_safe(v_product, 4, v_job, null, 'Launch hold', 'launch-reserve-b');
  if coalesce((v_res->>'ok')::boolean, false) is distinct from true then
    raise exception 'LAUNCH_ASSERT: reserve failed (%)', v_res;
  end if;

  v_res := public.cancel_job_with_reservations(v_job);
  if coalesce((v_res->>'ok')::boolean, false) is distinct from true then
    raise exception 'LAUNCH_ASSERT: cancel failed (%)', v_res;
  end if;

  if (select status::text from public.jobs where id = v_job) is distinct from 'cancelled' then
    raise exception 'LAUNCH_ASSERT: cancelled job status changed';
  end if;

  -- Release rows store a negative qty. Outstanding is the signed sum.
  select coalesce(sum(
    case
      when kind in ('reserve', 'release') then qty
      when kind = 'pull' then -abs(qty)
      else 0
    end
  ), 0)
  into v_net
  from public.stock_movements
  where job_id = v_job and voided_at is null;

  if v_net <> 0 then
    raise exception 'LAUNCH_ASSERT: cancel left reserved qty %', v_net;
  end if;
  if (select reserved from public.products where id = v_product) <> 0 then
    raise exception 'LAUNCH_ASSERT: product reserved balance did not return to zero';
  end if;
end
$launch_b$;

-- C + G: 100 ordered, receive 40 then 35 then 25, retry does not double.
do $launch_c$
declare
  v_customer uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_product uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_po uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_line uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_res jsonb;
  v_qty numeric;
  v_moves numeric;
begin
  insert into public.customers (id, full_name)
  values (v_customer, 'Launch Receive Fiction');
  insert into public.products (id, name, track_stock, stock_kind)
  values (v_product, 'Launch fiction plank', true, 'discrete');
  insert into public.purchase_orders (id, customer_id, supplier, status)
  values (v_po, v_customer, 'Launch Fiction Supply', 'ordered');
  insert into public.po_items (id, po_id, product_id, description, quantity, unit_cost)
  values (v_line, v_po, v_product, 'Launch line', 100, 3.25);

  v_res := public.receive_po_lines_safe(
    v_po,
    jsonb_build_array(jsonb_build_object('po_item_id', v_line, 'target_received_qty', 40))
  );
  if coalesce((v_res->>'ok')::boolean, false) is distinct from true then
    raise exception 'LAUNCH_ASSERT: first receive failed (%)', v_res;
  end if;

  v_res := public.receive_po_lines_safe(
    v_po,
    jsonb_build_array(jsonb_build_object('po_item_id', v_line, 'target_received_qty', 40))
  );
  v_qty := public.inv_po_item_received_qty(v_line);
  if v_qty <> 40 then
    raise exception 'LAUNCH_ASSERT: duplicate receive changed qty to %', v_qty;
  end if;

  v_res := public.receive_po_lines_safe(
    v_po,
    jsonb_build_array(jsonb_build_object('po_item_id', v_line, 'target_received_qty', 75))
  );
  if coalesce((v_res->>'ok')::boolean, false) is distinct from true then
    raise exception 'LAUNCH_ASSERT: second receive failed (%)', v_res;
  end if;

  v_res := public.receive_po_lines_safe(
    v_po,
    jsonb_build_array(jsonb_build_object('po_item_id', v_line, 'target_received_qty', 100))
  );
  if coalesce((v_res->>'ok')::boolean, false) is distinct from true then
    raise exception 'LAUNCH_ASSERT: final receive failed (%)', v_res;
  end if;

  v_qty := public.inv_po_item_received_qty(v_line);
  if v_qty <> 100 then
    raise exception 'LAUNCH_ASSERT: received qty is %', v_qty;
  end if;

  select coalesce(sum(qty), 0) into v_moves
  from public.stock_movements
  where po_id = v_po and kind = 'receive' and voided_at is null;
  if v_moves <> 100 then
    raise exception 'LAUNCH_ASSERT: receive movements sum to %', v_moves;
  end if;
end
$launch_c$;

-- E: crew is refused at the inventory role gate. Office passes that gate.
-- RLS: an unassigned customer is hidden from crew and visible to office.
do $launch_e$
declare
  v_crew uuid;
  v_office uuid;
  v_customer uuid;
  v_seen int;
  v_res jsonb;
begin
  select id into v_crew from auth.users where email = 'crew.test@clevelandfloorking.com';
  select id into v_office from auth.users where email = 'office.test@clevelandfloorking.com';
  if v_crew is null or v_office is null then
    raise exception 'LAUNCH_ASSERT: synthetic staff users missing';
  end if;
  if (select role::text from public.profiles where id = v_crew) is distinct from 'crew' then
    raise exception 'LAUNCH_ASSERT: crew test profile role is not crew';
  end if;
  if (select role::text from public.profiles where id = v_office) is distinct from 'office' then
    raise exception 'LAUNCH_ASSERT: office test profile role is not office';
  end if;

  insert into public.customers (full_name)
  values ('Launch Role Fiction')
  returning id into v_customer;

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_crew)::text,
    true
  );
  select count(*) into v_seen from public.customers where id = v_customer;
  if v_seen <> 0 then
    raise exception 'LAUNCH_ASSERT: crew can read an unassigned customer';
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_office)::text,
    true
  );
  select count(*) into v_seen from public.customers where id = v_customer;
  if v_seen <> 1 then
    raise exception 'LAUNCH_ASSERT: office cannot read a customer (seen %)', v_seen;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_crew)::text,
    true
  );
  begin
    v_res := public.reserve_inventory_safe(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      1,
      '00000000-0000-4000-8000-000000000099',
      null,
      'crew probe',
      'launch-crew-e'
    );
    raise exception 'LAUNCH_ASSERT: crew reserve returned %', v_res;
  exception
    when others then
      if sqlerrm like '%LAUNCH_ASSERT%' then
        raise;
      end if;
      if sqlerrm not like '%ACCOUNTING_FORBIDDEN%' then
        raise exception 'LAUNCH_ASSERT: crew denial was %', sqlerrm;
      end if;
  end;

  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', v_office)::text,
    true
  );
  v_res := public.reserve_inventory_safe(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    1,
    '00000000-0000-4000-8000-000000000099',
    null,
    'office probe',
    'launch-office-e'
  );
  if coalesce(v_res->>'code', '') is distinct from 'INV_JOB_NOT_FOUND' then
    raise exception 'LAUNCH_ASSERT: office probe unexpected (%)', v_res;
  end if;

  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$launch_e$;

-- F: books are not the system of record on staging. This records the gap.
do $launch_f$
declare
  v_posting boolean;
  v_books boolean;
  v_journals bigint;
begin
  select posting_enabled, books_of_record
    into v_posting, v_books
  from public.accounting_settings
  limit 1;
  select count(*) into v_journals from public.journal_entries;
  if v_posting is distinct from false or v_books is distinct from false then
    raise exception 'LAUNCH_ASSERT: staging books flags changed (posting %, books %)', v_posting, v_books;
  end if;
  if v_journals <> 0 then
    raise exception 'LAUNCH_ASSERT: unexpected journal rows %', v_journals;
  end if;
  raise notice 'LAUNCH_F posting_enabled=% books_of_record=% journal_entries=%',
    v_posting, v_books, v_journals;
end
$launch_f$;

rollback;
