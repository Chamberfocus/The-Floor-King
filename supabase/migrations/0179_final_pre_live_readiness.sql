-- F7 final pre-live readiness (0179)
-- Portal estimate column guard, trusted approval-RPC mutation GUC,
-- job_satisfaction read scope, documents storage ACL.
-- Safe to re-run. DOES NOT apply accounting activation.
-- Do NOT set posting_enabled
-- DO NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.
--
-- OWNER applies manually. Agent must NOT apply to production.
-- UNAPPLIED — corrected in place after owner pre-apply HOLD.

-- ---------------------------------------------------------------------------
-- 0) Accounting safety precheck — refuse if flags flipped; never activate here.
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  if to_regclass('public.accounting_settings') is null then
    raise exception 'F7_0179_PRECHECK: accounting_settings missing — apply 0161–0178 first.';
  end if;
  select * into s from public.accounting_settings where id = 1;
  if not found then
    raise exception 'F7_0179_PRECHECK: accounting_settings row id=1 missing.';
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
      'F7_0179_PRECHECK: accounting activation flags are not in the required OFF/NULL state. Aborting (no mutation of flags).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Portal customers cannot rewrite commercial estimate fields via PostgREST.
--
-- DIRECT customer UPDATE allowlist:
--   sent → declined | changes_requested
--   changes_requested → declined
--   plus customer_response_note / updated_at
--
-- APPROVAL (status=approved + snapshot/commercial columns) is NOT a direct
-- UPDATE. It happens only inside record_estimate_approval_safe AFTER that RPC
-- has completed JWT / my_customer_id() / ownership / option / lock / digest /
-- idempotency checks.
--
-- Trust boundary: the RPC sets transaction-local
--   app.allow_portal_approval_mutation = 'true'
-- immediately before its internal estimates UPDATE, then clears it.
-- is_local=true (third set_config arg) — not persistent across pooled sessions.
-- There is NO public/anon/authenticated helper that sets this GUC.
-- Ordinary PostgREST cannot invoke set_config in pg_catalog as an RPC.
-- ---------------------------------------------------------------------------
create or replace function public.estimates_protect_portal_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_new jsonb;
  v_old jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Trusted internal approval mutation (set only inside record_estimate_approval_safe).
  if current_setting('app.allow_portal_approval_mutation', true) = 'true' then
    return new;
  end if;

  if public.accounting_is_service_role() then
    return new;
  end if;

  v_role := coalesce(public.user_role(auth.uid())::text, '');
  -- Staff / installer / warehouse JWT: this trigger is portal-only.
  if v_role is distinct from 'customer' then
    return new;
  end if;

  if new.customer_id is distinct from old.customer_id then
    raise exception 'PORTAL_ESTIMATE_FORBIDDEN: cannot reassign this estimate.'
      using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'sent' and new.status in ('declined', 'changes_requested'))
      or (old.status = 'changes_requested' and new.status = 'declined')
    ) then
      raise exception
        'PORTAL_ESTIMATE_FORBIDDEN: customers cannot set that estimate status.'
        using errcode = 'P0001';
    end if;
  end if;

  v_new := to_jsonb(new) - 'status' - 'customer_response_note' - 'updated_at';
  v_old := to_jsonb(old) - 'status' - 'customer_response_note' - 'updated_at';
  if v_new is distinct from v_old then
    raise exception
      'PORTAL_ESTIMATE_FORBIDDEN: customers cannot change commercial estimate fields.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists estimates_protect_portal_columns on public.estimates;
create trigger estimates_protect_portal_columns
  before update on public.estimates
  for each row
  execute function public.estimates_protect_portal_columns();

revoke all on function public.estimates_protect_portal_columns() from public, anon, authenticated;
grant execute on function public.estimates_protect_portal_columns() to service_role;

comment on function public.estimates_protect_portal_columns() is
  'F7/0179: portal JWT may only decline/request-changes + note. Approval commercial mutation is allowed only while app.allow_portal_approval_mutation is set by record_estimate_approval_safe.';

-- ---------------------------------------------------------------------------
-- 1b) record_estimate_approval_safe — same 0178 contract, plus transaction-local
-- GUC around the estimates UPDATE so portal JWT approvals are not blocked.
-- CREATE OR REPLACE keeps existing GRANTs; re-assert ACL below.
-- ---------------------------------------------------------------------------
create or replace function public.record_estimate_approval_safe(
  p_estimate_id uuid,
  p_accepted_option_id uuid,
  p_approval_source text,
  p_approved_by_user_id uuid default null,
  p_approved_by_customer_id uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt text := public.accounting_request_jwt_role();
  v_role text;
  v_est public.estimates%rowtype;
  v_option_id uuid;
  v_next_version int;
  v_snap_id uuid;
  v_approved_at timestamptz := now();
  v_existing public.estimate_approval_snapshots%rowtype;
  v_portal_customer uuid;
  v_staff_actor uuid;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_payload jsonb;
  v_digest text;
  v_ctx_hash text;
  v_prior jsonb;
  v_result jsonb;
  v_action text := 'estimate_approve';
  v_audit_key text;
begin
  if p_estimate_id is null then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_ARGS', 'error', 'estimate_id required.');
  end if;
  if p_approval_source is null or p_approval_source not in ('staff', 'portal') then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_SOURCE', 'error', 'approval_source must be staff or portal.');
  end if;
  if v_key is not null and length(v_key) > 200 then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_IDEMPOTENCY_KEY', 'error', 'Idempotency key too long.');
  end if;

  if p_approval_source = 'portal' then
    if public.accounting_is_service_role() then
      return jsonb_build_object(
        'ok', false, 'code', 'APPROVAL_PORTAL_SERVICE_ROLE',
        'error', 'Portal approvals cannot use service_role.'
      );
    end if;
    if v_uid is null or v_jwt is distinct from 'authenticated' then
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_AUTH', 'error', 'Portal approval requires an authenticated customer session.');
    end if;
    v_portal_customer := public.my_customer_id();
    if v_portal_customer is null then
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_PORTAL_CUSTOMER', 'error', 'No customer linked to this account.');
    end if;
    if p_approved_by_customer_id is not null
       and p_approved_by_customer_id is distinct from v_portal_customer then
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_OWNERSHIP', 'error', 'That estimate is not available for approval.');
    end if;
  else
    if v_uid is not null and v_jwt = 'authenticated' then
      v_role := coalesce(public.user_role(v_uid)::text, '');
      if v_role not in ('admin', 'office', 'sales_manager', 'salesman') then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_FORBIDDEN', 'error', 'Not authorized to approve estimates.');
      end if;
      if p_approved_by_user_id is not null and p_approved_by_user_id is distinct from v_uid then
        return jsonb_build_object(
          'ok', false, 'code', 'APPROVAL_ACTOR_SPOOF',
          'error', 'Staff actor must match the authenticated user.'
        );
      end if;
      v_staff_actor := v_uid;
    elsif public.accounting_is_service_role() then
      if p_approved_by_user_id is null then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_ACTOR', 'error', 'Staff approval requires an actor user id.');
      end if;
      v_staff_actor := public.accounting_actor_id(p_approved_by_user_id);
      if v_staff_actor is null then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_ACTOR', 'error', 'Staff approval requires a valid actor user id.');
      end if;
      v_role := coalesce(public.user_role(v_staff_actor)::text, '');
      if v_role not in ('admin', 'office', 'sales_manager', 'salesman') then
        return jsonb_build_object(
          'ok', false, 'code', 'APPROVAL_FORBIDDEN',
          'error', 'Staff actor role is not authorized to approve estimates.'
        );
      end if;
    else
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_AUTH', 'error', 'Authentication required.');
    end if;
  end if;

  if v_key is not null then
    perform public.estimate_approval_lock_idempotency(v_key);
  end if;

  select * into v_est from public.estimates where id = p_estimate_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_NOT_FOUND', 'error', 'Estimate not found.');
  end if;

  if p_approval_source = 'portal' then
    if v_est.customer_id is distinct from v_portal_customer then
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_OWNERSHIP', 'error', 'That estimate is not available for approval.');
    end if;
  end if;

  v_option_id := coalesce(p_accepted_option_id, v_est.accepted_option_id);
  if v_option_id is null then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_NO_OPTION', 'error', 'No option to approve.');
  end if;

  if not exists (
    select 1 from public.estimate_options o
    where o.id = v_option_id and o.estimate_id = p_estimate_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_BAD_OPTION', 'error', 'Accepted option not found on estimate.');
  end if;

  begin
    v_payload := public.build_estimate_approval_payload_live(p_estimate_id, v_option_id);
  exception when others then
    raise warning 'APPROVAL_PAYLOAD_BUILD internal: %', sqlerrm;
    return jsonb_build_object(
      'ok', false,
      'code', 'APPROVAL_PAYLOAD_BUILD',
      'error', 'Could not build the approval snapshot from the current estimate. Contact the office.'
    );
  end;
  v_digest := public.estimate_approval_commercial_digest(v_payload);

  v_ctx_hash := md5(
    v_action || chr(31) ||
    p_estimate_id::text || chr(31) ||
    v_option_id::text || chr(31) ||
    p_approval_source || chr(31) ||
    coalesce(v_staff_actor::text, '') || chr(31) ||
    coalesce(v_portal_customer::text, '') || chr(31) ||
    v_digest
  );

  if v_key is not null then
    begin
      v_prior := public.estimate_approval_begin_action(v_key, v_action, v_ctx_hash);
    exception
      when others then
        if sqlerrm like 'IDEMPOTENCY_CONFLICT%' then
          return jsonb_build_object(
            'ok', false,
            'code', 'IDEMPOTENCY_CONFLICT',
            'error', 'Idempotency key reused with a different approval context.'
          );
        end if;
        raise;
    end;
    if v_prior is not null then
      return v_prior;
    end if;
  end if;

  if v_est.status = 'approved'
     and coalesce(v_est.approval_stale, false) = false
     and v_est.current_approval_snapshot_id is not null then
    select * into v_existing
    from public.estimate_approval_snapshots
    where id = v_est.current_approval_snapshot_id;

    if found
       and public.estimate_approval_commercial_digest(v_existing.payload) = v_digest
       and v_existing.accepted_option_id is not distinct from v_option_id
       and v_existing.approval_source = p_approval_source then
      v_result := jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'snapshot_id', v_existing.id,
        'version', v_existing.version,
        'estimate_id', p_estimate_id
      );
      if v_key is not null then
        perform public.estimate_approval_complete_action(v_key, v_action, v_ctx_hash, v_result);
      end if;
      return v_result;
    end if;

    v_result := jsonb_build_object(
      'ok', false,
      'code', 'APPROVAL_STALE_OR_CONFLICT',
      'error', 'Estimate is already approved. Edit the commercial terms (marks stale) before re-approving.'
    );
    if v_key is not null then
      perform public.estimate_approval_complete_action(v_key, v_action, v_ctx_hash, v_result);
    end if;
    return v_result;
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.estimate_approval_snapshots
  where estimate_id = p_estimate_id;

  insert into public.estimate_approval_snapshots (
    estimate_id,
    version,
    accepted_option_id,
    approved_at,
    approval_source,
    approved_by_user_id,
    approved_by_customer_id,
    payload
  ) values (
    p_estimate_id,
    v_next_version,
    v_option_id,
    v_approved_at,
    p_approval_source,
    case when p_approval_source = 'staff' then v_staff_actor else null end,
    case when p_approval_source = 'portal' then v_portal_customer else null end,
    v_payload
  )
  returning id into v_snap_id;

  -- Flag is set HERE, after auth/ownership/lock/snapshot insert, immediately
  -- before the estimate row mutation. Cleared before return / on error.
  perform set_config('app.allow_portal_approval_mutation', 'true', true);
  begin
    update public.estimates set
      status = 'approved',
      accepted_option_id = v_option_id,
      approved_at = v_approved_at,
      approval_source = p_approval_source,
      approved_by_user_id = case
        when p_approval_source = 'staff' then v_staff_actor
        else null
      end,
      approved_by_customer_id = case
        when p_approval_source = 'portal' then v_portal_customer
        else null
      end,
      current_approval_snapshot_id = v_snap_id,
      approval_stale = false,
      updated_at = now()
    where id = p_estimate_id;
  exception when others then
    perform set_config('app.allow_portal_approval_mutation', 'false', true);
    raise;
  end;
  perform set_config('app.allow_portal_approval_mutation', 'false', true);

  v_audit_key := coalesce(v_key, 'estimate_approved:' || v_snap_id::text);
  perform set_config('app.trusted_definer_audit', 'true', true);
  begin
    perform public.log_financial_audit_safe(
      'estimate_approved',
      'estimate',
      p_estimate_id,
      (v_approved_at at time zone 'America/New_York')::date,
      null,
      jsonb_build_object(
        'snapshot_id', v_snap_id,
        'version', v_next_version,
        'approval_source', p_approval_source,
        'accepted_option_id', v_option_id,
        'commercial_digest', v_digest,
        'total', v_payload->>'total'
      ),
      case when p_approval_source = 'staff' then v_staff_actor else null end,
      v_audit_key
    );
  exception when others then
    perform set_config('app.trusted_definer_audit', 'false', true);
    raise;
  end;
  perform set_config('app.trusted_definer_audit', 'false', true);

  v_result := jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'snapshot_id', v_snap_id,
    'version', v_next_version,
    'estimate_id', p_estimate_id,
    'approved_at', v_approved_at
  );

  if v_key is not null then
    perform public.estimate_approval_complete_action(v_key, v_action, v_ctx_hash, v_result);
  end if;

  return v_result;
end;
$$;

revoke all on function public.record_estimate_approval_safe(
  uuid, uuid, text, uuid, uuid, text
) from public;
revoke all on function public.record_estimate_approval_safe(
  uuid, uuid, text, uuid, uuid, text
) from anon;
grant execute on function public.record_estimate_approval_safe(
  uuid, uuid, text, uuid, uuid, text
) to authenticated;
grant execute on function public.record_estimate_approval_safe(
  uuid, uuid, text, uuid, uuid, text
) to service_role;

comment on function public.record_estimate_approval_safe(uuid, uuid, text, uuid, uuid, text) is
  'F7/0178+0179: atomic live-built approval. Portal via my_customer_id (no service_role). Sets app.allow_portal_approval_mutation only around the internal estimates UPDATE.';

-- ---------------------------------------------------------------------------
-- 2) job_satisfaction: stop global SELECT (signatures / comments).
--    Customers see their own jobs; staff/managers see all; salesman own book;
--    assigned installer sees that job. Writes unchanged (js_staff / service_role).
-- ---------------------------------------------------------------------------
drop policy if exists js_read on public.job_satisfaction;
create policy js_read on public.job_satisfaction
  for select to authenticated
  using (
    public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager', 'scheduler')
    or exists (
      select 1 from public.jobs j
      where j.id = job_satisfaction.job_id
        and (
          j.assigned_to = auth.uid()
          or j.customer_id = public.my_customer_id()
        )
    )
    or (
      public.user_role(auth.uid())::text = 'salesman'
      and exists (
        select 1 from public.jobs j
        join public.customers c on c.id = j.customer_id
        where j.id = job_satisfaction.job_id
          and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3) documents storage: no longer "any non-customer".
--    Crew/warehouse job photos and warehouse/crew measurement uploads use
--    service_role after server-side authorization (jobWriter / measurement
--    upload). Browser JWT: admin/office/sales_manager/scheduler/salesman only.
-- ---------------------------------------------------------------------------
drop policy if exists documents_storage_rw on storage.objects;
create policy documents_storage_rw on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documents'
    and public.user_role(auth.uid())::text in (
      'admin', 'office', 'sales_manager', 'scheduler', 'salesman'
    )
  )
  with check (
    bucket_id = 'documents'
    and public.user_role(auth.uid())::text in (
      'admin', 'office', 'sales_manager', 'scheduler', 'salesman'
    )
  );

-- ---------------------------------------------------------------------------
-- 4) Final accounting safety — still OFF (no flag writes)
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  select * into s from public.accounting_settings where id = 1;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or s.cutover_date is not null then
    raise exception 'F7_0179_POSTCHECK: accounting flags must remain OFF/NULL.';
  end if;
end $$;
