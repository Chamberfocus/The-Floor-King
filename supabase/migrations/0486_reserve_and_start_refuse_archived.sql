-- High-risk inventory and install-start writes.
-- customers.cancelled_at is the only archive flag.
--
-- reserve_inventory_safe gains a customer-row lock. A new stock reservation
-- cannot commit after the customer is archived. Jobs with no customer are
-- unchanged. Release, consume, receive, and historical pulls are not modified.
-- Signature is unchanged. Grants from 0176 stay (create or replace).
--
-- advance_scheduled_job_if_active is the daily cron's start path. It locks
-- the customer, then the job, and moves scheduled → in_progress only while
-- the customer is active. It does not complete or cancel a job.
-- Service role only. Authenticated sessions still use the app status actions.
--
-- Lost's reservation release is application code: releaseJobReservations.
-- This file does not release stock by itself. Does not enable accounting.
-- Safe to re-run. Rollback for the reserve function: re-apply its body from
-- 0176_f6_p4_inventory_accounting.sql, then drop advance_scheduled_job_if_active.

create or replace function public.reserve_inventory_safe(
  p_product_id uuid, p_qty numeric, p_job_id uuid,
  p_line_id uuid default null, p_note text default null,
  p_idempotency_key text default null, p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_qty numeric; v_hash text; v_dup jsonb; v_id uuid;
  v_note text := public.inv_norm_text(p_note);
  v_customer_id uuid;
  v_cancelled_at timestamptz;
begin
  perform public.accounting_require_roles(array['admin','office','warehouse'], 'reserve inventory');
  v_actor := public.accounting_actor_id(p_created_by);
  v_qty := public.inv_qty_ok(p_qty, false);
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'error', 'job_id required for reserve.');
  end if;

  -- One customer row, locked before the movement. Archive writes that row.
  -- A job with no customer is not an archived-customer reservation.
  select j.customer_id into v_customer_id
  from public.jobs j
  where j.id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INV_JOB_NOT_FOUND', 'error', 'Job not found.');
  end if;
  if v_customer_id is not null then
    select c.cancelled_at into v_cancelled_at
    from public.customers c
    where c.id = v_customer_id
    for update;
    if not found then
      return jsonb_build_object(
        'ok', false,
        'code', 'INV_CUSTOMER_MISSING',
        'error', 'This job is not linked to a customer.'
      );
    end if;
    if v_cancelled_at is not null then
      return jsonb_build_object(
        'ok', false,
        'code', 'INV_CUSTOMER_ARCHIVED',
        'error', 'This customer is archived and cannot reserve inventory.'
      );
    end if;
  end if;

  v_hash := public.inv_context_hash('reserve_inventory', jsonb_build_object(
    'product_id', p_product_id, 'qty', v_qty, 'job_id', p_job_id,
    'line_id', p_line_id, 'note', v_note
  ));
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'reserve_inventory', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  perform public.installer_labor_lock_job(p_job_id);
  v_id := public.inv_apply_movement(
    p_product_id, v_qty, 'reserve', 'job_reserve',
    null, p_job_id, null, coalesce(v_note, 'Reserved'),
    null, null, null, p_line_id, null, p_line_id, null, null,
    p_idempotency_key, v_actor, null, false, v_qty, 0, true
  );
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'reserve_inventory', v_hash,
    jsonb_build_object('ok', true, 'movement_id', v_id, 'duplicate', false));
end; $$;

comment on function public.reserve_inventory_safe(uuid, numeric, uuid, uuid, text, text, uuid) is
  '0486: reserve for a job. Refuses when that job''s customer has cancelled_at set. Locks the customer row first. Same signature as 0176.';

create or replace function public.advance_scheduled_job_if_active(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_cancelled_at timestamptz;
  v_status text;
  v_updated uuid;
begin
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'code', 'JOB_ARGS', 'error', 'job_id is required.');
  end if;

  select j.customer_id into v_customer_id
  from public.jobs j
  where j.id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND', 'error', 'Job not found.');
  end if;

  if v_customer_id is not null then
    select c.cancelled_at into v_cancelled_at
    from public.customers c
    where c.id = v_customer_id
    for update;
    if v_cancelled_at is not null then
      return jsonb_build_object(
        'ok', false,
        'code', 'JOB_CUSTOMER_ARCHIVED',
        'error', 'This customer is archived and cannot be started.'
      );
    end if;
  end if;

  select j.status, j.customer_id into v_status, v_customer_id
  from public.jobs j
  where j.id = p_job_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND', 'error', 'Job not found.');
  end if;

  if v_customer_id is not null then
    perform 1 from public.customers c where c.id = v_customer_id for update;
    select c.cancelled_at into v_cancelled_at
    from public.customers c
    where c.id = v_customer_id;
    if v_cancelled_at is not null then
      return jsonb_build_object(
        'ok', false,
        'code', 'JOB_CUSTOMER_ARCHIVED',
        'error', 'This customer is archived and cannot be started.'
      );
    end if;
  end if;

  if v_status is distinct from 'scheduled' then
    return jsonb_build_object(
      'ok', false,
      'code', 'JOB_NOT_SCHEDULED',
      'error', 'Only a scheduled install can be started.'
    );
  end if;

  update public.jobs
  set status = 'in_progress', updated_at = now()
  where id = p_job_id and status = 'scheduled'
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'JOB_NOT_SCHEDULED',
      'error', 'Only a scheduled install can be started.'
    );
  end if;

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end;
$$;

revoke all on function public.advance_scheduled_job_if_active(uuid) from public;
revoke all on function public.advance_scheduled_job_if_active(uuid) from anon;
revoke all on function public.advance_scheduled_job_if_active(uuid) from authenticated;
grant execute on function public.advance_scheduled_job_if_active(uuid) to service_role;

comment on function public.advance_scheduled_job_if_active(uuid) is
  '0486: daily cron start. scheduled → in_progress only when customers.cancelled_at is null. Does not complete or cancel.';
