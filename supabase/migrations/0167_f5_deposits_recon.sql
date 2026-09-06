-- F5 Accounting ops (3/3): customer deposits apply/void + bank recon complete.
-- Non-destructive. posting_enabled stays false. No historical backfill.
-- Extends enqueue for customer_deposit_void under deposit_posting_enabled.

-- F5 pre-migration correction: role gate + economic date + cash eligibility
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
  v_role text;
begin
  -- service_role / trusted server: no auth.uid()
  if auth.uid() is null then
    return;
  end if;
  v_role := public.user_role(auth.uid())::text;
  if v_role is null or not (v_role = any (p_allowed)) then
    raise exception
      'ACCOUNTING_FORBIDDEN: Only % may % (got %).',
      array_to_string(p_allowed, '/'),
      p_action,
      coalesce(v_role, 'none')
      using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.accounting_require_roles(text[], text) from public;
grant execute on function public.accounting_require_roles(text[], text) to authenticated;
grant execute on function public.accounting_require_roles(text[], text) to service_role;

-- Explicit admin/office (is_staff is already admin|office; keep named helper for clarity).
create or replace function public.accounting_is_admin_office()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null
    or public.user_role(auth.uid()) in ('admin', 'office');
$$;

create or replace function public.accounting_family_pilot_active(p_family text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.accounting_settings%rowtype;
begin
  select * into v from public.accounting_settings where id = 1;
  if not found or not coalesce(v.posting_enabled, false) then
    return false;
  end if;
  return case lower(p_family)
    when 'invoice' then coalesce(v.invoice_posting_enabled, false)
    when 'credit' then coalesce(v.credit_posting_enabled, false)
    when 'payment' then coalesce(v.payment_posting_enabled, false)
    when 'ap' then coalesce(v.ap_posting_enabled, false)
    when 'expense' then coalesce(v.expense_posting_enabled, false)
    when 'deposit' then coalesce(v.deposit_posting_enabled, false)
    else false
  end;
end;
$$;

-- When family pilot ON: require explicit date (no invented today).
-- When OFF: coalesce to current_date for normal ops defaults.
create or replace function public.accounting_resolve_business_date(
  p_provided date,
  p_family text
)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.accounting_family_pilot_active(p_family) then
    if p_provided is null then
      raise exception
        'ACCOUNTING_INVALID_ECONOMIC_DATE: % family requires an explicit business date when accounting posting for that family is enabled.',
        p_family
        using errcode = 'P0001';
    end if;
    return p_provided;
  end if;
  return coalesce(p_provided, current_date);
end;
$$;

create or replace function public.accounting_is_eligible_cash_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_account_id is not null and (
    exists (
      select 1
      from public.gl_accounts a
      where a.id = p_account_id
        and a.is_active
        and a.account_type = 'asset'
        and coalesce(a.subtype, '') in ('cash', 'cash_clearing', 'bank')
    )
    or exists (
      select 1
      from public.accounting_account_mappings m
      where m.account_id = p_account_id
        and m.mapping_key in ('cash_operating', 'undeposited_funds')
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Customer deposit applications (partial apply support)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_deposit_applications (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.customer_deposits (id) on delete restrict,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  applied_on date not null default (timezone('utc', now()))::date,
  status text not null default 'active'
    check (status in ('active', 'void')),
  idempotency_key text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text
);

create unique index if not exists customer_deposit_applications_idempotency_uidx
  on public.customer_deposit_applications (idempotency_key)
  where idempotency_key is not null;

create index if not exists customer_deposit_applications_deposit_idx
  on public.customer_deposit_applications (deposit_id)
  where status = 'active';

create index if not exists customer_deposit_applications_invoice_idx
  on public.customer_deposit_applications (invoice_id)
  where status = 'active';

alter table public.customer_deposit_applications enable row level security;

drop policy if exists customer_deposit_applications_staff
  on public.customer_deposit_applications;
create policy customer_deposit_applications_staff
  on public.customer_deposit_applications
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select, insert, update on public.customer_deposit_applications to authenticated;
-- No DELETE grant — void instead.

-- ---------------------------------------------------------------------------
-- enqueue — recreate with customer_deposit_void under deposit pilot
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_accounting_outbox_safe(
  p_source_type text,
  p_source_id uuid,
  p_event_kind text,
  p_payload jsonb,
  p_review_required boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_id uuid;
  v_settings public.accounting_settings%rowtype;
  v_cutover date;
  v_econ date;
  v_econ_raw text;
  v_event_ok boolean := false;
begin
  select * into v_settings from public.accounting_settings where id = 1;
  if not found or not coalesce(v_settings.posting_enabled, false) then
    return null;
  end if;

  if p_event_kind in ('payment', 'payment_void') then
    v_event_ok := coalesce(v_settings.payment_posting_enabled, false);
  elsif p_event_kind in ('credit_application', 'refund', 'refund_void',
                         'credit_memo_issue', 'credit_void') then
    v_event_ok := coalesce(v_settings.credit_posting_enabled, false);
  elsif p_event_kind in ('vendor_bill', 'bill_payment', 'bill_payment_void') then
    v_event_ok := coalesce(v_settings.ap_posting_enabled, false);
  elsif p_event_kind in ('invoice_issue', 'invoice_void') then
    v_event_ok := coalesce(v_settings.invoice_posting_enabled, false);
  elsif p_event_kind in ('direct_expense') then
    v_event_ok := coalesce(v_settings.expense_posting_enabled, false);
  elsif p_event_kind in ('customer_deposit', 'deposit_apply', 'customer_deposit_void') then
    v_event_ok := coalesce(v_settings.deposit_posting_enabled, false);
  else
    v_event_ok := false;
  end if;

  if not v_event_ok then
    return null;
  end if;

  v_econ_raw := nullif(trim(coalesce(p_payload->>'economicEventDate', '')), '');
  if v_econ_raw is null then
    raise exception 'ACCOUNTING_INVALID_ECONOMIC_DATE: economicEventDate is required when accounting posting is enabled for %',
      p_event_kind;
  end if;
  begin
    v_econ := v_econ_raw::date;
  exception
    when others then
      raise exception 'ACCOUNTING_INVALID_ECONOMIC_DATE: economicEventDate % is not a valid date',
        v_econ_raw;
  end;

  v_cutover := v_settings.cutover_date;
  if v_cutover is not null and v_econ < v_cutover then
    insert into public.accounting_event_status (
      source_type, source_id, event_kind, status, error_code, error_message
    ) values (
      p_source_type, p_source_id, p_event_kind, 'legacy_pre_cutover',
      'pre_cutover', 'Event date is before accounting cutover.'
    )
    on conflict (source_type, source_id, event_kind) do update
      set status = excluded.status,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          updated_at = now();
    return null;
  end if;

  v_key := 'outbox:' || p_source_type || ':' || p_source_id::text || ':' || p_event_kind;

  insert into public.accounting_posting_outbox (
    source_type, source_id, event_kind, idempotency_key, payload,
    status, review_required, next_attempt_at
  ) values (
    p_source_type, p_source_id, p_event_kind, v_key, coalesce(p_payload, '{}'::jsonb),
    case when p_review_required then 'review_required' else 'pending' end,
    p_review_required, now()
  )
  on conflict (idempotency_key) do update
    set updated_at = accounting_posting_outbox.updated_at
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.accounting_posting_outbox where idempotency_key = v_key;
  end if;

  insert into public.accounting_event_status (
    source_type, source_id, event_kind, status, outbox_id
  ) values (
    p_source_type, p_source_id, p_event_kind,
    case when p_review_required then 'review_required' else 'pending' end,
    v_id
  )
  on conflict (source_type, source_id, event_kind) do update
    set status = excluded.status,
        outbox_id = excluded.outbox_id,
        updated_at = now();

  return v_id;
end;
$$;

revoke all on function public.enqueue_accounting_outbox_safe from public;
revoke all on function public.enqueue_accounting_outbox_safe from authenticated;
grant execute on function public.enqueue_accounting_outbox_safe to service_role;

-- ---------------------------------------------------------------------------
-- record_customer_deposit_safe
-- classification must be pre_invoice_deposit (reject legacy_ambiguous for auto).
-- Economic date = received_on.
-- ---------------------------------------------------------------------------
create or replace function public.record_customer_deposit_safe(
  p_customer_id uuid,
  p_amount numeric,
  p_received_on date,
  p_method text default null,
  p_classification text default 'pre_invoice_deposit',
  p_job_id uuid default null,
  p_estimate_id uuid default null,
  p_payment_id uuid default null,
  p_notes text default null,
  p_created_by uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_existing uuid;
  v_dep_id uuid;
  v_econ date;
  v_class text;
  v_cash uuid;
  v_dep_liab uuid;
  v_review boolean := false;
  v_frozen jsonb;
  v_payload jsonb;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'record customer deposits');
  v_actor := public.accounting_actor_id(p_created_by);
  if p_customer_id is null then
    return jsonb_build_object('ok', false, 'error', 'Customer is required.');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Deposit amount must be greater than zero.');
  end if;

  v_class := coalesce(nullif(trim(p_classification), ''), 'pre_invoice_deposit');
  if v_class = 'legacy_ambiguous' then
    return jsonb_build_object(
      'ok', false,
      'error', 'legacy_ambiguous deposits cannot be auto-posted. Classify as pre_invoice_deposit first.'
    );
  end if;
  if v_class <> 'pre_invoice_deposit' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only pre_invoice_deposit classification may be recorded via this RPC.'
    );
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.customer_deposits
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object(
        'ok', true,
        'deposit_id', v_existing,
        'duplicate', true
      );
    end if;
  end if;

  -- Economic date = received_on (fail-closed when deposit pilot ON).
  v_econ := public.accounting_resolve_business_date(p_received_on, 'deposit');

  begin
    insert into public.customer_deposits (
      customer_id, job_id, estimate_id, payment_id,
      amount, received_on, method, classification, status,
      notes, created_by, idempotency_key
    ) values (
      p_customer_id, p_job_id, p_estimate_id, p_payment_id,
      round(p_amount::numeric, 2), v_econ, nullif(p_method, ''),
      'pre_invoice_deposit', 'unapplied',
      nullif(p_notes, ''), v_actor, nullif(p_idempotency_key, '')
    )
    returning id into v_dep_id;
  exception
    when unique_violation then
      select id into v_existing
      from public.customer_deposits
      where idempotency_key = p_idempotency_key
      limit 1;
      return jsonb_build_object(
        'ok', true,
        'deposit_id', v_existing,
        'duplicate', true
      );
  end;

  select account_id into v_cash
  from public.accounting_payment_method_mappings
  where payment_method = coalesce(nullif(p_method, ''), 'other');
  if v_cash is null then
    select account_id into v_cash
    from public.accounting_account_mappings
    where mapping_key = 'undeposited_funds';
  end if;

  select account_id into v_dep_liab
  from public.accounting_account_mappings
  where mapping_key = 'customer_deposits';

  if v_cash is null or v_dep_liab is null then
    v_review := true;
  end if;

  v_frozen := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_cash,
      'debit', round(p_amount::numeric, 2),
      'credit', 0,
      'memo', 'Deposit received',
      'customerId', p_customer_id
    ),
    jsonb_build_object(
      'accountId', v_dep_liab,
      'debit', 0,
      'credit', round(p_amount::numeric, 2),
      'memo', 'Unearned revenue / deposits',
      'customerId', p_customer_id
    )
  );

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'customer_deposit',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'customer_deposit',
    'sourceId', v_dep_id,
    'amount', round(p_amount::numeric, 2),
    'customerId', p_customer_id,
    'jobId', p_job_id,
    'cashAccountId', v_cash,
    'liabilityAccountId', v_dep_liab,
    'frozenLines', v_frozen
  );

  perform public.enqueue_accounting_outbox_safe(
    'customer_deposit', v_dep_id, 'customer_deposit', v_payload, v_review
  );

  return jsonb_build_object(
    'ok', true,
    'deposit_id', v_dep_id,
    'duplicate', false
  );
end;
$$;

revoke all on function public.record_customer_deposit_safe from public;
grant execute on function public.record_customer_deposit_safe to authenticated;

-- ---------------------------------------------------------------------------
-- apply_customer_deposit_safe — NON-CASH: Dr deposit liability Cr AR
-- Economic date = applied_on.
-- ---------------------------------------------------------------------------
create or replace function public.apply_customer_deposit_safe(
  p_deposit_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_applied_on date,
  p_created_by uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_dep public.customer_deposits%rowtype;
  v_inv public.invoices%rowtype;
  v_applied numeric := 0;
  v_unapplied numeric := 0;
  v_existing uuid;
  v_app_id uuid;
  v_liab uuid;
  v_ar uuid;
  v_econ date;
  v_review boolean := false;
  v_frozen jsonb;
  v_payload jsonb;
  v_apply numeric;
  v_inv_total numeric := 0;
  v_paid numeric := 0;
  v_credited numeric := 0;
  v_dep_applied numeric := 0;
  v_open numeric := 0;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'apply customer deposits');
  v_actor := public.accounting_actor_id(p_created_by);
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Apply amount must be greater than zero.');
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.customer_deposit_applications
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object(
        'ok', true,
        'application_id', v_existing,
        'duplicate', true
      );
    end if;
  end if;

  select * into v_dep from public.customer_deposits where id = p_deposit_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Deposit not found.');
  end if;
  if v_dep.status = 'void' then
    return jsonb_build_object('ok', false, 'error', 'Cannot apply a voided deposit.');
  end if;
  if v_dep.status = 'refunded' then
    return jsonb_build_object('ok', false, 'error', 'Cannot apply a refunded deposit.');
  end if;
  if v_dep.status = 'applied' then
    return jsonb_build_object('ok', false, 'error', 'Deposit is already fully applied.');
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found.');
  end if;
  if v_inv.status = 'void' then
    return jsonb_build_object('ok', false, 'error', 'Cannot apply deposit to a void invoice.');
  end if;
  if v_inv.customer_id <> v_dep.customer_id then
    return jsonb_build_object('ok', false, 'error', 'Deposit and invoice must belong to the same customer.');
  end if;

  select coalesce(sum(amount), 0) into v_applied
  from public.customer_deposit_applications
  where deposit_id = p_deposit_id
    and status = 'active';
  v_unapplied := round((v_dep.amount - v_applied)::numeric, 2);
  if v_unapplied <= 0.005 then
    return jsonb_build_object('ok', false, 'error', 'Deposit has no unapplied balance.');
  end if;

  v_apply := least(round(p_amount::numeric, 2), v_unapplied);
  if v_apply <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Nothing to apply.');
  end if;

  -- Cap to invoice open balance (payments + credits + prior deposit apps).
  select coalesce(sum(coalesce(quantity, 0) * coalesce(rate, 0)), 0)
    into v_inv_total
  from public.invoice_items where invoice_id = p_invoice_id;
  v_inv_total := round((v_inv_total * (1 + coalesce(v_inv.tax_rate, 0) / 100.0))::numeric, 2);

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where invoice_id = p_invoice_id and coalesce(status, 'active') <> 'void';

  select coalesce(sum(amount), 0) into v_credited
  from public.credit_applications
  where invoice_id = p_invoice_id and coalesce(status, 'active') <> 'void';

  select coalesce(sum(amount), 0) into v_dep_applied
  from public.customer_deposit_applications
  where invoice_id = p_invoice_id and status = 'active';

  v_open := round((v_inv_total - v_paid - v_credited - v_dep_applied)::numeric, 2);
  if v_open <= 0.005 then
    return jsonb_build_object('ok', false, 'error', 'Invoice has no open balance.');
  end if;
  v_apply := least(v_apply, v_open);
  if v_apply <= 0.005 then
    return jsonb_build_object('ok', false, 'error', 'Nothing to apply against invoice balance.');
  end if;

  -- Economic date = applied_on (fail-closed when deposit pilot ON).
  v_econ := public.accounting_resolve_business_date(p_applied_on, 'deposit');

  begin
    insert into public.customer_deposit_applications (
      deposit_id, invoice_id, amount, applied_on, status,
      created_by, idempotency_key
    ) values (
      p_deposit_id, p_invoice_id, v_apply, v_econ, 'active',
      v_actor, nullif(p_idempotency_key, '')
    )
    returning id into v_app_id;
  exception
    when unique_violation then
      select id into v_existing
      from public.customer_deposit_applications
      where idempotency_key = p_idempotency_key
      limit 1;
      return jsonb_build_object(
        'ok', true,
        'application_id', v_existing,
        'duplicate', true
      );
  end;

  if round((v_unapplied - v_apply)::numeric, 2) <= 0.005 then
    update public.customer_deposits
    set status = 'applied',
        applied_invoice_id = p_invoice_id,
        applied_at = now(),
        updated_at = now()
    where id = p_deposit_id;
  else
    update public.customer_deposits
    set updated_at = now()
    where id = p_deposit_id;
  end if;

  select account_id into v_liab
  from public.accounting_account_mappings
  where mapping_key = 'customer_deposits';
  select account_id into v_ar
  from public.accounting_account_mappings
  where mapping_key = 'accounts_receivable';

  if v_liab is null or v_ar is null then
    v_review := true;
  end if;

  -- NON-CASH apply: Dr deposit liability / Cr AR
  v_frozen := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_liab,
      'debit', v_apply,
      'credit', 0,
      'memo', 'Apply customer deposit',
      'customerId', v_dep.customer_id,
      'invoiceId', p_invoice_id
    ),
    jsonb_build_object(
      'accountId', v_ar,
      'debit', 0,
      'credit', v_apply,
      'memo', 'Reduce AR',
      'customerId', v_dep.customer_id,
      'invoiceId', p_invoice_id
    )
  );

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'deposit_apply',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'deposit_application',
    'sourceId', v_app_id,
    'amount', v_apply,
    'invoiceId', p_invoice_id,
    'customerId', v_dep.customer_id,
    'depositId', p_deposit_id,
    'liabilityAccountId', v_liab,
    'arAccountId', v_ar,
    'frozenLines', v_frozen
  );

  perform public.enqueue_accounting_outbox_safe(
    'deposit_application', v_app_id, 'deposit_apply', v_payload, v_review
  );

  return jsonb_build_object(
    'ok', true,
    'application_id', v_app_id,
    'applied', v_apply,
    'unapplied_after', greatest(0, round((v_unapplied - v_apply)::numeric, 2)),
    'duplicate', false
  );
end;
$$;

revoke all on function public.apply_customer_deposit_safe from public;
grant execute on function public.apply_customer_deposit_safe to authenticated;

-- ---------------------------------------------------------------------------
-- void_customer_deposit_safe — only if no active applications
-- Economic date for VOID = authorization date (UTC).
-- ---------------------------------------------------------------------------
create or replace function public.void_customer_deposit_safe(
  p_deposit_id uuid,
  p_voided_by uuid,
  p_void_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_dep public.customer_deposits%rowtype;
  v_active_apps int := 0;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'void customer deposits');
  v_actor := public.accounting_actor_id(p_voided_by);
  select * into v_dep from public.customer_deposits where id = p_deposit_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Deposit not found.');
  end if;
  if v_dep.status = 'void' then
    return jsonb_build_object('ok', true, 'deposit_id', p_deposit_id, 'duplicate', true);
  end if;

  select count(*) into v_active_apps
  from public.customer_deposit_applications
  where deposit_id = p_deposit_id
    and status = 'active';
  if v_active_apps > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Cannot void a deposit with active applications. Void applications first.',
      'active_applications', v_active_apps
    );
  end if;

  update public.customer_deposits
  set status = 'void',
      updated_at = now(),
      notes = case
        when nullif(p_void_reason, '') is not null then
          coalesce(notes || E'\n', '') || 'Voided: ' || p_void_reason
        else notes
      end
  where id = p_deposit_id;

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'customer_deposit:' || p_deposit_id::text || ':post'
    and status = 'posted'
  limit 1;

  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'customer_deposit_void',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'customer_deposit',
    'sourceId', p_deposit_id,
    'amount', v_dep.amount,
    'customerId', v_dep.customer_id,
    'originalJournalEntryId', v_orig,
    'originalIdempotencyKey', 'customer_deposit:' || p_deposit_id::text || ':post',
    'voidedBy', v_actor,
    'voidReason', coalesce(nullif(p_void_reason, ''), 'Voided by staff')
  );

  perform public.enqueue_accounting_outbox_safe(
    'customer_deposit', p_deposit_id, 'customer_deposit_void', v_payload, v_orig is null
  );

  return jsonb_build_object('ok', true, 'deposit_id', p_deposit_id, 'duplicate', false);
end;
$$;

revoke all on function public.void_customer_deposit_safe from public;
grant execute on function public.void_customer_deposit_safe to authenticated;

-- ---------------------------------------------------------------------------
-- complete_bank_reconciliation_safe
-- Role check INSIDE: admin/office only (explicit). Difference must be ~0.
-- Blocks overlapping completed sessions for same account + statement period.
-- ---------------------------------------------------------------------------
create or replace function public.complete_bank_reconciliation_safe(
  p_session_id uuid,
  p_completed_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_sess public.bank_reconciliation_sessions%rowtype;
  v_bad_account int := 0;
  v_unposted int := 0;
  v_cleared_debit numeric := 0;
  v_cleared_credit numeric := 0;
  v_calc_ending numeric := 0;
  v_diff numeric := 0;
  v_overlap uuid;
begin
  -- Explicit admin/office. service_role (auth.uid null) allowed for trusted server.
  begin
    perform public.accounting_require_roles(
      ARRAY['admin','office'],
      'complete bank reconciliation'
    );
  exception
    when others then
      if SQLERRM like 'ACCOUNTING_FORBIDDEN%' then
        return jsonb_build_object(
          'ok', false,
          'error', 'Only admin/office may complete bank reconciliation.'
        );
      end if;
      raise;
  end;

  v_actor := public.accounting_actor_id(p_completed_by);

  select * into v_sess
  from public.bank_reconciliation_sessions
  where id = p_session_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation session not found.');
  end if;
  if v_sess.status = 'completed' then
    return jsonb_build_object(
      'ok', true,
      'session_id', p_session_id,
      'duplicate', true
    );
  end if;
  if v_sess.status <> 'open' then
    return jsonb_build_object(
      'ok', false,
      'error', format('Session status is %s; only open sessions can be completed.', v_sess.status)
    );
  end if;

  -- Cleared lines must belong to the session cash account.
  select count(*) into v_bad_account
  from public.bank_reconciliation_cleared_lines c
  join public.journal_lines jl on jl.id = c.journal_line_id
  where c.session_id = p_session_id
    and coalesce(c.cleared, true)
    and jl.account_id is distinct from v_sess.account_id;
  if v_bad_account > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        '%s cleared line(s) do not belong to the session account.',
        v_bad_account
      )
    );
  end if;

  -- Cleared lines must be on posted journal entries.
  select count(*) into v_unposted
  from public.bank_reconciliation_cleared_lines c
  join public.journal_lines jl on jl.id = c.journal_line_id
  join public.journal_entries je on je.id = jl.journal_entry_id
  where c.session_id = p_session_id
    and coalesce(c.cleared, true)
    and je.status is distinct from 'posted';
  if v_unposted > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        '%s cleared line(s) belong to unposted journal entries.',
        v_unposted
      )
    );
  end if;

  select
    coalesce(sum(jl.debit), 0),
    coalesce(sum(jl.credit), 0)
  into v_cleared_debit, v_cleared_credit
  from public.bank_reconciliation_cleared_lines c
  join public.journal_lines jl on jl.id = c.journal_line_id
  where c.session_id = p_session_id
    and coalesce(c.cleared, true);

  v_calc_ending := round(
    (v_sess.opening_balance + v_cleared_debit - v_cleared_credit)::numeric,
    2
  );
  v_diff := round((v_sess.ending_balance - v_calc_ending)::numeric, 2);

  if abs(v_diff) > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        'Cannot complete reconciliation with nonzero difference ($%s).',
        to_char(v_diff, 'FM999999990.00')
      ),
      'calculated_ending_balance', v_calc_ending,
      'difference', v_diff
    );
  end if;

  -- Block overlapping completed session for same account + statement period.
  select id into v_overlap
  from public.bank_reconciliation_sessions s
  where s.id <> p_session_id
    and s.account_id = v_sess.account_id
    and s.status = 'completed'
    and s.statement_start <= v_sess.statement_end
    and s.statement_end >= v_sess.statement_start
  limit 1;
  if v_overlap is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Another completed reconciliation overlaps this account and statement period.',
      'overlapping_session_id', v_overlap
    );
  end if;

  update public.bank_reconciliation_sessions
  set status = 'completed',
      completed_by = v_actor,
      completed_at = now(),
      calculated_ending_balance = v_calc_ending,
      difference = 0
  where id = p_session_id;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'calculated_ending_balance', v_calc_ending,
    'difference', 0,
    'duplicate', false
  );
end;
$$;

revoke all on function public.complete_bank_reconciliation_safe from public;
grant execute on function public.complete_bank_reconciliation_safe to authenticated;
