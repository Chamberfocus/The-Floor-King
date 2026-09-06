-- F5 Accounting ops (2/3): vendor bill post, bill payments, direct expense.
-- Non-destructive. posting_enabled stays false. No historical backfill.
-- Extends enqueue to allow bill_payment_void under ap_posting_enabled.

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
-- Bills: accounting posted marker (idempotent post gate)
-- ---------------------------------------------------------------------------
alter table public.bills
  add column if not exists accounting_posted_at timestamptz;

-- ---------------------------------------------------------------------------
-- Bill payments: void/idempotency (ledger uses AP path; no auto expense insert)
-- ---------------------------------------------------------------------------
alter table public.bill_payments
  add column if not exists status text not null default 'active';

alter table public.bill_payments
  add column if not exists voided_at timestamptz;

alter table public.bill_payments
  add column if not exists voided_by uuid references auth.users (id) on delete set null;

alter table public.bill_payments
  add column if not exists void_reason text;

alter table public.bill_payments
  add column if not exists idempotency_key text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'bill_payments_status_check'
  ) then
    alter table public.bill_payments
      add constraint bill_payments_status_check
      check (status in ('active', 'void'));
  end if;
end $$;

create unique index if not exists bill_payments_idempotency_uidx
  on public.bill_payments (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- enqueue — recreate with bill_payment_void under AP pilot
-- Economic date MANDATORY when posting+pilot on. No today fallback.
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
  elsif p_event_kind in ('customer_deposit', 'deposit_apply') then
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
-- post_vendor_bill_safe
-- Economic date = bill_date.
-- Categories: material_purchase, installer_labor, freight, operating_expense,
-- inventory_asset, other_mapped, review_required (null/review_required → review).
-- ---------------------------------------------------------------------------
create or replace function public.post_vendor_bill_safe(
  p_bill_id uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_bill public.bills%rowtype;
  v_amount numeric := 0;
  v_settings public.accounting_settings%rowtype;
  v_debit uuid;
  v_ap uuid;
  v_mapping_key text;
  v_review boolean := false;
  v_econ date;
  v_frozen jsonb;
  v_payload jsonb;
  v_already boolean := false;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'post vendor bills');
  v_actor := public.accounting_actor_id(p_actor);
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Bill not found.');
  end if;

  select * into v_settings from public.accounting_settings where id = 1;

  select coalesce(sum(
    coalesce(quantity, 0) * coalesce(unit_cost, 0)
  ), 0) into v_amount
  from public.bill_items
  where bill_id = p_bill_id;
  v_amount := round(v_amount::numeric, 2);

  if v_amount <= 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Bill has no amount to post.',
      'amount', v_amount
    );
  end if;

  if v_bill.accounting_category is null
     or v_bill.accounting_category = 'review_required' then
    v_review := true;
    v_mapping_key := null;
  elsif v_bill.accounting_category = 'inventory_asset'
        and not coalesce(v_settings.inventory_posting_enabled, false) then
    v_review := true;
    v_mapping_key := 'inventory_asset';
  else
    v_mapping_key := case v_bill.accounting_category
      when 'material_purchase' then 'material_cogs'
      when 'installer_labor' then 'installer_labor_cogs'
      when 'freight' then 'default_expense'
      when 'operating_expense' then 'default_expense'
      when 'inventory_asset' then 'inventory_asset'
      when 'other_mapped' then 'default_expense'
      else null
    end;
  end if;

  if v_mapping_key is not null then
    select account_id into v_debit
    from public.accounting_account_mappings
    where mapping_key = v_mapping_key;
  end if;

  select account_id into v_ap
  from public.accounting_account_mappings
  where mapping_key = 'accounts_payable';

  if v_debit is null or v_ap is null then
    v_review := true;
  end if;

  -- Idempotent posted marker
  if v_bill.accounting_posted_at is null then
    update public.bills
    set accounting_posted_at = now()
    where id = p_bill_id
      and accounting_posted_at is null;
  else
    v_already := true;
  end if;

  -- Economic date = bill_date (fail-closed when AP pilot ON).
  v_econ := public.accounting_resolve_business_date(v_bill.bill_date, 'ap');

  v_frozen := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_debit,
      'debit', v_amount,
      'credit', 0,
      'memo', coalesce(v_bill.accounting_category, 'vendor_bill'),
      'jobId', v_bill.job_id,
      'billId', p_bill_id
    ),
    jsonb_build_object(
      'accountId', v_ap,
      'debit', 0,
      'credit', v_amount,
      'memo', 'Accounts payable',
      'jobId', v_bill.job_id,
      'billId', p_bill_id
    )
  );

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'vendor_bill',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'vendor_bill',
    'sourceId', p_bill_id,
    'amount', v_amount,
    'billId', p_bill_id,
    'jobId', v_bill.job_id,
    'customerId', v_bill.customer_id,
    'accountingCategory', v_bill.accounting_category,
    'debitAccountId', v_debit,
    'apAccountId', v_ap,
    'frozenLines', v_frozen,
    'actorId', v_actor
  );

  perform public.enqueue_accounting_outbox_safe(
    'vendor_bill', p_bill_id, 'vendor_bill', v_payload, v_review
  );

  return jsonb_build_object(
    'ok', true,
    'bill_id', p_bill_id,
    'amount', v_amount,
    'review_required', v_review,
    'already_posted', v_already
  );
end;
$$;

revoke all on function public.post_vendor_bill_safe from public;
grant execute on function public.post_vendor_bill_safe to authenticated;

-- ---------------------------------------------------------------------------
-- record_bill_payment_safe
-- Economic date = p_date (same value stored on bill_payments.date).
-- Does NOT insert expenses — ledger uses AP path.
-- ---------------------------------------------------------------------------
create or replace function public.record_bill_payment_safe(
  p_bill_id uuid,
  p_amount numeric,
  p_date date,
  p_method text default null,
  p_note text default null,
  p_created_by uuid default null,
  p_idempotency_key text default null,
  p_cash_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_bill public.bills%rowtype;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_remaining numeric := 0;
  v_existing uuid;
  v_pay_id uuid;
  v_ap uuid;
  v_cash uuid;
  v_econ date;
  v_frozen jsonb;
  v_payload jsonb;
  v_review boolean := false;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'record bill payments');
  v_actor := public.accounting_actor_id(p_created_by);
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Payment amount must be greater than zero.');
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.bill_payments
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object(
        'ok', true,
        'bill_payment_id', v_existing,
        'duplicate', true
      );
    end if;
  end if;

  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Bill not found.');
  end if;

  select coalesce(sum(
    coalesce(quantity, 0) * coalesce(unit_cost, 0)
  ), 0) into v_total
  from public.bill_items
  where bill_id = p_bill_id;

  select coalesce(sum(amount), 0) into v_paid
  from public.bill_payments
  where bill_id = p_bill_id
    and status = 'active';

  v_remaining := round((v_total - v_paid)::numeric, 2);
  if round(p_amount::numeric, 2) > v_remaining + 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        'Bill payment exceeds remaining balance of $%s.',
        to_char(greatest(v_remaining, 0), 'FM999999990.00')
      ),
      'remaining', greatest(v_remaining, 0)
    );
  end if;

  -- Economic date = p_date (fail-closed when AP pilot ON).
  v_econ := public.accounting_resolve_business_date(p_date, 'ap');

  begin
    insert into public.bill_payments (
      bill_id, "date", amount, method, note, created_by,
      status, idempotency_key
    ) values (
      p_bill_id,
      v_econ,
      round(p_amount::numeric, 2),
      nullif(p_method, ''),
      nullif(p_note, ''),
      v_actor,
      'active',
      nullif(p_idempotency_key, '')
    )
    returning id into v_pay_id;
  exception
    when unique_violation then
      select id into v_existing
      from public.bill_payments
      where idempotency_key = p_idempotency_key
      limit 1;
      return jsonb_build_object(
        'ok', true,
        'bill_payment_id', v_existing,
        'duplicate', true
      );
  end;

  -- DO NOT insert expenses (AP path owns accounting).

  select account_id into v_ap
  from public.accounting_account_mappings
  where mapping_key = 'accounts_payable';

  if p_cash_account_id is not null then
    if not public.accounting_is_eligible_cash_account(p_cash_account_id) then
      return jsonb_build_object(
        'ok', false,
        'error', 'p_cash_account_id must be an active cash/bank/undeposited-funds GL account.'
      );
    end if;
    v_cash := p_cash_account_id;
  else
    select account_id into v_cash
    from public.accounting_payment_method_mappings
    where payment_method = coalesce(nullif(p_method, ''), 'other');
    if v_cash is null then
      select account_id into v_cash
      from public.accounting_account_mappings
      where mapping_key = 'cash_operating';
    end if;
  end if;

  if v_ap is null or v_cash is null then
    v_review := true;
  end if;

  v_frozen := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_ap,
      'debit', round(p_amount::numeric, 2),
      'credit', 0,
      'memo', 'Pay AP',
      'billId', p_bill_id
    ),
    jsonb_build_object(
      'accountId', v_cash,
      'debit', 0,
      'credit', round(p_amount::numeric, 2),
      'memo', 'Cash out',
      'billId', p_bill_id
    )
  );

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'bill_payment',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'bill_payment',
    'sourceId', v_pay_id,
    'amount', round(p_amount::numeric, 2),
    'billId', p_bill_id,
    'apAccountId', v_ap,
    'cashAccountId', v_cash,
    'paymentMethod', coalesce(nullif(p_method, ''), 'other'),
    'frozenLines', v_frozen
  );

  perform public.enqueue_accounting_outbox_safe(
    'bill_payment', v_pay_id, 'bill_payment', v_payload, v_review
  );

  return jsonb_build_object(
    'ok', true,
    'bill_payment_id', v_pay_id,
    'duplicate', false,
    'remaining_after', greatest(0, round((v_remaining - p_amount)::numeric, 2))
  );
end;
$$;

revoke all on function public.record_bill_payment_safe from public;
grant execute on function public.record_bill_payment_safe to authenticated;

-- ---------------------------------------------------------------------------
-- void_bill_payment_safe
-- Economic date for VOID = authorization date (UTC).
-- event_kind bill_payment_void under ap_posting_enabled.
-- ---------------------------------------------------------------------------
create or replace function public.void_bill_payment_safe(
  p_bill_payment_id uuid,
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
  v_pay public.bill_payments%rowtype;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'void bill payments');
  v_actor := public.accounting_actor_id(p_voided_by);
  select * into v_pay from public.bill_payments where id = p_bill_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Bill payment not found.');
  end if;
  if v_pay.status = 'void' then
    return jsonb_build_object(
      'ok', true,
      'bill_payment_id', p_bill_payment_id,
      'duplicate', true
    );
  end if;

  update public.bill_payments
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = coalesce(nullif(p_void_reason, ''), 'Voided by staff')
  where id = p_bill_payment_id;

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'bill_payment:' || p_bill_payment_id::text || ':post'
    and status = 'posted'
  limit 1;

  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'bill_payment_void',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'bill_payment',
    'sourceId', p_bill_payment_id,
    'amount', v_pay.amount,
    'billId', v_pay.bill_id,
    'originalJournalEntryId', v_orig,
    'originalIdempotencyKey', 'bill_payment:' || p_bill_payment_id::text || ':post'
  );

  perform public.enqueue_accounting_outbox_safe(
    'bill_payment', p_bill_payment_id, 'bill_payment_void', v_payload, v_orig is null
  );

  return jsonb_build_object(
    'ok', true,
    'bill_payment_id', p_bill_payment_id,
    'duplicate', false
  );
end;
$$;

revoke all on function public.void_bill_payment_safe from public;
grant execute on function public.void_bill_payment_safe to authenticated;


-- Durable idempotency for direct expenses (accounting-producing source events).
alter table public.expenses
  add column if not exists idempotency_key text;

create unique index if not exists expenses_idempotency_key_uidx
  on public.expenses (idempotency_key)
  where idempotency_key is not null;

-- record_direct_expense_safe
-- If bill_id set: return ok skipped (bill/AP path owns accounting).
-- Economic date = expense date (fail-closed when expense pilot ON).
-- Idempotency: expenses.idempotency_key unique partial index.
-- ---------------------------------------------------------------------------
create or replace function public.record_direct_expense_safe(
  p_date date,
  p_category public.expense_category,
  p_amount numeric,
  p_vendor text default null,
  p_note text default null,
  p_job_id uuid default null,
  p_bill_id uuid default null,
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
  v_expense_id uuid;
  v_econ date;
  v_map public.accounting_expense_category_mappings%rowtype;
  v_exp_acct uuid;
  v_cash uuid;
  v_review boolean := false;
  v_frozen jsonb;
  v_payload jsonb;
  v_existing uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'record direct expenses');
  v_actor := public.accounting_actor_id(p_created_by);

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Expense amount must be greater than zero.');
  end if;

  -- Bill path owns accounting — skip ledger enqueue (and skip insert if bill-linked).
  if p_bill_id is not null then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'Expense is linked to a vendor bill — ledger uses bill + bill payment.'
    );
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.expenses
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object(
        'ok', true,
        'expense_id', v_existing,
        'duplicate', true
      );
    end if;
  end if;

  v_econ := public.accounting_resolve_business_date(p_date, 'expense');

  begin
    insert into public.expenses (
      date, category, amount, vendor, note, job_id, bill_id, created_by, idempotency_key
    ) values (
      v_econ,
      coalesce(p_category, 'other'),
      round(p_amount::numeric, 2),
      nullif(p_vendor, ''),
      nullif(p_note, ''),
      p_job_id,
      null,
      v_actor,
      nullif(p_idempotency_key, '')
    )
    returning id into v_expense_id;
  exception
    when unique_violation then
      select id into v_existing
      from public.expenses
      where idempotency_key = p_idempotency_key
      limit 1;
      return jsonb_build_object(
        'ok', true,
        'expense_id', v_existing,
        'duplicate', true
      );
  end;

  select * into v_map
  from public.accounting_expense_category_mappings
  where expense_category = coalesce(p_category, 'other')::text;

  if not found or coalesce(v_map.requires_review, true) or v_map.account_id is null then
    -- Mapping missing/unknown: review_required. Do NOT invent default_expense into frozen lines.
    v_review := true;
    v_exp_acct := null;
  else
    v_exp_acct := v_map.account_id;
  end if;

  select account_id into v_cash
  from public.accounting_account_mappings
  where mapping_key = 'cash_operating';

  if v_exp_acct is null or v_cash is null then
    v_review := true;
  end if;

  v_frozen := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_exp_acct,
      'debit', round(p_amount::numeric, 2),
      'credit', 0,
      'memo', 'Direct expense',
      'jobId', p_job_id
    ),
    jsonb_build_object(
      'accountId', v_cash,
      'debit', 0,
      'credit', round(p_amount::numeric, 2),
      'memo', 'Cash out',
      'jobId', p_job_id
    )
  );

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'direct_expense',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'expense',
    'sourceId', v_expense_id,
    'amount', round(p_amount::numeric, 2),
    'expenseCategory', coalesce(p_category, 'other')::text,
    'expenseAccountId', v_exp_acct,
    'cashAccountId', v_cash,
    'jobId', p_job_id,
    'idempotencyKey', nullif(p_idempotency_key, ''),
    'frozenLines', v_frozen,
    'actorId', v_actor
  );

  perform public.enqueue_accounting_outbox_safe(
    'expense', v_expense_id, 'direct_expense', v_payload, v_review
  );

  return jsonb_build_object(
    'ok', true,
    'expense_id', v_expense_id,
    'duplicate', false,
    'review_required', v_review
  );
end;
$$;

revoke all on function public.record_direct_expense_safe from public;
grant execute on function public.record_direct_expense_safe to authenticated;
