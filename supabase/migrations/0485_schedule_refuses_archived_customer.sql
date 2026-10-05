-- schedule_job_install_safe must refuse a booking when the job's customer
-- is archived. customers.cancelled_at is the only archive flag.
--
-- The app may check first for a friendly message. That check is not the
-- write boundary. Archive, cancel, and lost all set cancelled_at. This
-- function locks that customer row, then the job row, and reads the flag
-- again before it updates the job. A booking cannot commit after the
-- archive commits.
--
-- Archive of a customer who already has a scheduled install is unchanged:
-- this function does not cancel jobs, clear scheduled_date, or release
-- reservations. It only refuses a new schedule write.
--
-- Signature matches 0178 / 0186. Safe to re-run (create or replace).
-- Does not enable accounting. No table rewrite.
-- Rollback: re-apply the function body from 0186_launch_trust_schedule_invoice_guards.sql.

create or replace function public.schedule_job_install_safe(
  p_job_id uuid,
  p_scheduled_date date,
  p_scheduled_end date default null,
  p_assigned_to uuid default null,
  p_assigned_crew_id uuid default null,
  p_arrival_window text default null,
  p_set_arrival_window boolean default false,
  p_open_for_claim boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_jwt text := public.accounting_request_jwt_role();
  v_job public.jobs%rowtype;
  v_end date;
  v_lock_key int;
  v_customer_id uuid;
  v_cancelled_at timestamptz;
begin
  if p_job_id is null or p_scheduled_date is null then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_ARGS', 'error', 'job_id and scheduled_date are required.');
  end if;

  -- NULL end = single-day OK. Do NOT clamp inverted ranges — fail closed.
  if p_scheduled_end is not null and p_scheduled_end < p_scheduled_date then
    return jsonb_build_object(
      'ok', false,
      'code', 'SCHEDULE_INVALID_RANGE',
      'error', 'scheduled_end cannot be before scheduled_date.'
    );
  end if;
  v_end := p_scheduled_end;

  if p_assigned_to is not null and p_assigned_crew_id is not null then
    return jsonb_build_object(
      'ok', false, 'code', 'SCHEDULE_ASSIGNEE',
      'error', 'Assign either an installer or a crew, not both.'
    );
  end if;

  if v_uid is not null and v_jwt = 'authenticated' then
    v_role := coalesce(public.user_role(v_uid)::text, '');
    if v_role not in ('admin', 'office', 'sales_manager', 'salesman', 'scheduler') then
      return jsonb_build_object('ok', false, 'code', 'SCHEDULE_FORBIDDEN', 'error', 'Not authorized to schedule installs.');
    end if;
    -- Salesman: own book of business only. DEFINER skips jobs RLS.
    if v_role = 'salesman' and not public.mine_job(p_job_id) then
      return jsonb_build_object(
        'ok', false,
        'code', 'SCHEDULE_FORBIDDEN',
        'error', 'Not authorized to schedule this job.'
      );
    end if;
  elsif public.accounting_is_service_role() then
    null; -- trusted server actions
  else
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_AUTH', 'error', 'Authentication required.');
  end if;

  -- Serialize same installer/crew schedule mutations (defense in depth with EXCLUDE).
  -- Hash collisions only cause extra serialization — never skip locking.
  if p_assigned_to is not null then
    v_lock_key := hashtext(p_assigned_to::text);
    perform pg_advisory_xact_lock(180, v_lock_key);
  elsif p_assigned_crew_id is not null then
    v_lock_key := hashtext(p_assigned_crew_id::text);
    perform pg_advisory_xact_lock(180, v_lock_key);
  end if;

  -- Lock the owning customer before the job. Archive, cancel, and lost write
  -- customers first. Same lock order, so those writes cannot commit the flag
  -- in the gap between this check and the job update, and they cannot deadlock
  -- with this function. One customer row, not a table lock.
  select j.customer_id into v_customer_id
  from public.jobs j
  where j.id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_JOB_NOT_FOUND', 'error', 'Job not found.');
  end if;

  if v_customer_id is not null then
    perform 1 from public.customers c where c.id = v_customer_id for update;
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_JOB_NOT_FOUND', 'error', 'Job not found.');
  end if;

  if v_job.customer_id is distinct from v_customer_id and v_job.customer_id is not null then
    perform 1 from public.customers c where c.id = v_job.customer_id for update;
  end if;

  if v_job.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_CANCELLED', 'error', 'Cannot schedule a cancelled job.');
  end if;

  if v_job.customer_id is not null then
    select c.cancelled_at into v_cancelled_at
    from public.customers c
    where c.id = v_job.customer_id;
    if not found then
      return jsonb_build_object(
        'ok', false,
        'code', 'SCHEDULE_CUSTOMER_MISSING',
        'error', 'This job is not linked to a customer.'
      );
    end if;
    if v_cancelled_at is not null then
      return jsonb_build_object(
        'ok', false,
        'code', 'SCHEDULE_CUSTOMER_ARCHIVED',
        'error', 'This customer is archived and cannot be scheduled.'
      );
    end if;
  end if;

  perform set_config('app.allow_job_schedule_mutation', 'true', true);

  -- One update of this job. A second call changes the same row. It does not
  -- insert another booking.
  begin
    update public.jobs set
      assigned_to = p_assigned_to,
      assigned_crew_id = p_assigned_crew_id,
      scheduled_date = p_scheduled_date,
      scheduled_end = v_end,
      status = 'scheduled',
      open_for_claim = coalesce(p_open_for_claim, false),
      arrival_window = case
        when p_set_arrival_window then nullif(p_arrival_window, '')
        else arrival_window
      end,
      updated_at = now()
    where id = p_job_id;
  exception
    when exclusion_violation then
      perform set_config('app.allow_job_schedule_mutation', 'false', true);
      return jsonb_build_object(
        'ok', false,
        'code', 'SCHEDULE_CONFLICT',
        'error', 'The selected installer or crew is already booked on overlapping dates.'
      );
  end;

  perform set_config('app.allow_job_schedule_mutation', 'false', true);

  return jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'scheduled_date', p_scheduled_date,
    'scheduled_end', v_end,
    'assigned_to', p_assigned_to,
    'assigned_crew_id', p_assigned_crew_id
  );
end;
$$;

revoke all on function public.schedule_job_install_safe(
  uuid, date, date, uuid, uuid, text, boolean, boolean
) from public;
revoke all on function public.schedule_job_install_safe(
  uuid, date, date, uuid, uuid, text, boolean, boolean
) from anon;
grant execute on function public.schedule_job_install_safe(
  uuid, date, date, uuid, uuid, text, boolean, boolean
) to authenticated;
grant execute on function public.schedule_job_install_safe(
  uuid, date, date, uuid, uuid, text, boolean, boolean
) to service_role;

comment on function public.schedule_job_install_safe(uuid, date, date, uuid, uuid, text, boolean, boolean) is
  '0485: atomic schedule update. Refuses when the owning customer has cancelled_at set, or the job is cancelled. Locks that customer row, then the job. Authoritative conflict = GiST EXCLUDE; advisory(180) serializes same assignee.';
