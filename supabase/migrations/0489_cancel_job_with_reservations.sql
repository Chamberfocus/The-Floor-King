-- Cancel a job and release its outstanding reservations in one transaction.
--
-- App code used to set jobs.status = cancelled and then call
-- release_inventory_safe without checking the result. A failed release left
-- the job cancelled and the material still reserved.
--
-- This function locks the job, releases each outstanding line, and only then
-- marks the job cancelled. Any release failure raises, so the status change
-- and the releases in this transaction roll back together. A second call on
-- an already-cancelled job releases any leftover hold and does not change
-- financial history.
--
-- release_inventory_safe still refuses ordinary callers outside
-- admin/office/warehouse. This function sets a transaction-local flag after
-- its own role check so sales and scheduling staff who may cancel a job can
-- release only through this path.
--
-- Does not delete invoices, payments, labor, installer bills, or commissions.
-- Does not enable accounting. Does not update posting flags. Safe to re-run.
-- Rollback: drop cancel_job_with_reservations, then re-apply
-- release_inventory_safe from 0176_f6_p4_inventory_accounting.sql.

create or replace function public.release_inventory_safe(
  p_product_id uuid, p_qty numeric, p_job_id uuid,
  p_line_id uuid default null, p_note text default null,
  p_idempotency_key text default null, p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_qty numeric; v_hash text; v_dup jsonb; v_id uuid; v_owned numeric;
  v_note text := public.inv_norm_text(p_note);
begin
  -- app.cancel_job_release is set only inside cancel_job_with_reservations,
  -- after that function has already authorized the caller.
  if coalesce(current_setting('app.cancel_job_release', true), '') is distinct from 'on' then
    perform public.accounting_require_roles(array['admin','office','warehouse'], 'release inventory');
  end if;
  v_actor := public.accounting_actor_id(p_created_by);
  v_qty := public.inv_qty_ok(p_qty, false);
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'error', 'job_id required for release.');
  end if;
  v_hash := public.inv_context_hash('release_inventory', jsonb_build_object(
    'product_id', p_product_id, 'qty', v_qty, 'job_id', p_job_id,
    'line_id', p_line_id, 'note', v_note
  ));
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'release_inventory', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  perform public.installer_labor_lock_job(p_job_id);
  perform public.inv_lock_product(p_product_id);
  v_owned := public.inv_job_line_reserved_qty(p_job_id, p_product_id, p_line_id);
  if v_qty > v_owned + 0.00005 then
    return jsonb_build_object(
      'ok', false, 'code', 'INV_RELEASE_EXCEEDS_JOB_RESERVED',
      'error', format('Job/line reserved %s < release %s.', v_owned, v_qty)
    );
  end if;

  v_id := public.inv_apply_movement(
    p_product_id, -v_qty, 'release', 'job_release',
    null, p_job_id, null, coalesce(v_note, 'Released'),
    null, null, null, p_line_id, null, p_line_id, null, null,
    p_idempotency_key, v_actor, null, false, -v_qty, 0, true
  );
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'release_inventory', v_hash,
    jsonb_build_object('ok', true, 'movement_id', v_id, 'duplicate', false));
end; $$;

create or replace function public.cancel_job_with_reservations(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_row record;
  v_qty numeric;
  v_res jsonb;
  v_released numeric := 0;
  v_already boolean;
begin
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'code', 'JOB_ID_REQUIRED');
  end if;

  if not public.accounting_is_service_role() then
    perform public.accounting_require_roles(
      array['admin','office','sales_manager','scheduler','salesman'],
      'cancel a job'
    );
  end if;

  select status into v_status
  from public.jobs
  where id = p_job_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
  end if;

  if v_status = 'completed' then
    return jsonb_build_object(
      'ok', false,
      'code', 'JOB_COMPLETED',
      'error', 'Completed jobs are not cancelled.'
    );
  end if;

  v_already := v_status = 'cancelled';
  perform set_config('app.cancel_job_release', 'on', true);

  for v_row in
    select
      product_id,
      line_id,
      count(*)::int as movement_count,
      greatest(0, coalesce(sum(
        case
          when kind = 'reserve' then qty
          when kind = 'release' then qty
          when kind = 'pull' then -abs(qty)
          else 0
        end
      ), 0)) as outstanding
    from public.stock_movements
    where job_id = p_job_id
      and product_id is not null
      and voided_at is null
      and kind in ('reserve', 'release', 'pull')
    group by product_id, line_id
  loop
    v_qty := round(v_row.outstanding, 4);
    if v_qty <= 0 then
      continue;
    end if;

    v_res := public.release_inventory_safe(
      v_row.product_id,
      v_qty,
      p_job_id,
      v_row.line_id,
      'Job cancelled/released reservations',
      'cancel-job:' || p_job_id::text || ':' || v_row.product_id::text || ':'
        || coalesce(v_row.line_id::text, '_') || ':' || v_qty::text || ':'
        || v_row.movement_count::text,
      auth.uid()
    );

    if coalesce((v_res->>'ok')::boolean, false) is distinct from true
      or coalesce((v_res->>'duplicate')::boolean, false) then
      raise exception 'RESERVATION_RELEASE_FAILED: %',
        coalesce(v_res->>'error', v_res->>'code', 'release failed')
        using errcode = 'P0001';
    end if;
    v_released := v_released + v_qty;
  end loop;

  if not v_already then
    update public.jobs
    set status = 'cancelled'
    where id = p_job_id
      and status is distinct from 'completed'
      and status is distinct from 'cancelled';
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_cancelled', v_already,
    'released_qty', v_released
  );
end;
$$;

revoke all on function public.cancel_job_with_reservations(uuid) from public, anon;
grant execute on function public.cancel_job_with_reservations(uuid) to authenticated, service_role;
