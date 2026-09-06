-- F5 security hotfix: anon / null-UID must NOT be trusted as service_role.
-- Non-destructive. Does not enable posting. No business data mutation.
-- Applied AFTER 0165–0167. Do not edit 0158–0167.

-- ---------------------------------------------------------------------------
-- Canonical request-role identity (JWT claim). SECURITY DEFINER still sees
-- the *caller* JWT via auth.jwt() / auth.role() under PostgREST.
-- Never treat auth.uid() IS NULL alone as trusted.
-- ---------------------------------------------------------------------------
create or replace function public.accounting_request_jwt_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(
    nullif(auth.jwt() ->> 'role', ''),
    nullif(auth.role()::text, ''),
    ''
  ));
$$;

create or replace function public.accounting_is_service_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.accounting_request_jwt_role() = 'service_role';
$$;

-- ---------------------------------------------------------------------------
-- accounting_require_roles — fail closed for anon / unknown null-uid
-- ---------------------------------------------------------------------------
create or replace function public.accounting_require_roles(
  p_allowed text[],
  p_action text default 'this accounting operation'
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_jwt_role text;
  v_uid uuid;
  v_role text;
begin
  v_jwt_role := public.accounting_request_jwt_role();
  v_uid := auth.uid();

  -- Explicit service_role JWT only (not anon, not bare null uid).
  if public.accounting_is_service_role() then
    return;
  end if;

  -- Authenticated human session.
  if v_uid is not null and v_jwt_role = 'authenticated' then
    v_role := public.user_role(v_uid)::text;
    if v_role is not null and v_role = any (p_allowed) then
      return;
    end if;
    raise exception
      'ACCOUNTING_FORBIDDEN: Only % may % (got %).',
      array_to_string(p_allowed, '/'),
      p_action,
      coalesce(v_role, 'none')
      using errcode = '42501';
  end if;

  -- anon, missing JWT role, or any other untrusted context.
  raise exception
    'ACCOUNTING_FORBIDDEN: Untrusted request identity (jwt_role=%, uid_present=%). Denied for %.',
    coalesce(nullif(v_jwt_role, ''), 'none'),
    (v_uid is not null),
    p_action
    using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------
-- accounting_actor_id — anon must not accept claimed UUID
-- ---------------------------------------------------------------------------
create or replace function public.accounting_actor_id(p_claimed uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt_role text := public.accounting_request_jwt_role();
begin
  -- Authenticated human: auth.uid always wins (ignore claimed spoof).
  if v_uid is not null and v_jwt_role = 'authenticated' then
    return v_uid;
  end if;

  -- Explicit service_role: may use claimed actor for trusted server automation.
  if public.accounting_is_service_role() then
    return p_claimed;
  end if;

  raise exception
    'ACCOUNTING_FORBIDDEN: Cannot resolve accounting actor for untrusted identity (jwt_role=%, uid_present=%).',
    coalesce(nullif(v_jwt_role, ''), 'none'),
    (v_uid is not null)
    using errcode = '42501';
end;
$$;

-- Keep admin/office helper aligned (no null-uid trust).
create or replace function public.accounting_is_admin_office()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.accounting_is_service_role() then
    return true;
  end if;
  if auth.uid() is not null and public.accounting_request_jwt_role() = 'authenticated' then
    return public.user_role(auth.uid()) in ('admin', 'office');
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE ACLs — defense in depth
-- PUBLIC default + explicit anon grants were the production failure mode.
-- Revoke PUBLIC + anon on every sensitive F5 function; grant intentionally.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_internal text[] := array[
    'allow_invoice_issue_guard',
    'enqueue_accounting_outbox_safe'
  ];
  v_staff_rpc text[] := array[
    'finalize_invoice_safe',
    'void_invoice_safe',
    'issue_credit_memo_safe',
    'void_credit_memo_safe',
    'void_refund_safe',
    'post_vendor_bill_safe',
    'record_bill_payment_safe',
    'void_bill_payment_safe',
    'record_direct_expense_safe',
    'record_customer_deposit_safe',
    'apply_customer_deposit_safe',
    'void_customer_deposit_safe',
    'complete_bank_reconciliation_safe'
  ];
  v_helper text[] := array[
    'accounting_request_jwt_role',
    'accounting_is_service_role',
    'accounting_require_roles',
    'accounting_actor_id',
    'accounting_is_admin_office',
    'accounting_resolve_business_date',
    'accounting_family_pilot_active',
    'accounting_is_eligible_cash_account',
    'invoice_accounting_pilot_active'
  ];
  v_all text[];
begin
  v_all := v_internal || v_staff_rpc || v_helper;

  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_all)
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);

    if r.proname = any (v_internal) then
      -- Nested DEFINER owner can still call; PostgREST clients cannot.
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname = any (v_staff_rpc) or r.proname = any (v_helper) then
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end;
$$;

-- Trigger function is not a PostgREST RPC; still strip PUBLIC/anon EXECUTE.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'invoices_enforce_issue_via_finalize'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
  end loop;
end;
$$;

-- Invoice issue trigger must remain installed (no drop).
-- Guard remains internal-only (service_role grant only above).
