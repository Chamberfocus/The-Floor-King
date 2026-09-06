-- F5 Accounting ops (1/3): invoice finalize/void, credit memo issue/void, refund void.
-- Non-destructive. posting_enabled stays false. No historical backfill.
-- Extends outbox pilot switch for expense + deposit event kinds (ops RPCs land in 0166/0167).

-- ---------------------------------------------------------------------------
-- Invoices: void audit columns (status enum already includes 'void')
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists voided_at timestamptz;

alter table public.invoices
  add column if not exists voided_by uuid references auth.users (id) on delete set null;

alter table public.invoices
  add column if not exists void_reason text;

-- ---------------------------------------------------------------------------
-- enqueue_accounting_outbox_safe — INTERNAL ONLY.
-- Extended pilots: direct_expense (expense_posting_enabled),
-- customer_deposit / deposit_apply (deposit_posting_enabled).
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
  -- Never enqueue while master posting is off (no backlog for later).
  -- Return BEFORE payload validation so ops keep working when accounting is OFF.
  select * into v_settings from public.accounting_settings where id = 1;
  if not found or not coalesce(v_settings.posting_enabled, false) then
    return null;
  end if;

  -- Per-event pilot flags (also before economic-date validation)
  if p_event_kind in ('payment', 'payment_void') then
    v_event_ok := coalesce(v_settings.payment_posting_enabled, false);
  elsif p_event_kind in ('credit_application', 'refund', 'refund_void',
                         'credit_memo_issue', 'credit_void') then
    v_event_ok := coalesce(v_settings.credit_posting_enabled, false);
  elsif p_event_kind in ('vendor_bill', 'bill_payment') then
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

  -- Economic date is MANDATORY when posting + pilot are enabled.
  -- Never substitute today. Malformed/missing → fail closed (rolls back ops TX).
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

-- INTERNAL: no authenticated/PUBLIC execute. Nested call from ops DEFINER RPCs OK.
revoke all on function public.enqueue_accounting_outbox_safe from public;
revoke all on function public.enqueue_accounting_outbox_safe from authenticated;
grant execute on function public.enqueue_accounting_outbox_safe to service_role;

-- Actor identity + invoice finalize session flag (used by later RPCs in this file)
create or replace function public.accounting_actor_id(p_claimed uuid)
returns uuid
language sql
stable
set search_path = public
as $$
  select case
    when auth.uid() is not null then auth.uid()
    else p_claimed
  end;
$$;
revoke all on function public.accounting_actor_id from public;
grant execute on function public.accounting_actor_id to authenticated;
grant execute on function public.accounting_actor_id to service_role;

create or replace function public.allow_invoice_issue_guard()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('floorking.allow_invoice_issue', '1', true);
end;
$$;
revoke all on function public.allow_invoice_issue_guard from public;
grant execute on function public.allow_invoice_issue_guard to service_role;


-- ---------------------------------------------------------------------------
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
-- void_refund_safe — mirror void_invoice_payment_safe
-- Economic date for VOID = authorization/reversal date (UTC today at void),
-- NOT the original refunded_at.
-- ---------------------------------------------------------------------------
create or replace function public.void_refund_safe(
  p_refund_id uuid,
  p_voided_by uuid,
  p_void_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.refunds%rowtype;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
  v_actor uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'void refunds');
  v_actor := public.accounting_actor_id(p_voided_by);
  select * into v_ref from public.refunds where id = p_refund_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Refund not found.');
  end if;
  if v_ref.status = 'void' then
    return jsonb_build_object('ok', true, 'refund_id', p_refund_id, 'duplicate', true);
  end if;

  update public.refunds
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = coalesce(nullif(p_void_reason, ''), 'Voided by staff')
  where id = p_refund_id;

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'refund:' || p_refund_id::text || ':post'
    and status = 'posted'
  limit 1;

  -- Economic date for VOID = authorization date (UTC), not original refunded_at.
  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'refund_void',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'refund',
    'sourceId', p_refund_id,
    'amount', v_ref.amount,
    'customerId', v_ref.customer_id,
    'creditMemoId', v_ref.credit_memo_id,
    'originalJournalEntryId', v_orig,
    'originalIdempotencyKey', 'refund:' || p_refund_id::text || ':post'
  );

  perform public.enqueue_accounting_outbox_safe(
    'refund', p_refund_id, 'refund_void', v_payload, v_orig is null
  );

  return jsonb_build_object('ok', true, 'refund_id', p_refund_id, 'duplicate', false);
end;
$$;

revoke all on function public.void_refund_safe from public;
grant execute on function public.void_refund_safe to authenticated;

-- ---------------------------------------------------------------------------
-- issue_credit_memo_safe — insert memo + same-TX credit_memo_issue outbox
-- Economic date = issued_at coalesce current_date (same value stored / used).
-- Tax decomposition: when invoice_id_for_tax unavailable or unreliable →
-- review_required + taxReviewRequired in payload (no fabricated tax split).
-- ---------------------------------------------------------------------------
create or replace function public.issue_credit_memo_safe(
  p_customer_id uuid,
  p_amount numeric,
  p_kind text,
  p_reason text,
  p_issued_at date,
  p_job_id uuid default null,
  p_estimate_id uuid default null,
  p_approval_snapshot_id uuid default null,
  p_created_by uuid default null,
  p_idempotency_key text default null,
  p_invoice_id_for_tax uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_memo_id uuid;
  v_econ date;
  v_kind text;
  v_liab uuid;
  v_disc uuid;
  v_tax_acct uuid;
  v_inv public.invoices%rowtype;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_inv_total numeric := 0;
  v_rate numeric := 0;
  v_pretax numeric := 0;
  v_tax_part numeric := 0;
  v_expected_share numeric := 0;
  v_actual_share numeric := 0;
  v_tax_ok boolean := false;
  v_review boolean := false;
  v_frozen jsonb;
  v_payload jsonb;
  v_actor uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'issue credit memos');
  v_actor := public.accounting_actor_id(p_created_by);
  if p_customer_id is null then
    return jsonb_build_object('ok', false, 'error', 'Customer is required.');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Credit amount must be greater than zero.');
  end if;

  v_kind := coalesce(nullif(trim(p_kind), ''), 'manual');
  if v_kind not in ('commercial', 'manual') then
    return jsonb_build_object('ok', false, 'error', 'Credit kind must be commercial or manual.');
  end if;

  if p_job_id is not null then
    if not exists (
      select 1 from public.jobs j
      where j.id = p_job_id and j.customer_id = p_customer_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'Job must belong to the same customer as the credit memo.');
    end if;
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.credit_memos
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object(
        'ok', true,
        'credit_memo_id', v_existing,
        'duplicate', true
      );
    end if;
  end if;

  -- Economic date: fail-closed when credit pilot ON; coalesce today when OFF.
  v_econ := public.accounting_resolve_business_date(p_issued_at, 'credit');

  begin
    insert into public.credit_memos (
      customer_id, estimate_id, job_id, approval_snapshot_id,
      amount, reason, kind, status, issued_at, created_by, idempotency_key
    ) values (
      p_customer_id,
      p_estimate_id,
      p_job_id,
      p_approval_snapshot_id,
      round(p_amount::numeric, 2),
      coalesce(p_reason, ''),
      v_kind,
      'issued',
      v_econ::timestamptz,
      v_actor,
      nullif(p_idempotency_key, '')
    )
    returning id into v_memo_id;
  exception
    when unique_violation then
      select id into v_existing
      from public.credit_memos
      where idempotency_key = p_idempotency_key
      limit 1;
      return jsonb_build_object(
        'ok', true,
        'credit_memo_id', v_existing,
        'duplicate', true
      );
  end;

  select account_id into v_liab
  from public.accounting_account_mappings
  where mapping_key = 'customer_credit_liability';
  select account_id into v_disc
  from public.accounting_account_mappings
  where mapping_key = 'sales_discounts';
  select account_id into v_tax_acct
  from public.accounting_account_mappings
  where mapping_key = 'sales_tax_payable';

  -- Attempt tax-inclusive decomposition when a source invoice is provided.
  if p_invoice_id_for_tax is not null then
    select * into v_inv from public.invoices where id = p_invoice_id_for_tax;
    if found then
      if v_inv.customer_id is distinct from p_customer_id then
        return jsonb_build_object(
          'ok', false,
          'error', 'Tax-basis invoice must belong to the same customer as the credit memo.'
        );
      end if;
      select coalesce(sum(coalesce(quantity, 0) * coalesce(rate, 0)), 0)
        into v_subtotal
      from public.invoice_items
      where invoice_id = p_invoice_id_for_tax;
      v_rate := coalesce(v_inv.tax_rate, 0);
      v_tax := round((v_subtotal * (v_rate / 100.0))::numeric, 2);
      v_inv_total := round((v_subtotal + v_tax)::numeric, 2);

      if v_rate <= 0 or v_tax <= 0.005 then
        v_pretax := round(p_amount::numeric, 2);
        v_tax_part := 0;
        v_tax_ok := true;
      else
        v_pretax := round((p_amount / (1 + v_rate / 100.0))::numeric, 2);
        v_tax_part := round((p_amount - v_pretax)::numeric, 2);
        v_expected_share := case
          when v_inv_total > 0 then round((v_tax / v_inv_total)::numeric, 2)
          else 0
        end;
        v_actual_share := case
          when p_amount > 0 then round((v_tax_part / p_amount)::numeric, 2)
          else 0
        end;
        if abs(v_expected_share - v_actual_share) <= 0.02 then
          v_tax_ok := true;
        else
          v_tax_ok := false;
        end if;
      end if;
    end if;
  end if;

  if not v_tax_ok then
    v_review := true;
    -- Conservative tax-inclusive fallback (Sales Discounts only).
    v_frozen := jsonb_build_array(
      jsonb_build_object(
        'accountId', v_disc,
        'debit', round(p_amount::numeric, 2),
        'credit', 0,
        'memo', 'Tax-inclusive credit — review required'
      ),
      jsonb_build_object(
        'accountId', v_liab,
        'debit', 0,
        'credit', round(p_amount::numeric, 2),
        'memo', 'Customer credit liability'
      )
    );
  elsif v_tax_part > 0.005 then
    v_frozen := jsonb_build_array(
      jsonb_build_object(
        'accountId', v_disc,
        'debit', v_pretax,
        'credit', 0,
        'memo', 'Credit pretax'
      ),
      jsonb_build_object(
        'accountId', v_tax_acct,
        'debit', v_tax_part,
        'credit', 0,
        'memo', 'Sales tax payable reduction'
      ),
      jsonb_build_object(
        'accountId', v_liab,
        'debit', 0,
        'credit', round(p_amount::numeric, 2),
        'memo', 'Customer credit liability'
      )
    );
  else
    v_frozen := jsonb_build_array(
      jsonb_build_object(
        'accountId', v_disc,
        'debit', round(p_amount::numeric, 2),
        'credit', 0,
        'memo', 'Non-taxable credit'
      ),
      jsonb_build_object(
        'accountId', v_liab,
        'debit', 0,
        'credit', round(p_amount::numeric, 2),
        'memo', 'Customer credit liability'
      )
    );
  end if;

  if v_liab is null or v_disc is null or (v_tax_ok and v_tax_part > 0.005 and v_tax_acct is null) then
    v_review := true;
  end if;

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'credit_memo_issue',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'credit_memo',
    'sourceId', v_memo_id,
    'amount', round(p_amount::numeric, 2),
    'customerId', p_customer_id,
    'jobId', p_job_id,
    'liabilityAccountId', v_liab,
    'discountsAccountId', v_disc,
    'taxAccountId', v_tax_acct,
    'taxReviewRequired', (not v_tax_ok),
    'invoiceIdForTax', p_invoice_id_for_tax,
    'frozenLines', v_frozen
  );

  perform public.enqueue_accounting_outbox_safe(
    'credit_memo', v_memo_id, 'credit_memo_issue', v_payload, v_review
  );

  return jsonb_build_object(
    'ok', true,
    'credit_memo_id', v_memo_id,
    'duplicate', false
  );
end;
$$;

revoke all on function public.issue_credit_memo_safe from public;
grant execute on function public.issue_credit_memo_safe to authenticated;

-- ---------------------------------------------------------------------------
-- void_credit_memo_safe — block if applications/refunds consumed
-- Economic date for VOID = authorization date (UTC).
-- Original journal key: credit_memo:{id}:issue
-- ---------------------------------------------------------------------------
create or replace function public.void_credit_memo_safe(
  p_memo_id uuid,
  p_voided_by uuid,
  p_void_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_memo public.credit_memos%rowtype;
  v_available numeric;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
  v_actor uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'void credit memos');
  v_actor := public.accounting_actor_id(p_voided_by);
  select * into v_memo from public.credit_memos where id = p_memo_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Credit not found.');
  end if;
  if v_memo.status = 'void' then
    return jsonb_build_object('ok', true, 'credit_memo_id', p_memo_id, 'duplicate', true);
  end if;

  v_available := public.credit_memo_available(p_memo_id);
  if abs(v_available - v_memo.amount) > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Cannot void a credit that has applications or refunds. Reverse those first.',
      'available', v_available,
      'amount', v_memo.amount
    );
  end if;

  update public.credit_memos
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = coalesce(nullif(p_void_reason, ''), 'Voided by staff')
  where id = p_memo_id;

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'credit_memo:' || p_memo_id::text || ':issue'
    and status = 'posted'
  limit 1;

  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'credit_void',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'credit_memo',
    'sourceId', p_memo_id,
    'amount', v_memo.amount,
    'customerId', v_memo.customer_id,
    'jobId', v_memo.job_id,
    'originalJournalEntryId', v_orig,
    'originalIdempotencyKey', 'credit_memo:' || p_memo_id::text || ':issue'
  );

  perform public.enqueue_accounting_outbox_safe(
    'credit_memo', p_memo_id, 'credit_void', v_payload, v_orig is null
  );

  return jsonb_build_object('ok', true, 'credit_memo_id', p_memo_id, 'duplicate', false);
end;
$$;

revoke all on function public.void_credit_memo_safe from public;
grant execute on function public.void_credit_memo_safe to authenticated;

-- ---------------------------------------------------------------------------
-- finalize_invoice_safe — draft → sent + invoice_issue outbox
-- Economic date = invoices.issue_date (set coalesce issue_date, current_date).
-- Journal idempotency matches builders: invoice:{id}:issue
-- ---------------------------------------------------------------------------
create or replace function public.finalize_invoice_safe(
  p_invoice_id uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_ar uuid;
  v_rev uuid;
  v_tax_acct uuid;
  v_econ date;
  v_frozen jsonb;
  v_payload jsonb;
  v_review boolean := false;
  v_outbox_key text;
  v_existing_outbox uuid;
  v_status_changed boolean := false;
  v_actor uuid;
begin
  perform public.accounting_require_roles(
    ARRAY['admin','office','sales_manager','salesman'],
    'finalize invoices'
  );
  v_actor := public.accounting_actor_id(p_actor);

  -- Permit this TX to perform the accounting-relevant status transition.
  perform public.allow_invoice_issue_guard();

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found.');
  end if;
  if v_inv.status = 'void' then
    return jsonb_build_object('ok', false, 'error', 'Cannot finalize a void invoice.');
  end if;

  if v_inv.status = 'draft' then
    if public.accounting_family_pilot_active('invoice') then
      if v_inv.issue_date is null then
        return jsonb_build_object(
          'ok', false,
          'error', 'ACCOUNTING_INVALID_ECONOMIC_DATE: invoice.issue_date is required when invoice posting is enabled.'
        );
      end if;
      update public.invoices
      set status = 'sent'
      where id = p_invoice_id
      returning * into v_inv;
    else
      update public.invoices
      set status = 'sent',
          issue_date = coalesce(issue_date, current_date)
      where id = p_invoice_id
      returning * into v_inv;
    end if;
    v_status_changed := true;
  end if;

  -- Idempotent: if outbox already exists for invoice_issue, return ok.
  v_outbox_key := 'outbox:invoice:' || p_invoice_id::text || ':invoice_issue';
  select id into v_existing_outbox
  from public.accounting_posting_outbox
  where idempotency_key = v_outbox_key
  limit 1;
  if v_existing_outbox is not null then
    return jsonb_build_object(
      'ok', true,
      'invoice_id', p_invoice_id,
      'status', v_inv.status,
      'duplicate', true,
      'outbox_id', v_existing_outbox,
      'status_changed', v_status_changed
    );
  end if;

  select coalesce(sum(coalesce(quantity, 0) * coalesce(rate, 0)), 0)
    into v_subtotal
  from public.invoice_items
  where invoice_id = p_invoice_id;
  v_tax := round((v_subtotal * (coalesce(v_inv.tax_rate, 0) / 100.0))::numeric, 2);
  v_total := round((v_subtotal + v_tax)::numeric, 2);

  -- Zero / near-zero: status update only, no enqueue.
  if v_total <= 0.005 then
    return jsonb_build_object(
      'ok', true,
      'invoice_id', p_invoice_id,
      'status', v_inv.status,
      'enqueued', false,
      'total', v_total,
      'status_changed', v_status_changed
    );
  end if;

  -- Economic date = invoices.issue_date (fail-closed when invoice pilot ON).
  v_econ := public.accounting_resolve_business_date(v_inv.issue_date, 'invoice');

  select account_id into v_ar
  from public.accounting_account_mappings
  where mapping_key = 'accounts_receivable';
  select account_id into v_rev
  from public.accounting_account_mappings
  where mapping_key = 'default_sales_revenue';
  select account_id into v_tax_acct
  from public.accounting_account_mappings
  where mapping_key = 'sales_tax_payable';

  if v_ar is null or v_rev is null or (v_tax > 0.005 and v_tax_acct is null) then
    v_review := true;
  end if;

  if v_tax > 0.005 then
    v_frozen := jsonb_build_array(
      jsonb_build_object(
        'accountId', v_ar, 'debit', v_total, 'credit', 0,
        'memo', 'Accounts receivable',
        'customerId', v_inv.customer_id, 'jobId', v_inv.job_id,
        'invoiceId', p_invoice_id
      ),
      jsonb_build_object(
        'accountId', v_rev, 'debit', 0, 'credit', round(v_subtotal::numeric, 2),
        'memo', 'Sales revenue',
        'customerId', v_inv.customer_id, 'jobId', v_inv.job_id,
        'invoiceId', p_invoice_id
      ),
      jsonb_build_object(
        'accountId', v_tax_acct, 'debit', 0, 'credit', v_tax,
        'memo', 'Sales tax payable',
        'customerId', v_inv.customer_id, 'jobId', v_inv.job_id,
        'invoiceId', p_invoice_id
      )
    );
  else
    v_frozen := jsonb_build_array(
      jsonb_build_object(
        'accountId', v_ar, 'debit', v_total, 'credit', 0,
        'memo', 'Accounts receivable',
        'customerId', v_inv.customer_id, 'jobId', v_inv.job_id,
        'invoiceId', p_invoice_id
      ),
      jsonb_build_object(
        'accountId', v_rev, 'debit', 0, 'credit', round(v_subtotal::numeric, 2),
        'memo', 'Sales revenue',
        'customerId', v_inv.customer_id, 'jobId', v_inv.job_id,
        'invoiceId', p_invoice_id
      )
    );
  end if;

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'invoice_issue',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'invoice',
    'sourceId', p_invoice_id,
    'amount', v_total,
    'subtotal', round(v_subtotal::numeric, 2),
    'tax', v_tax,
    'customerId', v_inv.customer_id,
    'jobId', v_inv.job_id,
    'arAccountId', v_ar,
    'revenueAccountId', v_rev,
    'taxAccountId', v_tax_acct,
    'frozenLines', v_frozen,
    'actorId', v_actor
  );

  perform public.enqueue_accounting_outbox_safe(
    'invoice', p_invoice_id, 'invoice_issue', v_payload, v_review
  );

  return jsonb_build_object(
    'ok', true,
    'invoice_id', p_invoice_id,
    'status', v_inv.status,
    'enqueued', true,
    'total', v_total,
    'duplicate', false,
    'status_changed', v_status_changed
  );
end;
$$;

revoke all on function public.finalize_invoice_safe from public;
grant execute on function public.finalize_invoice_safe to authenticated;

-- ---------------------------------------------------------------------------
-- void_invoice_safe — reject if active payments; enqueue invoice_void
-- Original journal key matches builders finalize: invoice:{id}:issue
-- Economic date for VOID = authorization date (UTC).
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice_safe(
  p_invoice_id uuid,
  p_voided_by uuid,
  p_void_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_active_pays int := 0;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
  v_actor uuid;
begin
  perform public.accounting_require_roles(
    ARRAY['admin','office','sales_manager','salesman'],
    'void invoices'
  );
  v_actor := public.accounting_actor_id(p_voided_by);
  -- Void of an already-issued invoice may set status=void; allow guard for consistency.
  perform public.allow_invoice_issue_guard();

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found.');
  end if;
  if v_inv.status = 'void' then
    return jsonb_build_object('ok', true, 'invoice_id', p_invoice_id, 'duplicate', true);
  end if;

  select count(*) into v_active_pays
  from public.payments
  where invoice_id = p_invoice_id
    and status = 'active';
  if v_active_pays > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Cannot void an invoice with active payments. Void payments first.',
      'active_payments', v_active_pays
    );
  end if;

  update public.invoices
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = coalesce(nullif(p_void_reason, ''), 'Voided by staff')
  where id = p_invoice_id;

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'invoice:' || p_invoice_id::text || ':issue'
    and status = 'posted'
  limit 1;

  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'invoice_void',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'invoice',
    'sourceId', p_invoice_id,
    'customerId', v_inv.customer_id,
    'jobId', v_inv.job_id,
    'originalJournalEntryId', v_orig,
    'originalIdempotencyKey', 'invoice:' || p_invoice_id::text || ':issue'
  );

  perform public.enqueue_accounting_outbox_safe(
    'invoice', p_invoice_id, 'invoice_void', v_payload, v_orig is null
  );

  return jsonb_build_object('ok', true, 'invoice_id', p_invoice_id, 'duplicate', false);
end;
$$;

revoke all on function public.void_invoice_safe from public;
grant execute on function public.void_invoice_safe to authenticated;

-- ---------------------------------------------------------------------------
-- Invoice issue guard: when invoice accounting pilot is ON, draft→sent/partial/paid
-- (and INSERT already issued) requires finalize_invoice_safe session flag.
-- When posting disabled: no interference (current ops continue).
-- ---------------------------------------------------------------------------
create or replace function public.invoice_accounting_pilot_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select posting_enabled and invoice_posting_enabled
     from public.accounting_settings where id = 1),
    false
  );
$$;

create or replace function public.invoices_enforce_issue_via_finalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allow text;
  v_old text;
  v_new text;
begin
  if not public.invoice_accounting_pilot_active() then
    return new;
  end if;

  v_allow := nullif(current_setting('floorking.allow_invoice_issue', true), '');
  if v_allow = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status::text in ('sent', 'partial', 'paid') then
      raise exception
        'INVOICE_ISSUE_BYPASS: cannot insert invoice as % while invoice accounting is enabled; use finalize_invoice_safe (draft → finalize).',
        new.status;
    end if;
    return new;
  end if;

  v_old := old.status::text;
  v_new := new.status::text;
  if v_old = 'draft' and v_new in ('sent', 'partial', 'paid') then
    raise exception
      'INVOICE_ISSUE_BYPASS: cannot transition invoice % → % while invoice accounting is enabled; call finalize_invoice_safe first.',
      v_old, v_new;
  end if;
  if v_old is distinct from v_new
     and v_new in ('sent', 'partial', 'paid')
     and v_old not in ('sent', 'partial', 'paid', 'void')
  then
    raise exception
      'INVOICE_ISSUE_BYPASS: cannot set invoice status to % while invoice accounting is enabled without finalize_invoice_safe.',
      v_new;
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_enforce_issue_via_finalize_trg on public.invoices;
create trigger invoices_enforce_issue_via_finalize_trg
  before insert or update of status on public.invoices
  for each row
  execute function public.invoices_enforce_issue_via_finalize();

revoke all on function public.invoice_accounting_pilot_active from public;
grant execute on function public.invoice_accounting_pilot_active to authenticated;
