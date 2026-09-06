-- F6-P2A: Retrofit financial audit logging across F0–F5 / F6-P0 money RPCs.
-- Non-destructive. Does not enable posting. No business data mutation.
-- Applied AFTER 0170. Do not edit 0154–0170.
--
-- Adds accounting_audit_from_definer_safe helper and redefines money RPCs with
-- append-only financial_audit_log entries (transactional, idempotent).
-- Owner-review revision: canonical invoice_open_ar_balance across AR consumers.

-- ---------------------------------------------------------------------------
-- accounting_audit_from_definer_safe — trusted internal audit wrapper
-- ---------------------------------------------------------------------------
create or replace function public.accounting_audit_from_definer_safe(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_economic_date date,
  p_reason text,
  p_payload jsonb,
  p_actor uuid,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.trusted_definer_audit', 'true', true);
  perform public.log_financial_audit_safe(
    p_action,
    p_entity_type,
    p_entity_id,
    p_economic_date,
    p_reason,
    coalesce(p_payload, '{}'::jsonb),
    p_actor,
    p_idempotency_key
  );
  perform set_config('app.trusted_definer_audit', 'false', true);
exception
  when others then
    perform set_config('app.trusted_definer_audit', 'false', true);
    raise;
end;
$$;

revoke all on function public.accounting_audit_from_definer_safe(
  text, text, uuid, date, text, jsonb, uuid, text
) from public;
revoke all on function public.accounting_audit_from_definer_safe(
  text, text, uuid, date, text, jsonb, uuid, text
) from anon;
revoke all on function public.accounting_audit_from_definer_safe(
  text, text, uuid, date, text, jsonb, uuid, text
) from authenticated;
grant execute on function public.accounting_audit_from_definer_safe(
  text, text, uuid, date, text, jsonb, uuid, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Canonical open AR helpers (payments + credits + deposits + write-offs)
-- ---------------------------------------------------------------------------
create or replace function public.invoice_applied_deposits(p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric
  from public.customer_deposit_applications
  where invoice_id = p_invoice_id
    and status = 'active';
$$;

revoke all on function public.invoice_applied_deposits(uuid) from public;
revoke all on function public.invoice_applied_deposits(uuid) from anon;
grant execute on function public.invoice_applied_deposits(uuid) to authenticated;
grant execute on function public.invoice_applied_deposits(uuid) to service_role;

create or replace function public.invoice_open_ar_balance(p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    0,
    round((
      coalesce((select t.total from public.invoice_commercial_total(p_invoice_id) as t), 0)
      - coalesce((
          select sum(amount) from public.payments
          where invoice_id = p_invoice_id and status = 'active'
        ), 0)
      - coalesce(public.invoice_applied_credits(p_invoice_id), 0)
      - coalesce(public.invoice_applied_deposits(p_invoice_id), 0)
      - coalesce(public.invoice_applied_write_offs(p_invoice_id), 0)
    )::numeric, 2)
  );
$$;

revoke all on function public.invoice_open_ar_balance(uuid) from public;
revoke all on function public.invoice_open_ar_balance(uuid) from anon;
grant execute on function public.invoice_open_ar_balance(uuid) to authenticated;
grant execute on function public.invoice_open_ar_balance(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- enqueue_accounting_outbox_safe — add void/write-off event kinds (0171 Option A)
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
  elsif p_event_kind in (
    'credit_application', 'credit_application_void',
    'refund', 'refund_void',
    'credit_memo_issue', 'credit_void'
  ) then
    v_event_ok := coalesce(v_settings.credit_posting_enabled, false);
  elsif p_event_kind in ('vendor_bill', 'bill_payment', 'bill_payment_void') then
    v_event_ok := coalesce(v_settings.ap_posting_enabled, false);
  elsif p_event_kind in (
    'invoice_issue', 'invoice_void',
    'invoice_write_off', 'invoice_write_off_void'
  ) then
    v_event_ok := coalesce(v_settings.invoice_posting_enabled, false);
  elsif p_event_kind in ('direct_expense') then
    v_event_ok := coalesce(v_settings.expense_posting_enabled, false);
  elsif p_event_kind in (
    'customer_deposit', 'deposit_apply', 'deposit_apply_void', 'customer_deposit_void'
  ) then
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

revoke all on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) from public;
revoke all on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) from anon;
revoke all on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) from authenticated;
grant execute on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) to service_role;



-- ---------------------------------------------------------------------------
-- void_refund_safe (F6-P2A audit retrofit)
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

perform public.accounting_audit_from_definer_safe(
    'refund_voided', 'refund', p_refund_id, v_econ,
    coalesce(nullif(p_void_reason, ''), 'Voided by staff'),
    jsonb_build_object(
      'refundId', p_refund_id,
      'creditMemoId', v_ref.credit_memo_id,
      'amount', v_ref.amount
    ),
    v_actor, 'audit:refund_void:' || p_refund_id::text
  );



  return jsonb_build_object('ok', true, 'refund_id', p_refund_id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- issue_credit_memo_safe (F6-P2A audit retrofit)
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
  v_existing_customer uuid;
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
    select id, customer_id
      into v_existing, v_existing_customer
    from public.credit_memos
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      if v_existing_customer = p_customer_id then
        return jsonb_build_object(
          'ok', true,
          'credit_memo_id', v_existing,
          'duplicate', true
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different customer credit memo.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
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
      select id, customer_id
        into v_existing, v_existing_customer
      from public.credit_memos
      where idempotency_key = p_idempotency_key
      limit 1;
      if v_existing is not null and v_existing_customer = p_customer_id then
        return jsonb_build_object(
          'ok', true,
          'credit_memo_id', v_existing,
          'duplicate', true
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different customer credit memo.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
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

perform public.accounting_audit_from_definer_safe(
    'credit_memo_issued', 'credit_memo', v_memo_id, v_econ,
    nullif(trim(p_reason), ''),
    jsonb_build_object(
      'amount', round(p_amount::numeric, 2),
      'creditMemoId', v_memo_id,
      'customerId', p_customer_id,
      'invoiceIdForTax', p_invoice_id_for_tax
    ),
    v_actor, 'audit:credit_memo:' || v_memo_id::text
  );



  return jsonb_build_object(
    'ok', true,
    'credit_memo_id', v_memo_id,
    'duplicate', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- void_credit_memo_safe (F6-P2A audit retrofit)
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

perform public.accounting_audit_from_definer_safe(
    'credit_memo_voided', 'credit_memo', p_memo_id, v_econ,
    coalesce(nullif(p_void_reason, ''), 'Credit memo voided'),
    jsonb_build_object(
      'creditMemoId', p_memo_id,
      'customerId', v_memo.customer_id,
      'amount', v_memo.amount
    ),
    v_actor, 'audit:credit_memo_void:' || p_memo_id::text
  );



  return jsonb_build_object('ok', true, 'credit_memo_id', p_memo_id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- finalize_invoice_safe (F6-P2A audit retrofit)
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

perform public.accounting_audit_from_definer_safe(
    'invoice_finalized', 'invoice', p_invoice_id, v_econ, null,
    jsonb_build_object(
      'invoiceId', p_invoice_id,
      'customerId', v_inv.customer_id,
      'jobId', v_inv.job_id,
      'total', v_total
    ),
    v_actor, 'audit:invoice_finalize:' || p_invoice_id::text
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

-- ---------------------------------------------------------------------------
-- void_invoice_safe (F6-P2A audit retrofit)
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
  v_active_credits int := 0;
  v_active_deposits int := 0;
  v_active_write_offs int := 0;
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

  select count(*) into v_active_credits
  from public.credit_applications
  where invoice_id = p_invoice_id
    and status = 'active';

  select count(*) into v_active_deposits
  from public.customer_deposit_applications
  where invoice_id = p_invoice_id
    and status = 'active';

  select count(*) into v_active_write_offs
  from public.invoice_write_offs
  where invoice_id = p_invoice_id
    and status = 'active';

  if v_active_pays > 0
     or v_active_credits > 0
     or v_active_deposits > 0
     or v_active_write_offs > 0 then
    return jsonb_build_object(
      'ok', false,
      'error',
      'Cannot void invoice with active financial activity. Reverse payments, credits, deposit applications, and write-offs first.',
      'active_payments', v_active_pays,
      'active_credit_applications', v_active_credits,
      'active_deposit_applications', v_active_deposits,
      'active_write_offs', v_active_write_offs
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

  perform public.accounting_audit_from_definer_safe(
    'invoice_voided', 'invoice', p_invoice_id, v_econ,
    coalesce(nullif(p_void_reason, ''), 'Invoice voided'),
    jsonb_build_object(
      'invoiceId', p_invoice_id,
      'customerId', v_inv.customer_id,
      'jobId', v_inv.job_id
    ),
    v_actor, 'audit:invoice_void:' || p_invoice_id::text
  );

  return jsonb_build_object('ok', true, 'invoice_id', p_invoice_id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- post_vendor_bill_safe (F6-P2A audit retrofit)
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

perform public.accounting_audit_from_definer_safe(
    'vendor_bill_posted', 'vendor_bill', p_bill_id, v_econ, null,
    jsonb_build_object(
      'billId', p_bill_id,
      'vendorId', v_bill.vendor_id,
      'amount', v_amount
    ),
    v_actor, 'audit:vendor_bill:' || p_bill_id::text
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

-- ---------------------------------------------------------------------------
-- record_bill_payment_safe (F6-P2A audit retrofit)
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
  v_existing_bill uuid;
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
    select id, bill_id
      into v_existing, v_existing_bill
    from public.bill_payments
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      if v_existing_bill = p_bill_id then
        return jsonb_build_object(
          'ok', true,
          'bill_payment_id', v_existing,
          'duplicate', true
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different bill payment.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
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
      select id, bill_id
        into v_existing, v_existing_bill
      from public.bill_payments
      where idempotency_key = p_idempotency_key
      limit 1;
      if v_existing is not null and v_existing_bill = p_bill_id then
        return jsonb_build_object(
          'ok', true,
          'bill_payment_id', v_existing,
          'duplicate', true
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different bill payment.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
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

perform public.accounting_audit_from_definer_safe(
    'bill_payment_recorded', 'bill_payment', v_pay_id, v_econ, null,
    jsonb_build_object(
      'billPaymentId', v_pay_id,
      'billId', p_bill_id,
      'amount', round(p_amount::numeric, 2),
      'vendorId', v_bill.vendor_id
    ),
    v_actor, 'audit:bill_payment:' || v_pay_id::text
  );



  return jsonb_build_object(
    'ok', true,
    'bill_payment_id', v_pay_id,
    'duplicate', false,
    'remaining_after', greatest(0, round((v_remaining - p_amount)::numeric, 2))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- void_bill_payment_safe (F6-P2A audit retrofit)
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

perform public.accounting_audit_from_definer_safe(
    'bill_payment_voided', 'bill_payment', p_bill_payment_id, v_econ,
    coalesce(nullif(p_void_reason, ''), 'Bill payment voided'),
    jsonb_build_object(
      'billPaymentId', p_bill_payment_id,
      'billId', v_pay.bill_id,
      'amount', v_pay.amount
    ),
    v_actor, 'audit:bill_payment_void:' || p_bill_payment_id::text
  );



  return jsonb_build_object(
    'ok', true,
    'bill_payment_id', p_bill_payment_id,
    'duplicate', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- record_direct_expense_safe (F6-P2A audit retrofit)
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

perform public.accounting_audit_from_definer_safe(
    'direct_expense_recorded', 'expense', v_expense_id, v_econ, null,
    jsonb_build_object(
      'expenseId', v_expense_id,
      'amount', round(p_amount::numeric, 2),
      'category', p_category::text
    ),
    v_actor, 'audit:expense:' || v_expense_id::text
  );



  return jsonb_build_object(
    'ok', true,
    'expense_id', v_expense_id,
    'duplicate', false,
    'review_required', v_review
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_customer_deposit_safe (F6-P2A audit retrofit)
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
  v_existing_deposit uuid;
  v_existing_invoice uuid;
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
    select id, deposit_id, invoice_id
      into v_existing, v_existing_deposit, v_existing_invoice
    from public.customer_deposit_applications
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      if v_existing_deposit = p_deposit_id and v_existing_invoice = p_invoice_id then
        return jsonb_build_object(
          'ok', true,
          'application_id', v_existing,
          'duplicate', true
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different deposit application entity.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
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

  -- Canonical open AR: total − payments − credits − deposits − write-offs
  v_open := public.invoice_open_ar_balance(p_invoice_id);
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
      select id, deposit_id, invoice_id
        into v_existing, v_existing_deposit, v_existing_invoice
      from public.customer_deposit_applications
      where idempotency_key = p_idempotency_key
      limit 1;
      if v_existing is not null
         and v_existing_deposit = p_deposit_id
         and v_existing_invoice = p_invoice_id then
        return jsonb_build_object(
          'ok', true,
          'application_id', v_existing,
          'duplicate', true
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different deposit application entity.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
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

perform public.accounting_audit_from_definer_safe(
    'deposit_applied', 'deposit_application', v_app_id, v_econ, null,
    jsonb_build_object(
      'depositApplicationId', v_app_id,
      'depositId', p_deposit_id,
      'invoiceId', p_invoice_id,
      'amount', v_apply,
      'customerId', v_dep.customer_id
    ),
    v_actor, 'audit:deposit_apply:' || v_app_id::text
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

-- ---------------------------------------------------------------------------
-- void_customer_deposit_safe (F6-P2A audit retrofit)
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

perform public.accounting_audit_from_definer_safe(
    'deposit_voided', 'customer_deposit', p_deposit_id, v_econ,
    coalesce(nullif(p_void_reason, ''), 'Deposit voided'),
    jsonb_build_object(
      'depositId', p_deposit_id,
      'customerId', v_dep.customer_id,
      'amount', v_dep.amount
    ),
    v_actor, 'audit:deposit_void:' || p_deposit_id::text
  );



  return jsonb_build_object('ok', true, 'deposit_id', p_deposit_id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_bank_reconciliation_safe (F6-P2A audit retrofit)
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

perform public.accounting_audit_from_definer_safe(
    'bank_reconciliation_completed', 'bank_reconciliation_session', p_session_id,
    v_sess.statement_end, null,
    jsonb_build_object(
      'sessionId', p_session_id,
      'accountId', v_sess.account_id,
      'calculatedEndingBalance', v_calc_ending,
      'statementStart', v_sess.statement_start,
      'statementEnd', v_sess.statement_end
    ),
    v_actor, 'audit:bank_recon:' || p_session_id::text
  );

    return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'calculated_ending_balance', v_calc_ending,
    'difference', 0,
    'duplicate', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- record_invoice_payment_safe (F6-P2A audit retrofit)
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

  -- Canonical open AR: total − payments − credits − deposits − write-offs
  v_remaining := public.invoice_open_ar_balance(p_invoice_id);

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

  

perform public.accounting_audit_from_definer_safe(
    'invoice_payment_recorded', 'payment', v_pay_id, v_econ, null,
    jsonb_build_object(
      'amount', round(p_amount::numeric, 2),
      'invoiceId', p_invoice_id,
      'paymentId', v_pay_id,
      'customerId', v_inv.customer_id,
      'jobId', v_inv.job_id,
      'paymentMethod', coalesce(p_method::text, 'other')
    ),
    v_actor, 'audit:payment:' || v_pay_id::text
  );

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
-- void_invoice_payment_safe (F6-P2A audit retrofit)
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

  -- Lock invoice before economic mutation (concurrency with void_invoice_safe / AR consumers).
  perform 1 from public.invoices where id = v_pay.invoice_id for update;

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

perform public.accounting_audit_from_definer_safe(
    'payment_voided', 'payment', p_payment_id, v_econ,
    coalesce(nullif(p_void_reason, ''), 'Voided by staff'),
    jsonb_build_object(
      'amount', v_pay.amount,
      'invoiceId', v_pay.invoice_id,
      'paymentId', p_payment_id
    ),
    v_actor, 'audit:payment_void:' || p_payment_id::text
  );



  return jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_credit_to_invoice_safe (F6-P2A audit retrofit)
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
  v_existing_invoice uuid;
  v_existing_memo uuid;
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
    select id, invoice_id, credit_memo_id
      into v_existing, v_existing_invoice, v_existing_memo
    from public.credit_applications
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      if v_existing_invoice = p_invoice_id and v_existing_memo = p_credit_memo_id then
        return jsonb_build_object('ok', true, 'application_id', v_existing, 'duplicate', true);
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different credit application entity.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
      );
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

  -- Canonical open AR: total − payments − credits − deposits − write-offs
  v_remaining := public.invoice_open_ar_balance(p_invoice_id);

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
      select id, invoice_id, credit_memo_id
        into v_existing, v_existing_invoice, v_existing_memo
      from public.credit_applications
      where idempotency_key = p_idempotency_key
      limit 1;
      if v_existing is not null
         and v_existing_invoice = p_invoice_id
         and v_existing_memo = p_credit_memo_id then
        return jsonb_build_object('ok', true, 'application_id', v_existing, 'duplicate', true);
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different credit application entity.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
      );
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

perform public.accounting_audit_from_definer_safe(
    'credit_applied', 'credit_application', v_app_id, v_econ, null,
    jsonb_build_object(
      'amount', v_apply,
      'invoiceId', p_invoice_id,
      'creditMemoId', p_credit_memo_id,
      'creditApplicationId', v_app_id,
      'customerId', v_inv.customer_id
    ),
    v_actor, 'audit:credit_apply:' || v_app_id::text
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
-- record_refund_safe (F6-P2A audit retrofit)
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
  v_existing_memo uuid;
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
    select id, credit_memo_id
      into v_existing, v_existing_memo
    from public.refunds
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      if v_existing_memo = p_credit_memo_id then
        return jsonb_build_object('ok', true, 'refund_id', v_existing, 'duplicate', true);
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different credit memo refund.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
      );
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
      select id, credit_memo_id
        into v_existing, v_existing_memo
      from public.refunds
      where idempotency_key = p_idempotency_key
      limit 1;
      if v_existing is not null and v_existing_memo = p_credit_memo_id then
        return jsonb_build_object('ok', true, 'refund_id', v_existing, 'duplicate', true);
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different credit memo refund.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
      );
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

perform public.accounting_audit_from_definer_safe(
    'refund_recorded', 'refund', v_refund_id, v_econ, null,
    jsonb_build_object(
      'amount', round(p_amount::numeric, 2),
      'refundId', v_refund_id,
      'creditMemoId', p_credit_memo_id,
      'customerId', v_memo.customer_id,
      'paymentMethod', coalesce(p_method::text, 'other')
    ),
    v_actor, 'audit:refund:' || v_refund_id::text
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
-- post_journal_entry_safe (F6-P2A audit retrofit)
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
perform public.accounting_audit_from_definer_safe(
    case
      when p_entry_kind = 'opening_balance' then 'opening_balance_posted'
      when p_reversal_of_id is not null then 'journal_reversal_posted'
      else 'manual_journal_posted'
    end,
    'journal_entry', v_entry_id, p_entry_date, p_reversal_reason,
    jsonb_build_object(
      'journalEntryId', v_entry_id,
      'sourceType', p_source_type,
      'sourceId', p_source_id,
      'entryKind', p_entry_kind,
      'description', p_description,
      'debits', v_debit,
      'credits', v_credit
    ),
    v_posted_by, 'audit:journal:' || v_entry_id::text
  );

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
-- record_customer_deposit_safe (F6-P2A audit retrofit)
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
  v_existing_customer uuid;
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
    select id, customer_id
      into v_existing, v_existing_customer
    from public.customer_deposits
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      if v_existing_customer = p_customer_id then
        return jsonb_build_object(
          'ok', true,
          'deposit_id', v_existing,
          'duplicate', true
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different customer deposit.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
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
      select id, customer_id
        into v_existing, v_existing_customer
      from public.customer_deposits
      where idempotency_key = p_idempotency_key
      limit 1;
      if v_existing is not null and v_existing_customer = p_customer_id then
        return jsonb_build_object(
          'ok', true,
          'deposit_id', v_existing,
          'duplicate', true
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different customer deposit.',
        'code', 'IDEMPOTENCY_CROSS_ENTITY'
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

perform public.accounting_audit_from_definer_safe(
    'customer_deposit_recorded', 'customer_deposit', v_dep_id, v_econ, null,
    jsonb_build_object(
      'amount', round(p_amount::numeric, 2),
      'depositId', v_dep_id,
      'customerId', p_customer_id,
      'paymentMethod', coalesce(nullif(p_method, ''), 'other')
    ),
    v_actor, 'audit:deposit:' || v_dep_id::text
  );



  return jsonb_build_object(
    'ok', true,
    'deposit_id', v_dep_id,
    'duplicate', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- write_off_invoice_safe (F6-P2A open-AR integrity fix; audit preserved from 0170)
-- ---------------------------------------------------------------------------
create or replace function public.write_off_invoice_safe(
  p_invoice_id uuid,
  p_amount numeric,
  p_reason text,
  p_written_off_at date,
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
  v_inv public.invoices%rowtype;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_credited numeric := 0;
  v_written_off numeric := 0;
  v_remaining numeric := 0;
  v_existing uuid;
  v_existing_invoice uuid;
  v_wo_id uuid;
  v_bad_debt uuid;
  v_ar uuid;
  v_payload jsonb;
  v_econ date;
  v_frozen jsonb;
begin
  perform public.accounting_require_roles(
    ARRAY['admin', 'office'],
    'write off invoice balances'
  );
  v_actor := public.accounting_actor_id(p_created_by);

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Write-off amount must be greater than zero.');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Write-off reason is required.');
  end if;

  select account_id into v_bad_debt
  from public.accounting_account_mappings
  where mapping_key = 'bad_debt_expense';
  select account_id into v_ar
  from public.accounting_account_mappings
  where mapping_key = 'accounts_receivable';

  if v_bad_debt is null or v_ar is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Write-off blocked: required accounting mappings are missing (bad_debt_expense and accounts_receivable).',
      'code', 'MISSING_ACCOUNT_MAPPING'
    );
  end if;

  if p_idempotency_key is not null then
    select w.id, w.invoice_id
      into v_existing, v_existing_invoice
    from public.invoice_write_offs w
    where w.idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      if v_existing_invoice = p_invoice_id then
        return jsonb_build_object(
          'ok', true,
          'write_off_id', v_existing,
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
    return jsonb_build_object('ok', false, 'error', 'Cannot write off a void invoice.');
  end if;

  -- Post-lock idempotency recheck (TOCTOU / concurrent same-key safety).
  if p_idempotency_key is not null then
    select w.id, w.invoice_id
      into v_existing, v_existing_invoice
    from public.invoice_write_offs w
    where w.idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      if v_existing_invoice = p_invoice_id then
        return jsonb_build_object(
          'ok', true,
          'write_off_id', v_existing,
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

  -- Canonical open AR: total − payments − credits − deposits − write-offs
  v_remaining := public.invoice_open_ar_balance(p_invoice_id);

  if v_remaining <= 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Invoice has no remaining AR balance to write off.'
    );
  end if;

  if round(p_amount::numeric, 2) > v_remaining + 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        'Write-off exceeds remaining AR of $%s.',
        to_char(greatest(v_remaining, 0), 'FM999999990.00')
      ),
      'remaining', greatest(v_remaining, 0)
    );
  end if;

  v_econ := public.accounting_resolve_business_date(
    coalesce(p_written_off_at, current_date),
    'write_off'
  );

  insert into public.invoice_write_offs (
    invoice_id, amount, reason, written_off_at, created_by, idempotency_key
  ) values (
    p_invoice_id,
    round(p_amount::numeric, 2),
    trim(p_reason),
    v_econ,
    v_actor,
    nullif(p_idempotency_key, '')
  )
  returning id into v_wo_id;

  v_frozen := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_bad_debt,
      'debit', round(p_amount::numeric, 2),
      'memo', 'Bad debt write-off',
      'customerId', v_inv.customer_id,
      'jobId', v_inv.job_id,
      'invoiceId', p_invoice_id
    ),
    jsonb_build_object(
      'accountId', v_ar,
      'credit', round(p_amount::numeric, 2),
      'memo', 'Reduce AR — write-off',
      'customerId', v_inv.customer_id,
      'jobId', v_inv.job_id,
      'invoiceId', p_invoice_id
    )
  );

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'invoice_write_off',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'invoice_write_off',
    'sourceId', v_wo_id,
    'amount', round(p_amount::numeric, 2),
    'invoiceId', p_invoice_id,
    'customerId', v_inv.customer_id,
    'jobId', v_inv.job_id,
    'reason', trim(p_reason),
    'badDebtAccountId', v_bad_debt,
    'arAccountId', v_ar,
    'frozenLines', v_frozen
  );

  perform public.enqueue_accounting_outbox_safe(
    'invoice_write_off', v_wo_id, 'invoice_write_off', v_payload, false
  );

  perform set_config('app.trusted_definer_audit', 'true', true);
  perform public.log_financial_audit_safe(
    'invoice_write_off',
    'invoice',
    p_invoice_id,
    v_econ,
    trim(p_reason),
    jsonb_build_object(
      'writeOffId', v_wo_id,
      'amount', round(p_amount::numeric, 2),
      'remainingAfter', greatest(0, round((v_remaining - p_amount)::numeric, 2))
    ),
    v_actor,
    case when p_idempotency_key is not null
      then 'audit:write_off:' || p_idempotency_key
      else 'audit:write_off:' || v_wo_id::text
    end
  );
  perform set_config('app.trusted_definer_audit', 'false', true);

  return jsonb_build_object(
    'ok', true,
    'write_off_id', v_wo_id,
    'duplicate', false,
    'remaining_after', greatest(0, round((v_remaining - p_amount)::numeric, 2))
  );
exception
  when unique_violation then
    if p_idempotency_key is not null then
      select w.id, w.invoice_id
        into v_existing, v_existing_invoice
      from public.invoice_write_offs w
      where w.idempotency_key = p_idempotency_key
      limit 1;
      if v_existing is not null then
        if v_existing_invoice = p_invoice_id then
          return jsonb_build_object(
            'ok', true,
            'write_off_id', v_existing,
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
      'error', 'Duplicate write-off blocked.',
      'code', 'IDEMPOTENCY_CONFLICT'
    );
end;
$$;


-- ---------------------------------------------------------------------------
-- void_credit_application_safe (F6-P2A Option A reversal)
-- ---------------------------------------------------------------------------
create or replace function public.void_credit_application_safe(
  p_application_id uuid,
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
  v_app public.credit_applications%rowtype;
  v_memo public.credit_memos%rowtype;
  v_inv public.invoices%rowtype;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
  v_reason text;
begin
  perform public.accounting_require_roles(
    ARRAY['admin', 'office'],
    'void credit applications'
  );
  v_actor := public.accounting_actor_id(p_voided_by);
  v_reason := coalesce(nullif(trim(p_void_reason), ''), 'Voided by staff');

  select * into v_app
  from public.credit_applications
  where id = p_application_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Credit application not found.');
  end if;
  if v_app.status = 'void' then
    return jsonb_build_object(
      'ok', true,
      'application_id', p_application_id,
      'duplicate', true
    );
  end if;

  select * into v_memo
  from public.credit_memos
  where id = v_app.credit_memo_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Credit memo not found.');
  end if;

  select * into v_inv
  from public.invoices
  where id = v_app.invoice_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found.');
  end if;

  update public.credit_applications
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = v_reason
  where id = p_application_id;

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'credit_application:' || p_application_id::text || ':post'
    and status = 'posted'
  limit 1;

  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'credit_application_void',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'credit_application',
    'sourceId', p_application_id,
    'amount', v_app.amount,
    'invoiceId', v_app.invoice_id,
    'creditMemoId', v_app.credit_memo_id,
    'customerId', v_inv.customer_id,
    'originalJournalEntryId', v_orig,
    'originalIdempotencyKey', 'credit_application:' || p_application_id::text || ':post',
    'reversalNote', 'Dr AR / Cr customer credit liability'
  );

  perform public.enqueue_accounting_outbox_safe(
    'credit_application', p_application_id, 'credit_application_void',
    v_payload, v_orig is null
  );

  perform public.accounting_audit_from_definer_safe(
    'credit_application_voided',
    'credit_application',
    p_application_id,
    v_econ,
    v_reason,
    jsonb_build_object(
      'creditApplicationId', p_application_id,
      'creditMemoId', v_app.credit_memo_id,
      'invoiceId', v_app.invoice_id,
      'amount', v_app.amount,
      'customerId', v_inv.customer_id
    ),
    v_actor,
    'audit:credit_application_void:' || p_application_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'application_id', p_application_id,
    'duplicate', false,
    'open_ar_after', public.invoice_open_ar_balance(v_app.invoice_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- void_customer_deposit_application_safe (F6-P2A Option A reversal)
-- ---------------------------------------------------------------------------
create or replace function public.void_customer_deposit_application_safe(
  p_application_id uuid,
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
  v_app public.customer_deposit_applications%rowtype;
  v_dep public.customer_deposits%rowtype;
  v_inv public.invoices%rowtype;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
  v_reason text;
  v_active_applied numeric := 0;
  v_unapplied numeric := 0;
  v_last_invoice uuid;
begin
  perform public.accounting_require_roles(
    ARRAY['admin', 'office'],
    'void customer deposit applications'
  );
  v_actor := public.accounting_actor_id(p_voided_by);
  v_reason := coalesce(nullif(trim(p_void_reason), ''), 'Voided by staff');

  select * into v_app
  from public.customer_deposit_applications
  where id = p_application_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Deposit application not found.');
  end if;
  if v_app.status = 'void' then
    return jsonb_build_object(
      'ok', true,
      'application_id', p_application_id,
      'duplicate', true
    );
  end if;

  select * into v_dep
  from public.customer_deposits
  where id = v_app.deposit_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Customer deposit not found.');
  end if;

  select * into v_inv
  from public.invoices
  where id = v_app.invoice_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found.');
  end if;

  update public.customer_deposit_applications
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = v_reason
  where id = p_application_id;

  -- Recompute parent deposit status from remaining active applications.
  select coalesce(sum(amount), 0) into v_active_applied
  from public.customer_deposit_applications
  where deposit_id = v_app.deposit_id
    and status = 'active';
  v_unapplied := round((v_dep.amount - v_active_applied)::numeric, 2);

  if v_dep.status in ('applied', 'unapplied') then
    if v_active_applied > 0.005 and v_unapplied <= 0.005 then
      select invoice_id into v_last_invoice
      from public.customer_deposit_applications
      where deposit_id = v_app.deposit_id
        and status = 'active'
      order by created_at desc
      limit 1;
      update public.customer_deposits
      set status = 'applied',
          applied_invoice_id = v_last_invoice,
          applied_at = coalesce(applied_at, now()),
          updated_at = now()
      where id = v_app.deposit_id;
    else
      update public.customer_deposits
      set status = 'unapplied',
          applied_invoice_id = null,
          applied_at = null,
          updated_at = now()
      where id = v_app.deposit_id;
    end if;
  else
    update public.customer_deposits
    set updated_at = now()
    where id = v_app.deposit_id;
  end if;

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'deposit_application:' || p_application_id::text || ':post'
    and status = 'posted'
  limit 1;

  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'deposit_apply_void',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'deposit_application',
    'sourceId', p_application_id,
    'amount', v_app.amount,
    'invoiceId', v_app.invoice_id,
    'depositId', v_app.deposit_id,
    'customerId', v_dep.customer_id,
    'originalJournalEntryId', v_orig,
    'originalIdempotencyKey', 'deposit_application:' || p_application_id::text || ':post',
    'reversalNote', 'Dr AR / Cr customer deposit liability',
    'depositUnappliedAfter', greatest(0, v_unapplied)
  );

  perform public.enqueue_accounting_outbox_safe(
    'deposit_application', p_application_id, 'deposit_apply_void',
    v_payload, v_orig is null
  );

  perform public.accounting_audit_from_definer_safe(
    'deposit_application_voided',
    'deposit_application',
    p_application_id,
    v_econ,
    v_reason,
    jsonb_build_object(
      'depositApplicationId', p_application_id,
      'depositId', v_app.deposit_id,
      'invoiceId', v_app.invoice_id,
      'amount', v_app.amount,
      'customerId', v_dep.customer_id,
      'depositUnappliedAfter', greatest(0, v_unapplied)
    ),
    v_actor,
    'audit:deposit_application_void:' || p_application_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'application_id', p_application_id,
    'duplicate', false,
    'deposit_id', v_app.deposit_id,
    'deposit_unapplied_after', greatest(0, v_unapplied),
    'open_ar_after', public.invoice_open_ar_balance(v_app.invoice_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- void_invoice_write_off_safe (F6-P2A Option A reversal)
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice_write_off_safe(
  p_write_off_id uuid,
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
  v_wo public.invoice_write_offs%rowtype;
  v_inv public.invoices%rowtype;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
  v_reason text;
begin
  perform public.accounting_require_roles(
    ARRAY['admin', 'office'],
    'void invoice write-offs'
  );
  v_actor := public.accounting_actor_id(p_voided_by);
  v_reason := coalesce(nullif(trim(p_void_reason), ''), 'Voided by staff');

  select * into v_wo
  from public.invoice_write_offs
  where id = p_write_off_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Write-off not found.');
  end if;
  if v_wo.status = 'void' then
    return jsonb_build_object(
      'ok', true,
      'write_off_id', p_write_off_id,
      'duplicate', true
    );
  end if;

  select * into v_inv
  from public.invoices
  where id = v_wo.invoice_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Invoice not found.');
  end if;

  update public.invoice_write_offs
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = v_reason
  where id = p_write_off_id;

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'invoice_write_off:' || p_write_off_id::text || ':post'
    and status = 'posted'
  limit 1;

  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'invoice_write_off_void',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'invoice_write_off',
    'sourceId', p_write_off_id,
    'amount', v_wo.amount,
    'invoiceId', v_wo.invoice_id,
    'customerId', v_inv.customer_id,
    'jobId', v_inv.job_id,
    'originalJournalEntryId', v_orig,
    'originalIdempotencyKey', 'invoice_write_off:' || p_write_off_id::text || ':post',
    'reversalNote', 'Dr AR / Cr bad debt expense'
  );

  perform public.enqueue_accounting_outbox_safe(
    'invoice_write_off', p_write_off_id, 'invoice_write_off_void',
    v_payload, v_orig is null
  );

  perform public.accounting_audit_from_definer_safe(
    'invoice_write_off_voided',
    'invoice_write_off',
    p_write_off_id,
    v_econ,
    v_reason,
    jsonb_build_object(
      'writeOffId', p_write_off_id,
      'invoiceId', v_wo.invoice_id,
      'amount', v_wo.amount,
      'customerId', v_inv.customer_id
    ),
    v_actor,
    'audit:write_off_void:' || p_write_off_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'write_off_id', p_write_off_id,
    'duplicate', false,
    'open_ar_after', public.invoice_open_ar_balance(v_wo.invoice_id)
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- EXECUTE ACLs — re-assert money RPC + internal audit security
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_staff_rpc text[] := array[
    'record_invoice_payment_safe',
    'void_invoice_payment_safe',
    'apply_credit_to_invoice_safe',
    'record_refund_safe',
    'void_refund_safe',
    'issue_credit_memo_safe',
    'void_credit_memo_safe',
    'finalize_invoice_safe',
    'void_invoice_safe',
    'post_vendor_bill_safe',
    'record_bill_payment_safe',
    'void_bill_payment_safe',
    'record_direct_expense_safe',
    'record_customer_deposit_safe',
    'apply_customer_deposit_safe',
    'void_customer_deposit_safe',
    'complete_bank_reconciliation_safe',
    'write_off_invoice_safe',
    'void_invoice_write_off_safe',
    'void_customer_deposit_application_safe',
    'void_credit_application_safe',
    'confirm_backup_pitr_safe',
    'stage_bank_statement_import_safe'
  ];
  v_admin_rpc text[] := array['post_journal_entry_safe'];
  v_internal text[] := array[
    'log_financial_audit_safe',
    'accounting_audit_from_definer_safe'
  ];
  v_read_helper text[] := array[
    'invoice_applied_deposits',
    'invoice_open_ar_balance',
    'invoice_applied_write_offs',
    'invoice_applied_credits',
    'invoice_commercial_total'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_staff_rpc || v_admin_rpc || v_internal || v_read_helper)
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);

    if r.proname = any (v_staff_rpc) then
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname = any (v_admin_rpc) then
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname = any (v_read_helper) then
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname = any (v_internal) then
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end;
$$;
