-- P0: PO void must reverse ALL posted receipts, not only status=received.
-- Partial receive leaves status ordered/backordered; reverseReceivedPOs
-- previously skipped those rows → phantom on-hand.
--
-- Do NOT set posting_enabled
-- Authoritative RPC: void_purchase_order_safe
--   - locks the PO
--   - blocks when an open/draft vendor bill is linked
--   - reverses each unreversed receive movement via reverse_inventory_movement_safe
--     (fail-closed on INV_NEGATIVE_STOCK / rolled INV_REVERSAL_UNSAFE)
--   - retry-safe (idempotency + already-void / already-reversed)
--   - does not enable accounting
--
-- Safe to re-run. DO NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.

-- ---------------------------------------------------------------------------
-- 0) Accounting safety precheck
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  if to_regclass('public.accounting_settings') is null then
    raise exception 'P0_0183_PRECHECK: accounting_settings missing — apply 0161–0182 first.';
  end if;
  select * into s from public.accounting_settings where id = 1;
  if not found then
    raise exception 'P0_0183_PRECHECK: accounting_settings row id=1 missing.';
  end if;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.inventory_posting_enabled, false)
     or coalesce(s.ap_posting_enabled, false)
     or coalesce(s.installer_posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or coalesce(s.opening_balances_entered, false)
     or coalesce(s.accountant_validated, false)
     or s.cutover_date is not null then
    raise exception
      'P0_0183_PRECHECK: accounting activation flags are not in the required OFF/NULL state. Aborting (no mutation of flags).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Reverse posted PO receipts (any PO status). Does not set void.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_po_receipts_safe(
  p_po_id uuid,
  p_created_by uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_po public.purchase_orders%rowtype;
  v_m record;
  v_rev jsonb;
  v_reversed int := 0;
  v_skipped int := 0;
  v_hash text;
  v_dup jsonb;
  v_key text;
begin
  perform public.accounting_require_roles(array['admin','office'], 'reverse PO receipts');
  v_actor := public.accounting_actor_id(p_created_by);
  if p_po_id is null then
    return jsonb_build_object('ok', false, 'error', 'Missing purchase order.');
  end if;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_hash := public.inv_context_hash(
    'reverse_po_receipts',
    jsonb_build_object('po_id', p_po_id)
  );
  begin
    v_dup := public.inv_begin_action(v_key, 'reverse_po_receipts', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then
    return v_dup;
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Purchase order not found.');
  end if;

  for v_m in
    select sm.id
    from public.stock_movements sm
    where sm.po_id = p_po_id
      and sm.kind = 'receive'
      and sm.voided_at is null
      and sm.reversed_by is null
    order by sm.created_at asc, sm.id asc
  loop
    v_rev := public.reverse_inventory_movement_safe(
      v_m.id,
      'PO receipt reversal',
      'po-recv-rev:' || p_po_id::text || ':' || v_m.id::text,
      v_actor
    );
    if coalesce(v_rev->>'ok', '') = 'true' then
      v_reversed := v_reversed + 1;
    elsif coalesce(v_rev->>'code', '') = 'ALREADY_REVERSED' then
      v_skipped := v_skipped + 1;
    else
      raise exception 'PO_VOID_REVERSE_FAILED: %',
        coalesce(v_rev->>'error', 'Could not reverse a PO receipt movement.');
    end if;
  end loop;

  update public.po_items
  set received_qty = null,
      received_at = null,
      received_by = null,
      receiving_note = null
  where po_id = p_po_id;

  if v_reversed > 0 and v_po.job_id is not null then
    update public.jobs
    set warehouse_ready_at = null
    where id = v_po.job_id
      and warehouse_ready_at is not null;
  end if;

  update public.purchase_orders
  set received_at = null,
      received_by = null,
      backordered = false
  where id = p_po_id;

  return public.inv_complete_action(
    v_key,
    'reverse_po_receipts',
    v_hash,
    jsonb_build_object(
      'ok', true,
      'po_id', p_po_id,
      'reversed', v_reversed,
      'already_reversed', v_skipped,
      'duplicate', false
    )
  );
end;
$$;

revoke all on function public.reverse_po_receipts_safe(uuid, uuid, text) from public, anon;
grant execute on function public.reverse_po_receipts_safe(uuid, uuid, text) to authenticated;
grant execute on function public.reverse_po_receipts_safe(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2) Void PO: reverse receipts then mark void. Blocks open AP bills.
-- ---------------------------------------------------------------------------
create or replace function public.void_purchase_order_safe(
  p_po_id uuid,
  p_created_by uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_po public.purchase_orders%rowtype;
  v_bills int := 0;
  v_rev jsonb;
  v_hash text;
  v_dup jsonb;
  v_key text;
begin
  perform public.accounting_require_roles(array['admin','office'], 'void purchase order');
  v_actor := public.accounting_actor_id(p_created_by);
  if p_po_id is null then
    return jsonb_build_object('ok', false, 'error', 'Missing purchase order.');
  end if;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_hash := public.inv_context_hash(
    'void_purchase_order',
    jsonb_build_object('po_id', p_po_id)
  );

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Purchase order not found.');
  end if;

  if v_po.status = 'void' then
    return jsonb_build_object(
      'ok', true, 'po_id', p_po_id, 'duplicate', true, 'already_void', true
    );
  end if;

  select count(*)::int into v_bills
  from public.bills b
  where b.po_id = p_po_id
    and coalesce(b.ap_lifecycle, 'open') in ('draft', 'open');
  if v_bills > 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'PO_VOID_HAS_OPEN_BILL',
      'error', 'This PO has an open vendor bill. Void or reverse the bill before voiding the PO.'
    );
  end if;

  begin
    v_dup := public.inv_begin_action(v_key, 'void_purchase_order', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then
    return v_dup;
  end if;

  v_rev := public.reverse_po_receipts_safe(
    p_po_id,
    v_actor,
    'po-recv-rev-all:' || p_po_id::text
  );
  if coalesce(v_rev->>'ok', '') is distinct from 'true' then
    return jsonb_build_object(
      'ok', false,
      'code', coalesce(v_rev->>'code', 'PO_VOID_REVERSE_FAILED'),
      'error', coalesce(v_rev->>'error', 'Could not reverse PO receipts.')
    );
  end if;

  update public.purchase_orders
  set status = 'void',
      received_at = null,
      received_by = null,
      backordered = false
  where id = p_po_id;

  return public.inv_complete_action(
    v_key,
    'void_purchase_order',
    v_hash,
    jsonb_build_object(
      'ok', true,
      'po_id', p_po_id,
      'duplicate', false,
      'reversed', coalesce(v_rev->>'reversed', '0')
    )
  );
end;
$$;

revoke all on function public.void_purchase_order_safe(uuid, uuid, text) from public, anon;
grant execute on function public.void_purchase_order_safe(uuid, uuid, text) to authenticated;
grant execute on function public.void_purchase_order_safe(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Accounting still OFF
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  select * into s from public.accounting_settings where id = 1;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or s.cutover_date is not null then
    raise exception 'P0_0183_POSTCHECK: accounting flags must remain OFF/NULL.';
  end if;
end $$;
