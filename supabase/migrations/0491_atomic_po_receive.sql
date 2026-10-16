-- Atomic purchase-order receiving.
--
-- receive_po_lines_safe posts every eligible line in one transaction.
-- It locks the purchase order, then each line in po_item_id order, recomputes
-- the remaining quantity from inv_po_item_received_qty, and calls
-- receive_inventory_safe. A non-ok result raises PO_RECEIVE_FAILED so earlier
-- lines in the same call roll back. Delta 0 is a successful no-op (retry or
-- duplicate). A later caller waits on the purchase-order row lock and sees
-- the committed ledger, so the same quantity is not posted twice.
--
-- This function does not set purchase_orders.status. The app marks received
-- only after this call returns ok.
--
-- Does not enable accounting. Safe to re-run.
-- Requires 0176 (receive_inventory_safe, inv_po_item_received_qty).

do $$
declare
  v_rel text;
  v_fn text;
begin
  foreach v_rel in array array[
    'purchase_orders',
    'po_items',
    'products',
    'stock_movements'
  ]
  loop
    if to_regclass('public.' || v_rel) is null then
      raise exception '0491 preflight: required relation public.% is missing', v_rel;
    end if;
  end loop;

  foreach v_fn in array array[
    'receive_inventory_safe',
    'inv_po_item_received_qty',
    'accounting_require_roles'
  ]
  loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = v_fn
    ) then
      raise exception '0491 preflight: public.% is missing', v_fn;
    end if;
  end loop;
end $$;

create or replace function public.receive_po_lines_safe(
  p_po_id uuid,
  p_lines jsonb,
  p_created_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_item public.po_items%rowtype;
  v_line jsonb;
  v_row record;
  v_item_id uuid;
  v_target numeric;
  v_already numeric;
  v_delta numeric;
  v_track boolean;
  v_kind text;
  v_res jsonb;
  v_key text;
  v_note text;
  v_by_text text;
  v_received_by uuid;
  v_out jsonb := '[]'::jsonb;
  v_posted boolean;
begin
  perform public.accounting_require_roles(
    array['admin', 'office', 'warehouse'],
    'receive purchase order lines'
  );

  if p_po_id is null or p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'PO_RECEIVE_LINES';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_po_id
  for update;
  if not found then
    raise exception 'PO_RECEIVE_NOT_FOUND';
  end if;
  if v_po.status::text in ('void', 'cancelled') then
    raise exception 'PO_RECEIVE_CLOSED';
  end if;

  for v_row in
    select e.value as line
    from jsonb_array_elements(p_lines) as e(value)
    order by e.value->>'po_item_id'
  loop
    v_line := v_row.line;
    begin
      v_item_id := nullif(v_line->>'po_item_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'PO_RECEIVE_LINES';
    end;
    if v_item_id is null then
      raise exception 'PO_RECEIVE_LINES';
    end if;

    select * into v_item
    from public.po_items
    where id = v_item_id
    for update;
    if not found then
      raise exception 'INV_PO_ITEM_NOT_FOUND';
    end if;
    if v_item.po_id is distinct from p_po_id then
      raise exception 'INV_PO_ITEM_MISMATCH';
    end if;

    begin
      v_target := (v_line->>'target_received_qty')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'INV_RECEIVE_QTY';
    end;
    if v_target is null or v_target < 0 then
      raise exception 'INV_RECEIVE_QTY';
    end if;
    if v_target > coalesce(v_item.quantity, 0) + 0.00005 then
      raise exception 'INV_OVER_RECEIVE';
    end if;

    v_already := public.inv_po_item_received_qty(v_item.id);
    v_delta := round(v_target - v_already, 2);
    if v_delta < -0.00005 then
      raise exception 'INV_RECEIVE_DECREASE';
    end if;

    v_track := false;
    v_kind := null;
    v_posted := false;
    if v_delta > 0.00005 and v_item.product_id is not null then
      select coalesce(track_stock, false), stock_kind
        into v_track, v_kind
      from public.products
      where id = v_item.product_id
      for update;
      if not found then
        raise exception 'INV_PRODUCT_NOT_FOUND';
      end if;
    end if;

    if v_delta > 0.00005 and v_track then
      v_note := coalesce(nullif(v_line->>'note', ''), 'Received from PO');
      -- Recomputed after the row locks. The client key is ignored so two
      -- concurrent callers cannot both post the same remaining quantity.
      v_key := format('po_recv:%s:%s:%s', v_item.id, v_already, v_delta);
      v_res := public.receive_inventory_safe(
        p_product_id := v_item.product_id,
        p_qty := v_delta,
        p_note := v_note,
        p_po_id := p_po_id,
        p_po_item_id := v_item.id,
        p_created_by := p_created_by,
        p_idempotency_key := v_key,
        p_create_roll := (v_kind = 'rolled'),
        p_roll_kind := 'roll'
      );
      if v_res is null or coalesce((v_res->>'ok')::boolean, false) is distinct from true then
        raise exception 'PO_RECEIVE_FAILED'
          using
            detail = coalesce(v_res::text, ''),
            hint = coalesce(v_res->>'code', v_res->>'error', 'receive failed');
      end if;
      v_posted := true;
    end if;

    if coalesce((v_line->>'stamp_received_qty')::boolean, false) then
      v_by_text := nullif(v_line->>'received_by', '');
      v_received_by := null;
      if v_by_text is not null then
        if v_by_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'PO_RECEIVE_LINES';
        end if;
        v_received_by := v_by_text::uuid;
      end if;
      update public.po_items
      set received_qty = v_target,
          received_at = coalesce(received_at, now()),
          received_by = coalesce(v_received_by, received_by),
          receiving_note = coalesce(nullif(v_line->>'receiving_note', ''), receiving_note)
      where id = v_item.id;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'po_item_id', v_item.id,
      'delta', case when v_posted then v_delta else 0 end,
      'posted', v_posted
    ));
  end loop;

  return jsonb_build_object('ok', true, 'lines', v_out);
end;
$$;

revoke all on function public.receive_po_lines_safe(uuid, jsonb, uuid) from public, anon;
grant execute on function public.receive_po_lines_safe(uuid, jsonb, uuid) to authenticated;
grant execute on function public.receive_po_lines_safe(uuid, jsonb, uuid) to service_role;
