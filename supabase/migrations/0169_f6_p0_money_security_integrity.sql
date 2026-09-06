-- F6-P0: Harden F0–F4 money RPCs (0168 model), fix payment/credit balance math,
-- service_role-only outbox claim, admin-only journal posting.
-- Non-destructive. Does not enable posting. No business data mutation.
-- Applied AFTER 0168. Do not edit 0158–0168.

-- ---------------------------------------------------------------------------
-- invoice_commercial_total — canonical parity with src/lib/invoice-calc.ts
-- Discounts are negative invoice_items lines (qty × rate), not a separate column.
-- subtotal = sum(qty × rate) including discount lines
-- tax      = subtotal × (tax_rate / 100)   [no per-component rounding]
-- total    = subtotal + tax
-- ---------------------------------------------------------------------------
create or replace function public.invoice_commercial_total(p_invoice_id uuid)
returns table (
  subtotal numeric,
  tax numeric,
  total numeric,
  item_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select
      coalesce(sum(coalesce(quantity, 0) * coalesce(rate, 0)), 0) as subtotal,
      count(*)::int as item_count
    from public.invoice_items
    where invoice_id = p_invoice_id
  ),
  inv as (
    select coalesce(tax_rate, 0) as tax_rate
    from public.invoices
    where id = p_invoice_id
  )
  select
    l.subtotal,
    (l.subtotal * (i.tax_rate / 100.0)) as tax,
    (l.subtotal + (l.subtotal * (i.tax_rate / 100.0))) as total,
    l.item_count
  from lines l
  cross join inv i;
$$;

revoke all on function public.invoice_commercial_total(uuid) from public;
grant execute on function public.invoice_commercial_total(uuid) to authenticated;
grant execute on function public.invoice_commercial_total(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- record_invoice_payment_safe — role gate, actor resolution, credit-aware balance
-- ---------------------------------------------------------------------------
create or replace function public.record_invoice_payment_safe(
  p_invoice_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_reference text,
  p_paid_at date,
  p_notes text,
  p_created_by uuid,
  p_idempotency_key text default null,
  p_allow_deposit_on_zero_total boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_inv public.invoices%rowtype;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_credited numeric := 0;
  v_remaining numeric := 0;
  v_existing uuid;
  v_existing_invoice uuid;
  v_pay_id uuid;
  v_item_count int := 0;
  v_cash uuid;
  v_ar uuid;
  v_payload jsonb;
  v_econ date;
begin
  perform public.accounting_require_roles(
    ARRAY['admin', 'office', 'sales_manager', 'salesman'],
    'record invoice payments'
  );
  v_actor := public.accounting_actor_id(p_created_by);

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Payment amount must be greater than zero.');
  end if;

  -- Fast-path idempotency (pre-lock). Cross-invoice keys are rejected, not converged.
  if p_idempotency_key is not null then
    select p.id, p.invoice_id
      into v_existing, v_existing_invoice
    from public.payments p
    where p.idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      if v_existing_invoice = p_invoice_id then
        return jsonb_build_object(
          'ok', true,
          'payment_id', v_existing,
          'duplicate', true
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error',
        'Idempotency key already used for a different invoice.',
        'code', 'IDEMPOTENCY_CROSS_INVOICE'
      );
    end if;
  end if;

  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found.');
  end if;
  if v_inv.status = 'void' then
    return jsonb_build_object('ok', false, 'error', 'Cannot record a payment on a void invoice.');
  end if;

  -- Post-lock idempotency recheck (TOCTOU / concurrent same-key safety).
  if p_idempotency_key is not null then
    select p.id, p.invoice_id
      into v_existing, v_existing_invoice
    from public.payments p
    where p.idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      if v_existing_invoice = p_invoice_id then
        return jsonb_build_object(
          'ok', true,
          'payment_id', v_existing,
          'duplicate', true
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error',
        'Idempotency key already used for a different invoice.',
        'code', 'IDEMPOTENCY_CROSS_INVOICE'
      );
    end if;
  end if;

  select t.subtotal, t.tax, t.total, t.item_count
    into v_subtotal, v_tax, v_total, v_item_count
  from public.invoice_commercial_total(p_invoice_id) as t;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where invoice_id = p_invoice_id
    and status = 'active';

  v_credited := public.invoice_applied_credits(p_invoice_id);
  v_remaining := round((v_total - v_paid - v_credited)::numeric, 2);

  -- Pre-invoice deposits must use record_customer_deposit_safe (never blank invoices).
  if v_item_count = 0 and v_total <= 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error',
      'Cannot record an AR payment on a zero-total invoice. Use record_customer_deposit_safe for pre-invoice customer deposits.'
    );
  end if;

  if v_remaining <= 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Invoice has no remaining balance.',
      'remaining', 0
    );
  end if;

  if round(p_amount::numeric, 2) > v_remaining + 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        'Payment exceeds the remaining balance of $%s.',
        to_char(greatest(v_remaining, 0), 'FM999999990.00')
      ),
      'remaining', greatest(v_remaining, 0)
    );
  end if;

  insert into public.payments (
    invoice_id, amount, method, reference, paid_at, notes, created_by,
    status, idempotency_key
  ) values (
    p_invoice_id,
    round(p_amount::numeric, 2),
    coalesce(p_method, 'other'),
    nullif(p_reference, ''),
    coalesce(p_paid_at, current_date),
    nullif(p_notes, ''),
    v_actor,
    'active',
    nullif(p_idempotency_key, '')
  )
  returning id into v_pay_id;

  v_econ := coalesce(p_paid_at, current_date);
  select account_id into v_cash
  from public.accounting_payment_method_mappings
  where payment_method = coalesce(p_method::text, 'other');
  select account_id into v_ar
  from public.accounting_account_mappings
  where mapping_key = 'accounts_receivable';

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'payment',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'payment',
    'sourceId', v_pay_id,
    'amount', round(p_amount::numeric, 2),
    'invoiceId', p_invoice_id,
    'customerId', v_inv.customer_id,
    'jobId', v_inv.job_id,
    'paymentMethod', coalesce(p_method::text, 'other'),
    'cashAccountId', v_cash,
    'arAccountId', v_ar
  );

  if v_cash is null or v_ar is null then
    perform public.enqueue_accounting_outbox_safe(
      'payment', v_pay_id, 'payment', v_payload, true
    );
  else
    perform public.enqueue_accounting_outbox_safe(
      'payment', v_pay_id, 'payment', v_payload, false
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_pay_id,
    'duplicate', false,
    'remaining_after', greatest(0, round((v_remaining - p_amount)::numeric, 2))
  );
exception
  when unique_violation then
    if p_idempotency_key is not null then
      select p.id, p.invoice_id
        into v_existing, v_existing_invoice
      from public.payments p
      where p.idempotency_key = p_idempotency_key
      limit 1;
      if v_existing is not null then
        if v_existing_invoice = p_invoice_id then
          return jsonb_build_object(
            'ok', true,
            'payment_id', v_existing,
            'duplicate', true
          );
        end if;
        return jsonb_build_object(
          'ok', false,
          'error',
          'Idempotency key already used for a different invoice.',
          'code', 'IDEMPOTENCY_CROSS_INVOICE'
        );
      end if;
    end if;
    return jsonb_build_object(
      'ok', false,
      'error', 'Duplicate payment blocked.',
      'code', 'IDEMPOTENCY_CONFLICT'
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- void_invoice_payment_safe
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice_payment_safe(
  p_payment_id uuid,
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
  v_pay public.payments%rowtype;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
begin
  perform public.accounting_require_roles(
    ARRAY['admin', 'office'],
    'void invoice payments'
  );
  v_actor := public.accounting_actor_id(p_voided_by);

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Payment not found.');
  end if;
  if v_pay.status = 'void' then
    return jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'duplicate', true);
  end if;

  update public.payments
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = coalesce(nullif(p_void_reason, ''), 'Voided by staff')
  where id = p_payment_id;

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'payment:' || p_payment_id::text || ':post'
    and status = 'posted'
  limit 1;

  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'payment_void',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'payment',
    'sourceId', p_payment_id,
    'amount', v_pay.amount,
    'invoiceId', v_pay.invoice_id,
    'originalJournalEntryId', v_orig,
    'originalIdempotencyKey', 'payment:' || p_payment_id::text || ':post'
  );

  perform public.enqueue_accounting_outbox_safe(
    'payment', p_payment_id, 'payment_void', v_payload, v_orig is null
  );

  return jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_credit_to_invoice_safe
-- ---------------------------------------------------------------------------
create or replace function public.apply_credit_to_invoice_safe(
  p_credit_memo_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_created_by uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_memo public.credit_memos%rowtype;
  v_inv public.invoices%rowtype;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_credited numeric := 0;
  v_remaining numeric := 0;
  v_available numeric := 0;
  v_apply numeric := 0;
  v_existing uuid;
  v_app_id uuid;
  v_liab uuid;
  v_ar uuid;
  v_payload jsonb;
  v_econ date;
begin
  perform public.accounting_require_roles(
    ARRAY['admin', 'office'],
    'apply credits to invoices'
  );
  v_actor := public.accounting_actor_id(p_created_by);

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Credit amount must be greater than zero.');
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.credit_applications
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'application_id', v_existing, 'duplicate', true);
    end if;
  end if;

  select * into v_memo
  from public.credit_memos
  where id = p_credit_memo_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Credit not found.');
  end if;
  if v_memo.status <> 'issued' then
    return jsonb_build_object('ok', false, 'error', 'Cannot apply a voided credit.');
  end if;

  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found.');
  end if;
  if v_inv.status = 'void' then
    return jsonb_build_object('ok', false, 'error', 'Cannot apply credit to a void invoice.');
  end if;
  if v_inv.customer_id <> v_memo.customer_id then
    return jsonb_build_object('ok', false, 'error', 'Credit and invoice must belong to the same customer.');
  end if;

  if v_memo.job_id is not null and v_inv.job_id is not null and v_inv.job_id <> v_memo.job_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'This credit belongs to a different job. Cross-job application is not allowed.'
    );
  end if;

  v_available := public.credit_memo_available(p_credit_memo_id);
  if p_amount > v_available + 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error',
      format(
        'Cannot apply more than available credit. Available: $%s.',
        to_char(v_available, 'FM999999990.00')
      ),
      'available', v_available
    );
  end if;

  select t.total
    into v_total
  from public.invoice_commercial_total(p_invoice_id) as t;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where invoice_id = p_invoice_id and status = 'active';
  v_credited := public.invoice_applied_credits(p_invoice_id);
  v_remaining := round((v_total - v_paid - v_credited)::numeric, 2);

  if v_remaining <= 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Invoice has no remaining balance to apply this credit against.'
    );
  end if;

  v_apply := least(p_amount, v_remaining);
  v_apply := round(v_apply::numeric, 2);
  if v_apply <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Nothing to apply.');
  end if;

  begin
    insert into public.credit_applications (
      credit_memo_id, invoice_id, amount, status, created_by, idempotency_key
    ) values (
      p_credit_memo_id, p_invoice_id, v_apply, 'active', v_actor, p_idempotency_key
    )
    returning id into v_app_id;
  exception
    when unique_violation then
      select id into v_existing
      from public.credit_applications
      where idempotency_key = p_idempotency_key
      limit 1;
      return jsonb_build_object('ok', true, 'application_id', v_existing, 'duplicate', true);
  end;

  select account_id into v_liab
  from public.accounting_account_mappings
  where mapping_key = 'customer_credit_liability';
  select account_id into v_ar
  from public.accounting_account_mappings
  where mapping_key = 'accounts_receivable';

  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'credit_application',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'credit_application',
    'sourceId', v_app_id,
    'amount', v_apply,
    'invoiceId', p_invoice_id,
    'customerId', v_inv.customer_id,
    'creditMemoId', p_credit_memo_id,
    'liabilityAccountId', v_liab,
    'arAccountId', v_ar
  );

  perform public.enqueue_accounting_outbox_safe(
    'credit_application', v_app_id, 'credit_application', v_payload,
    (v_liab is null or v_ar is null)
  );

  return jsonb_build_object(
    'ok', true,
    'application_id', v_app_id,
    'duplicate', false,
    'applied', v_apply,
    'remaining_after', round((v_remaining - v_apply)::numeric, 2)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- record_refund_safe
-- ---------------------------------------------------------------------------
create or replace function public.record_refund_safe(
  p_credit_memo_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_reference text,
  p_refunded_at date,
  p_notes text,
  p_created_by uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_memo public.credit_memos%rowtype;
  v_available numeric := 0;
  v_existing uuid;
  v_refund_id uuid;
  v_liab uuid;
  v_cash uuid;
  v_payload jsonb;
  v_econ date;
begin
  perform public.accounting_require_roles(
    ARRAY['admin', 'office'],
    'record refunds'
  );
  v_actor := public.accounting_actor_id(p_created_by);

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Refund amount must be greater than zero.');
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.refunds
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'refund_id', v_existing, 'duplicate', true);
    end if;
  end if;

  select * into v_memo
  from public.credit_memos
  where id = p_credit_memo_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Credit not found.');
  end if;
  if v_memo.status <> 'issued' then
    return jsonb_build_object('ok', false, 'error', 'Cannot refund a voided credit.');
  end if;

  v_available := public.credit_memo_available(p_credit_memo_id);
  if p_amount > v_available + 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error',
      format(
        'Cannot refund more than available credit. Available: $%s.',
        to_char(v_available, 'FM999999990.00')
      ),
      'available', v_available
    );
  end if;

  begin
    insert into public.refunds (
      customer_id, credit_memo_id, amount, method, reference, refunded_at,
      notes, status, created_by, idempotency_key
    ) values (
      v_memo.customer_id, p_credit_memo_id, p_amount, p_method,
      nullif(p_reference, ''), p_refunded_at, nullif(p_notes, ''),
      'active', v_actor, p_idempotency_key
    )
    returning id into v_refund_id;
  exception
    when unique_violation then
      select id into v_existing
      from public.refunds
      where idempotency_key = p_idempotency_key
      limit 1;
      return jsonb_build_object('ok', true, 'refund_id', v_existing, 'duplicate', true);
  end;

  select account_id into v_liab
  from public.accounting_account_mappings
  where mapping_key = 'customer_credit_liability';
  select account_id into v_cash
  from public.accounting_payment_method_mappings
  where payment_method = coalesce(p_method::text, 'other');
  if v_cash is null then
    select account_id into v_cash
    from public.accounting_account_mappings
    where mapping_key = 'cash_operating';
  end if;

  v_econ := coalesce(p_refunded_at, current_date);
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'refund',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'refund',
    'sourceId', v_refund_id,
    'amount', round(p_amount::numeric, 2),
    'customerId', v_memo.customer_id,
    'creditMemoId', p_credit_memo_id,
    'paymentMethod', coalesce(p_method::text, 'other'),
    'liabilityAccountId', v_liab,
    'cashAccountId', v_cash
  );
  perform public.enqueue_accounting_outbox_safe(
    'refund', v_refund_id, 'refund', v_payload,
    (v_liab is null or v_cash is null)
  );

  return jsonb_build_object(
    'ok', true,
    'refund_id', v_refund_id,
    'duplicate', false,
    'available_after', round((v_available - p_amount)::numeric, 2)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- post_journal_entry_safe — admin manual posts; service_role automation
-- ---------------------------------------------------------------------------
create or replace function public.post_journal_entry_safe(
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_entry_kind text,
  p_idempotency_key text,
  p_lines jsonb,
  p_posted_by uuid default null,
  p_reversal_of_id uuid default null,
  p_reversal_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_posted_by uuid;
  v_existing uuid;
  v_period_id uuid;
  v_period_status text;
  v_entry_id uuid;
  v_line jsonb;
  v_debit numeric(12,2) := 0;
  v_credit numeric(12,2) := 0;
  v_line_debit numeric(12,2);
  v_line_credit numeric(12,2);
  v_line_no int := 0;
  v_settings record;
begin
  if not public.accounting_is_service_role() then
    perform public.accounting_require_roles(
      ARRAY['admin'],
      'post journal entries'
    );
  end if;
  v_posted_by := public.accounting_actor_id(p_posted_by);

  if p_idempotency_key is not null then
    select id into v_existing
    from public.journal_entries
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'duplicate', true, 'journal_entry_id', v_existing);
    end if;
  end if;

  select * into v_settings from public.accounting_settings where id = 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Accounting settings missing.');
  end if;

  if p_entry_kind = 'post' and coalesce(v_settings.posting_enabled, false) = false
     and p_source_type not in ('manual', 'opening_balance') then
    return jsonb_build_object(
      'ok', false,
      'error', 'Automatic accounting posting is disabled. Enable after cutover validation.',
      'skipped', true
    );
  end if;

  if v_settings.cutover_date is not null
     and p_entry_date < v_settings.cutover_date
     and p_entry_kind <> 'opening_balance' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Entry date is before accounting cutover. Historical backfill is not automatic.',
      'skipped', true
    );
  end if;

  v_period_id := public.accounting_period_for_date(p_entry_date);
  if v_period_id is null then
    return jsonb_build_object('ok', false, 'error', 'No accounting period covers this entry date.');
  end if;

  select status into v_period_status from public.accounting_periods where id = v_period_id;
  if v_period_status = 'locked' then
    return jsonb_build_object('ok', false, 'error', 'Accounting period is locked.');
  end if;
  if v_period_status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'Accounting period is closed.');
  end if;

  if p_reversal_of_id is not null then
    if exists (
      select 1 from public.journal_entries
      where reversal_of_id = p_reversal_of_id and status = 'posted'
    ) then
      return jsonb_build_object('ok', false, 'error', 'Journal entry already reversed.');
    end if;
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    return jsonb_build_object('ok', false, 'error', 'Journal requires at least two lines.');
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_debit := coalesce((v_line->>'debit')::numeric, 0);
    v_line_credit := coalesce((v_line->>'credit')::numeric, 0);
    if v_line_debit < 0 or v_line_credit < 0 then
      return jsonb_build_object('ok', false, 'error', 'Journal line amounts must be non-negative.');
    end if;
    if (v_line_debit > 0 and v_line_credit > 0) or (v_line_debit = 0 and v_line_credit = 0) then
      return jsonb_build_object('ok', false, 'error', 'Each journal line must be debit XOR credit.');
    end if;
    v_debit := v_debit + v_line_debit;
    v_credit := v_credit + v_line_credit;
  end loop;

  if round(v_debit, 2) <> round(v_credit, 2) then
    return jsonb_build_object(
      'ok', false,
      'error', format('Unbalanced journal: debits %s credits %s', v_debit, v_credit)
    );
  end if;
  if v_debit <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Journal total must be greater than zero.');
  end if;

  insert into public.journal_entries (
    entry_date, description, source_type, source_id, entry_kind, status,
    period_id, idempotency_key, reversal_of_id, reversal_reason,
    created_by, posted_by, posted_at
  ) values (
    p_entry_date,
    coalesce(p_description, ''),
    p_source_type,
    p_source_id,
    coalesce(p_entry_kind, 'post'),
    'draft',
    v_period_id,
    p_idempotency_key,
    p_reversal_of_id,
    p_reversal_reason,
    v_posted_by,
    v_posted_by,
    now()
  )
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    insert into public.journal_lines (
      journal_entry_id, account_id, debit, credit, memo,
      customer_id, vendor_id, job_id, invoice_id, bill_id, line_no
    ) values (
      v_entry_id,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo',
      nullif(v_line->>'customer_id', '')::uuid,
      nullif(v_line->>'vendor_id', '')::uuid,
      nullif(v_line->>'job_id', '')::uuid,
      nullif(v_line->>'invoice_id', '')::uuid,
      nullif(v_line->>'bill_id', '')::uuid,
      v_line_no
    );
  end loop;

  update public.journal_entries
  set status = 'posted'
  where id = v_entry_id;

  if p_reversal_of_id is not null then
    update public.journal_entries
    set reversed_by_id = v_entry_id
    where id = p_reversal_of_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'journal_entry_id', v_entry_id,
    'debits', v_debit,
    'credits', v_credit
  );
exception
  when unique_violation then
    if p_idempotency_key is not null then
      select id into v_existing
      from public.journal_entries
      where idempotency_key = p_idempotency_key
      limit 1;
      if v_existing is not null then
        return jsonb_build_object('ok', true, 'duplicate', true, 'journal_entry_id', v_existing);
      end if;
    end if;
    return jsonb_build_object('ok', false, 'error', 'Duplicate journal source posting blocked.');
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_accounting_outbox_item — service_role worker only
-- ---------------------------------------------------------------------------
create or replace function public.claim_accounting_outbox_item(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.accounting_posting_outbox%rowtype;
begin
  if not public.accounting_is_service_role() then
    raise exception
      'ACCOUNTING_FORBIDDEN: claim_accounting_outbox_item is service_role only.'
      using errcode = '42501';
  end if;

  update public.accounting_posting_outbox o
  set status = 'processing',
      attempt_count = o.attempt_count + 1,
      updated_at = now()
  where o.id = p_id
    and (
      o.status in ('pending', 'failed', 'error')
      or (
        o.status = 'processing'
        and o.updated_at < now() - interval '15 minutes'
      )
    )
    and (o.next_attempt_at is null or o.next_attempt_at <= now()
         or o.status = 'processing')
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Claim lost or not ready.');
  end if;

  return jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- record_customer_deposit_safe — extend to sales roles (card collection UX)
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
  perform public.accounting_require_roles(
    ARRAY['admin', 'office', 'sales_manager', 'salesman'],
    'record customer deposits'
  );
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

-- ---------------------------------------------------------------------------
-- EXECUTE ACLs — F0–F4 legacy money RPCs + journal + claim (defense in depth)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_internal text[] := array[
    'allow_invoice_issue_guard',
    'enqueue_accounting_outbox_safe'
  ];
  v_worker text[] := array[
    'claim_accounting_outbox_item'
  ];
  v_staff_rpc text[] := array[
    'record_invoice_payment_safe',
    'void_invoice_payment_safe',
    'apply_credit_to_invoice_safe',
    'record_refund_safe',
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
  v_journal_rpc text[] := array[
    'post_journal_entry_safe'
  ];
  v_read_helper text[] := array[
    'invoice_applied_credits',
    'credit_memo_available',
    'invoice_commercial_total'
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
  v_all := v_internal || v_worker || v_staff_rpc || v_journal_rpc || v_read_helper || v_helper;

  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_all)
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);

    if r.proname = any (v_internal) or r.proname = any (v_worker) then
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname = any (v_staff_rpc) or r.proname = any (v_helper) then
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname = any (v_journal_rpc) then
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname = any (v_read_helper) then
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end;
$$;
