-- Post accounting outbox events into the general ledger in the same transaction
-- that records the business event, when posting is already enabled.
--
-- Does not turn posting on. Does not set books_of_record. Does not insert
-- journals, invoices, bills, or balances. External books stay official until
-- an owner enables posting and books of record.
--
-- Vendor bill activation previously queued a payload with no journal lines.
-- The ledger worker cannot post that payload. This migration freezes a
-- balanced Dr expense / Cr accounts-payable snapshot before the outbox insert.

-- ---------------------------------------------------------------------------
-- Idempotency keys must match src/lib/accounting/outbox-rebuild.ts so a later
-- TypeScript retry converges on the same journal instead of posting twice.
-- ---------------------------------------------------------------------------
create or replace function public.acct_outbox_idempotency_key(p_payload jsonb)
returns text
language sql
immutable
as $$
  select case p_payload->>'eventKind'
    when 'payment' then 'payment:' || (p_payload->>'sourceId') || ':post'
    when 'payment_void' then 'payment:' || (p_payload->>'sourceId') || ':void'
    when 'credit_application' then 'credit_application:' || (p_payload->>'sourceId') || ':post'
    when 'refund' then 'refund:' || (p_payload->>'sourceId') || ':post'
    when 'refund_void' then 'refund:' || (p_payload->>'sourceId') || ':void'
    when 'bill_payment' then 'bill_payment:' || (p_payload->>'sourceId') || ':post'
    when 'bill_payment_void' then 'bill_payment:' || (p_payload->>'sourceId') || ':void'
    when 'invoice_issue' then 'invoice:' || (p_payload->>'sourceId') || ':issue'
    when 'invoice_void' then 'invoice:' || (p_payload->>'sourceId') || ':void'
    when 'credit_memo_issue' then 'credit_memo:' || (p_payload->>'sourceId') || ':issue'
    when 'credit_void' then 'credit_memo:' || (p_payload->>'sourceId') || ':void'
    when 'vendor_bill' then 'vendor_bill:' || (p_payload->>'sourceId') || ':post'
    when 'direct_expense' then 'expense:' || (p_payload->>'sourceId') || ':post'
    when 'customer_deposit' then 'customer_deposit:' || (p_payload->>'sourceId') || ':post'
    when 'customer_deposit_void' then 'customer_deposit:' || (p_payload->>'sourceId') || ':void'
    when 'deposit_apply' then 'deposit_application:' || (p_payload->>'sourceId') || ':post'
    when 'deposit_apply_void' then 'deposit_application:' || (p_payload->>'sourceId') || ':void'
    when 'credit_application_void' then 'credit_application:' || (p_payload->>'sourceId') || ':void'
    when 'invoice_write_off' then 'invoice_write_off:' || (p_payload->>'sourceId') || ':post'
    when 'invoice_write_off_void' then 'invoice_write_off:' || (p_payload->>'sourceId') || ':void'
    else 'outbox:' || coalesce(p_payload->>'sourceType', '') || ':'
      || coalesce(p_payload->>'sourceId', '') || ':'
      || coalesce(p_payload->>'eventKind', '')
  end;
$$;

-- Rebuild the journal the TypeScript worker would post from a durable snapshot.
-- Returns lines (snake_case for post_journal_entry_safe), the original journal
-- to reverse, and skip_code when the event must wait for review instead of
-- aborting the business transaction.
create or replace function public.acct_outbox_posting_plan(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text := coalesce(p_payload->>'eventKind', '');
  v_amount numeric;
  v_lines jsonb;
  v_orig uuid;
  v_orig_key text;
  v_cash text;
  v_ar text;
  v_liab text;
  v_ap text;
begin
  if coalesce((p_payload->>'taxReviewRequired')::boolean, false) then
    return jsonb_build_object('skip_code', 'tax_review_required');
  end if;

  if p_payload ? 'frozenLines'
     and jsonb_typeof(p_payload->'frozenLines') = 'array'
     and jsonb_array_length(p_payload->'frozenLines') >= 2 then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'account_id', coalesce(nullif(el->>'account_id', ''), nullif(el->>'accountId', '')),
        'debit', round(coalesce((el->>'debit')::numeric, 0), 2),
        'credit', round(coalesce((el->>'credit')::numeric, 0), 2),
        'memo', el->>'memo',
        'customer_id', coalesce(nullif(el->>'customer_id', ''), nullif(el->>'customerId', '')),
        'vendor_id', coalesce(nullif(el->>'vendor_id', ''), nullif(el->>'vendorId', '')),
        'job_id', coalesce(nullif(el->>'job_id', ''), nullif(el->>'jobId', '')),
        'invoice_id', coalesce(nullif(el->>'invoice_id', ''), nullif(el->>'invoiceId', '')),
        'bill_id', coalesce(nullif(el->>'bill_id', ''), nullif(el->>'billId', ''))
      )
      order by ord
    ), '[]'::jsonb)
    into v_lines
    from jsonb_array_elements(p_payload->'frozenLines') with ordinality as t(el, ord);
    return jsonb_build_object(
      'lines', v_lines,
      'reversal_of_id', nullif(p_payload->>'originalJournalEntryId', '')
    );
  end if;

  if v_kind like '%\_void' escape '\' then
    v_orig := nullif(p_payload->>'originalJournalEntryId', '')::uuid;
    if v_orig is null and nullif(p_payload->>'originalIdempotencyKey', '') is not null then
      select je.id into v_orig
      from public.journal_entries je
      where je.idempotency_key = p_payload->>'originalIdempotencyKey'
        and je.status = 'posted'
      limit 1;
    end if;
    if v_orig is null then
      v_orig_key := case v_kind
        when 'payment_void' then 'payment:' || (p_payload->>'sourceId') || ':post'
        when 'refund_void' then 'refund:' || (p_payload->>'sourceId') || ':post'
        when 'bill_payment_void' then 'bill_payment:' || (p_payload->>'sourceId') || ':post'
        when 'invoice_void' then 'invoice:' || (p_payload->>'sourceId') || ':issue'
        when 'credit_void' then 'credit_memo:' || (p_payload->>'sourceId') || ':issue'
        when 'vendor_bill_void' then 'vendor_bill:' || (p_payload->>'sourceId') || ':post'
        when 'customer_deposit_void' then 'customer_deposit:' || (p_payload->>'sourceId') || ':post'
        when 'deposit_apply_void' then 'deposit_application:' || (p_payload->>'sourceId') || ':post'
        when 'credit_application_void' then 'credit_application:' || (p_payload->>'sourceId') || ':post'
        when 'invoice_write_off_void' then 'invoice_write_off:' || (p_payload->>'sourceId') || ':post'
        else null
      end;
      if v_orig_key is not null then
        select je.id into v_orig
        from public.journal_entries je
        where je.idempotency_key = v_orig_key
          and je.status = 'posted'
        limit 1;
      end if;
    end if;
    if v_orig is null then
      return jsonb_build_object('skip_code', 'original_journal_missing');
    end if;
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'account_id', jl.account_id,
        'debit', jl.credit,
        'credit', jl.debit,
        'memo', coalesce(jl.memo, 'Reversal'),
        'customer_id', jl.customer_id,
        'vendor_id', jl.vendor_id,
        'job_id', jl.job_id,
        'invoice_id', jl.invoice_id,
        'bill_id', jl.bill_id
      )
      order by jl.line_no
    ), '[]'::jsonb)
    into v_lines
    from public.journal_lines jl
    where jl.journal_entry_id = v_orig;
    if v_lines is null or jsonb_array_length(v_lines) < 2 then
      return jsonb_build_object('skip_code', 'original_journal_missing');
    end if;
    return jsonb_build_object('lines', v_lines, 'reversal_of_id', v_orig);
  end if;

  v_amount := round(coalesce((p_payload->>'amount')::numeric, 0), 2);
  v_cash := nullif(p_payload->>'cashAccountId', '');
  v_ar := nullif(p_payload->>'arAccountId', '');
  v_liab := nullif(p_payload->>'liabilityAccountId', '');
  v_ap := nullif(p_payload->>'apAccountId', '');

  if v_kind = 'payment' and v_cash is not null and v_ar is not null and v_amount > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cash, 'debit', v_amount, 'credit', 0,
        'memo', 'Payment received',
        'customer_id', p_payload->>'customerId',
        'job_id', p_payload->>'jobId',
        'invoice_id', p_payload->>'invoiceId'
      ),
      jsonb_build_object(
        'account_id', v_ar, 'debit', 0, 'credit', v_amount,
        'memo', 'Accounts receivable',
        'customer_id', p_payload->>'customerId',
        'job_id', p_payload->>'jobId',
        'invoice_id', p_payload->>'invoiceId'
      )
    );
  elsif v_kind = 'credit_application' and v_liab is not null and v_ar is not null and v_amount > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_liab, 'debit', v_amount, 'credit', 0,
        'memo', 'Apply customer credit',
        'customer_id', p_payload->>'customerId',
        'invoice_id', p_payload->>'invoiceId'
      ),
      jsonb_build_object(
        'account_id', v_ar, 'debit', 0, 'credit', v_amount,
        'memo', 'Accounts receivable',
        'customer_id', p_payload->>'customerId',
        'invoice_id', p_payload->>'invoiceId'
      )
    );
  elsif v_kind = 'refund' and v_liab is not null and v_cash is not null and v_amount > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_liab, 'debit', v_amount, 'credit', 0,
        'memo', 'Customer refund',
        'customer_id', p_payload->>'customerId'
      ),
      jsonb_build_object(
        'account_id', v_cash, 'debit', 0, 'credit', v_amount,
        'memo', 'Cash out',
        'customer_id', p_payload->>'customerId'
      )
    );
  elsif v_kind = 'bill_payment' and v_ap is not null and v_cash is not null and v_amount > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_ap, 'debit', v_amount, 'credit', 0,
        'memo', 'Pay accounts payable',
        'bill_id', coalesce(p_payload->>'billId', p_payload->>'sourceId')
      ),
      jsonb_build_object(
        'account_id', v_cash, 'debit', 0, 'credit', v_amount,
        'memo', 'Cash out',
        'bill_id', coalesce(p_payload->>'billId', p_payload->>'sourceId')
      )
    );
  end if;

  if v_lines is null then
    return jsonb_build_object('skip_code', null);
  end if;
  return jsonb_build_object('lines', v_lines);
end;
$$;

-- Freeze vendor-bill journal lines from the bill category and the chart mapping.
-- reviewRequired stays true when the debit account cannot be posted safely.
create or replace function public.acct_vendor_bill_posting_payload(
  p_bill_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bill public.bills%rowtype;
  v_amount numeric;
  v_key text;
  v_debit uuid;
  v_ap uuid;
  v_review boolean := false;
  v_inventory boolean := false;
  v_frozen jsonb;
begin
  if p_payload ? 'frozenLines'
     and jsonb_typeof(p_payload->'frozenLines') = 'array'
     and jsonb_array_length(p_payload->'frozenLines') >= 2 then
    return p_payload || jsonb_build_object('reviewRequired', false);
  end if;

  select * into v_bill from public.bills where id = p_bill_id;
  if not found then
    return p_payload || jsonb_build_object('reviewRequired', true);
  end if;

  v_amount := round(coalesce((p_payload->>'amount')::numeric, 0), 2);
  if v_amount <= 0.005 then
    select round(coalesce(sum(coalesce(quantity, 0) * coalesce(unit_cost, 0)), 0), 2)
      into v_amount
    from public.bill_items
    where bill_id = p_bill_id;
  end if;

  select coalesce(inventory_posting_enabled, false)
    into v_inventory
  from public.accounting_settings
  where id = 1;

  v_key := case v_bill.accounting_category
    when 'material_purchase' then 'material_cogs'
    when 'installer_labor' then 'installer_labor_cogs'
    when 'freight' then 'default_expense'
    when 'operating_expense' then 'default_expense'
    when 'inventory_asset' then 'inventory_asset'
    when 'other_mapped' then 'default_expense'
    else null
  end;

  if v_bill.accounting_category = 'inventory_asset' and not v_inventory then
    v_review := true;
  end if;
  if v_key is null then
    v_review := true;
  else
    select account_id into v_debit
    from public.accounting_account_mappings
    where mapping_key = v_key;
  end if;
  select account_id into v_ap
  from public.accounting_account_mappings
  where mapping_key = 'accounts_payable';

  if v_debit is null or v_ap is null or v_amount <= 0.005 then
    return p_payload || jsonb_build_object('reviewRequired', true);
  end if;

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

  return p_payload || jsonb_build_object(
    'schemaVersion', coalesce((p_payload->>'schemaVersion')::int, 1),
    'amount', v_amount,
    'billId', p_bill_id,
    'jobId', v_bill.job_id,
    'debitAccountId', v_debit,
    'apAccountId', v_ap,
    'accountingCategory', v_bill.accounting_category,
    'frozenLines', v_frozen,
    'reviewRequired', v_review,
    'rebuildStrategy', coalesce(p_payload->>'rebuildStrategy', 'immutable_outbox_snapshot')
  );
end;
$$;

create or replace function public.acct_post_outbox_item_safe(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.accounting_posting_outbox%rowtype;
  v_plan jsonb;
  v_lines jsonb;
  v_prev text;
  v_result jsonb;
  v_idem text;
  v_kind text;
  v_entry_kind text;
  v_reversal uuid;
  v_skip text;
begin
  select * into v_row
  from public.accounting_posting_outbox
  where id = p_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Outbox item not found.', 'code', 'OUTBOX_MISSING');
  end if;
  if v_row.status = 'posted' and v_row.journal_entry_id is not null then
    update public.accounting_event_status
    set status = 'posted',
        journal_entry_id = v_row.journal_entry_id,
        error_code = null,
        error_message = null,
        updated_at = now()
    where outbox_id = p_id;
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'journal_entry_id', v_row.journal_entry_id
    );
  end if;
  if v_row.status = 'review_required' or coalesce(v_row.review_required, false) then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'review_required');
  end if;

  v_plan := public.acct_outbox_posting_plan(v_row.payload);
  v_skip := nullif(v_plan->>'skip_code', '');
  v_lines := v_plan->'lines';
  if v_skip is not null or v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) < 2 then
    if v_skip is null then
      return jsonb_build_object(
        'ok', false,
        'error', 'Outbox snapshot cannot be posted. Frozen journal lines are missing.',
        'code', 'PAYLOAD_INVALID'
      );
    end if;
    update public.accounting_posting_outbox
    set status = 'review_required',
        review_required = true,
        last_error = v_skip,
        updated_at = now()
    where id = p_id;
    update public.accounting_event_status
    set status = 'review_required',
        error_code = v_skip,
        error_message = v_skip,
        updated_at = now()
    where outbox_id = p_id;
    return jsonb_build_object('ok', true, 'skipped', true, 'code', v_skip);
  end if;

  v_kind := coalesce(v_row.payload->>'eventKind', v_row.event_kind);
  v_entry_kind := case when v_kind like '%\_void' escape '\' then 'reversal' else 'post' end;
  v_idem := public.acct_outbox_idempotency_key(v_row.payload);
  v_reversal := nullif(v_plan->>'reversal_of_id', '')::uuid;
  v_prev := current_setting('request.jwt.claims', true);

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    v_result := public.post_journal_entry_safe(
      (v_row.payload->>'economicEventDate')::date,
      coalesce(v_row.payload->>'description', v_kind || ' ' || coalesce(v_row.payload->>'sourceId', '')),
      coalesce(v_row.payload->>'sourceType', v_row.source_type),
      coalesce(nullif(v_row.payload->>'sourceId', '')::uuid, v_row.source_id),
      v_entry_kind,
      v_idem,
      v_lines,
      nullif(v_row.payload->>'actorId', '')::uuid,
      case when v_entry_kind = 'reversal' then v_reversal else null end,
      case when v_entry_kind = 'reversal' then 'Operational void' else null end
    );
    perform set_config('request.jwt.claims', coalesce(v_prev, ''), true);
  exception
    when others then
      perform set_config('request.jwt.claims', coalesce(v_prev, ''), true);
      raise;
  end;

  if coalesce((v_result->>'ok')::boolean, false) is not true then
    return v_result;
  end if;

  update public.accounting_posting_outbox
  set status = 'posted',
      journal_entry_id = (v_result->>'journal_entry_id')::uuid,
      processed_at = now(),
      last_error = null,
      updated_at = now()
  where id = p_id;

  update public.accounting_event_status
  set status = 'posted',
      journal_entry_id = (v_result->>'journal_entry_id')::uuid,
      error_code = null,
      error_message = null,
      updated_at = now()
  where outbox_id = p_id;

  return v_result || jsonb_build_object('outbox_id', p_id);
end;
$$;

-- Vendor bill events pick up frozen lines before enqueue. Other kinds are unchanged.
create or replace function public.installer_labor_record_vendor_event(
  p_ap_bill_id uuid,
  p_event_kind text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outbox uuid;
  v_payload jsonb;
  v_review boolean := false;
begin
  if p_ap_bill_id is null then
    return;
  end if;
  v_payload := p_payload;
  if p_event_kind = 'vendor_bill' then
    v_payload := public.acct_vendor_bill_posting_payload(p_ap_bill_id, p_payload);
    v_review := coalesce((v_payload->>'reviewRequired')::boolean, false);
    v_payload := v_payload - 'reviewRequired';
  end if;
  v_outbox := public.enqueue_accounting_outbox_safe(
    'vendor_bill', p_ap_bill_id, p_event_kind, v_payload, v_review
  );
  if v_outbox is not null then
    return;
  end if;

  insert into public.accounting_event_status (
    source_type, source_id, event_kind, status, error_code, error_message
  ) values (
    'vendor_bill', p_ap_bill_id, p_event_kind, 'disabled',
    'posting_disabled', 'Automatic accounting posting is disabled.'
  )
  on conflict (source_type, source_id, event_kind) do update
    set status = case
          when accounting_event_status.status in ('pending', 'review_required', 'posted')
            then accounting_event_status.status
          else excluded.status
        end,
        error_code = case
          when accounting_event_status.status in ('pending', 'review_required', 'posted')
            then accounting_event_status.error_code
          else excluded.error_code
        end,
        error_message = case
          when accounting_event_status.status in ('pending', 'review_required', 'posted')
            then accounting_event_status.error_message
          else excluded.error_message
        end,
        updated_at = now();
end;
$$;

-- Same enqueue contract as 0177, plus a same-transaction journal post when the
-- event is not waiting for review. Posting still no-ops while posting_enabled
-- or the event flag is false (early return null, no journal).
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
  v_period_gate jsonb;
  v_posted jsonb;
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
  elsif p_event_kind in ('vendor_bill', 'vendor_bill_void', 'bill_payment', 'bill_payment_void') then
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
  elsif p_event_kind in ('installer_bill', 'installer_bill_void') then
    v_event_ok := coalesce(v_settings.installer_posting_enabled, false);
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

  v_period_gate := public.acct_lock_period_for_posting(v_econ);
  if coalesce((v_period_gate->>'ok')::boolean, false) is not true then
    raise exception '%: %',
      coalesce(v_period_gate->>'code', 'ACCT_PERIOD_NOT_OPEN'),
      coalesce(v_period_gate->>'error', 'Accounting period not open for outbox enqueue.');
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

  if v_id is not null and not coalesce(p_review_required, false) then
    v_posted := public.acct_post_outbox_item_safe(v_id);
    if coalesce((v_posted->>'ok')::boolean, false) is not true then
      raise exception 'ACCOUNTING_POST_FAILED: %',
        coalesce(v_posted->>'error', v_posted->>'code', 'journal post failed');
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.acct_outbox_idempotency_key(jsonb) from public;
revoke all on function public.acct_outbox_idempotency_key(jsonb) from anon;
revoke all on function public.acct_outbox_idempotency_key(jsonb) from authenticated;
grant execute on function public.acct_outbox_idempotency_key(jsonb) to service_role;

revoke all on function public.acct_outbox_posting_plan(jsonb) from public;
revoke all on function public.acct_outbox_posting_plan(jsonb) from anon;
revoke all on function public.acct_outbox_posting_plan(jsonb) from authenticated;
grant execute on function public.acct_outbox_posting_plan(jsonb) to service_role;

revoke all on function public.acct_vendor_bill_posting_payload(uuid, jsonb) from public;
revoke all on function public.acct_vendor_bill_posting_payload(uuid, jsonb) from anon;
revoke all on function public.acct_vendor_bill_posting_payload(uuid, jsonb) from authenticated;
grant execute on function public.acct_vendor_bill_posting_payload(uuid, jsonb) to service_role;

revoke all on function public.acct_post_outbox_item_safe(uuid) from public;
revoke all on function public.acct_post_outbox_item_safe(uuid) from anon;
revoke all on function public.acct_post_outbox_item_safe(uuid) from authenticated;
grant execute on function public.acct_post_outbox_item_safe(uuid) to service_role;

revoke all on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) from public;
revoke all on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) from anon;
revoke all on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) from authenticated;
grant execute on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) to service_role;

comment on function public.acct_post_outbox_item_safe(uuid) is
  'Post one pending outbox row into the general ledger. Does not enable posting.';
