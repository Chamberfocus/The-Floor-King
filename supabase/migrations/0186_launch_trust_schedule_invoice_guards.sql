-- Launch-trust: salesman cannot schedule arbitrary jobs via SECURITY DEFINER,
-- and concurrent estimate invoice create cannot insert two active originals.
--
-- Additive. Does NOT enable accounting.
-- Do NOT set posting_enabled
-- Safe to re-run. DO NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.
-- Repo next number is 0186 (0185 exists only on production as customer-merge).

do $$
declare
  s record;
begin
  if to_regclass('public.accounting_settings') is null then
    raise exception 'P0_0186_PRECHECK: accounting_settings missing — apply 0161–0184 first.';
  end if;
  select * into s from public.accounting_settings where id = 1;
  if not found then
    raise exception 'P0_0186_PRECHECK: accounting_settings row id=1 missing.';
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
      'P0_0186_PRECHECK: accounting activation flags are not in the required OFF/NULL state. Aborting (no mutation of flags).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) One non-void original commercial invoice per estimate
-- ---------------------------------------------------------------------------
create unique index if not exists invoices_one_active_original_per_estimate
  on public.invoices (estimate_id)
  where estimate_id is not null
    and status <> 'void'
    and commercial_kind = 'original';

comment on index public.invoices_one_active_original_per_estimate is
  '0186: concurrent Create invoice cannot insert two active original invoices for the same estimate.';

-- ---------------------------------------------------------------------------
-- 2) schedule_job_install_safe — salesman must own the job (mine_job)
--    Body matches 0178 plus the salesman ownership gate. SECURITY DEFINER
--    otherwise lets a salesman pass any p_job_id.
-- ---------------------------------------------------------------------------
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

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_JOB_NOT_FOUND', 'error', 'Job not found.');
  end if;
  if v_job.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_CANCELLED', 'error', 'Cannot schedule a cancelled job.');
  end if;

  perform set_config('app.allow_job_schedule_mutation', 'true', true);

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
  'F7/0186: atomic schedule update. Salesman restricted by mine_job. Authoritative conflict = GiST EXCLUDE; advisory(180) serializes same assignee.';

do $$
declare
  s record;
begin
  select * into s from public.accounting_settings where id = 1;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.inventory_posting_enabled, false)
     or coalesce(s.ap_posting_enabled, false)
     or coalesce(s.installer_posting_enabled, false) then
    raise exception 'P0_0186_POSTCHECK: posting flags changed — abort.';
  end if;
end $$;
