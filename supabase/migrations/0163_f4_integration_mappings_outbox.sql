-- F4 Accounting Integration (1/2): mappings, deposits, outbox hardening, bill categories.
-- Non-destructive. posting_enabled stays false. No historical backfill. No books_of_record.

-- ---------------------------------------------------------------------------
-- Per-event posting pilot flags (all default OFF; master posting_enabled still required)
-- ---------------------------------------------------------------------------
alter table public.accounting_settings
  add column if not exists invoice_posting_enabled boolean not null default false,
  add column if not exists payment_posting_enabled boolean not null default false,
  add column if not exists credit_posting_enabled boolean not null default false,
  add column if not exists ap_posting_enabled boolean not null default false,
  add column if not exists expense_posting_enabled boolean not null default false,
  add column if not exists deposit_posting_enabled boolean not null default false,
  add column if not exists installer_posting_enabled boolean not null default false,
  add column if not exists opening_balances_entered boolean not null default false,
  add column if not exists accountant_validated boolean not null default false;

-- ---------------------------------------------------------------------------
-- Payment method → GL cash/clearing account
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_payment_method_mappings (
  payment_method text primary key
    check (payment_method in (
      'card', 'cash', 'check', 'echeck', 'financing', 'link', 'other'
    )),
  account_id uuid not null references public.gl_accounts (id) on delete restrict,
  updated_at timestamptz not null default now()
);

-- Sensible defaults: card/link/financing → undeposited; cash/check/echeck → checking
insert into public.accounting_payment_method_mappings (payment_method, account_id)
select v.method, a.id
from (values
  ('card', '1050'),
  ('link', '1050'),
  ('financing', '1050'),
  ('other', '1050'),
  ('cash', '1000'),
  ('check', '1000'),
  ('echeck', '1000')
) as v(method, code)
join public.gl_accounts a on a.code = v.code
on conflict (payment_method) do nothing;

-- ---------------------------------------------------------------------------
-- Explicit customer deposit records (pre-invoice liability path)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_deposits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  job_id uuid references public.jobs (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  received_on date not null default (timezone('utc', now()))::date,
  method text,
  classification text not null default 'pre_invoice_deposit'
    check (classification in (
      'ar_payment',
      'pre_invoice_deposit',
      'legacy_ambiguous'
    )),
  status text not null default 'unapplied'
    check (status in ('unapplied', 'applied', 'refunded', 'void')),
  applied_invoice_id uuid references public.invoices (id) on delete set null,
  applied_at timestamptz,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idempotency_key text
);

create unique index if not exists customer_deposits_idempotency_uidx
  on public.customer_deposits (idempotency_key)
  where idempotency_key is not null;

create index if not exists customer_deposits_customer_idx
  on public.customer_deposits (customer_id, status);

-- ---------------------------------------------------------------------------
-- Vendor bill accounting category (required before AP posting)
-- ---------------------------------------------------------------------------
alter table public.bills
  add column if not exists accounting_category text
    check (accounting_category is null or accounting_category in (
      'material_purchase',
      'installer_labor',
      'freight',
      'operating_expense',
      'inventory_asset',
      'other_mapped',
      'review_required'
    ));

-- ---------------------------------------------------------------------------
-- Expense account mapping by ops category (unknown → review)
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_expense_category_mappings (
  expense_category text primary key,
  account_id uuid references public.gl_accounts (id) on delete restrict,
  requires_review boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.accounting_expense_category_mappings (expense_category, account_id, requires_review)
select v.cat, a.id, v.review
from (values
  ('materials', '5000', false),
  ('labor', '5100', false),
  ('subcontractor', '5100', false),
  ('vehicle', '6500', false),
  ('fuel', '6500', false),
  ('rent', '6200', false),
  ('utilities', '6300', false),
  ('insurance', '6400', false),
  ('marketing', '6100', false),
  ('tools', '6000', false),
  ('payroll', '5100', false),
  ('office', '6600', false),
  ('other', null, true)
) as v(cat, code, review)
left join public.gl_accounts a on a.code = v.code
on conflict (expense_category) do nothing;

-- ---------------------------------------------------------------------------
-- Harden outbox for production retry
-- ---------------------------------------------------------------------------
alter table public.accounting_posting_outbox
  add column if not exists event_kind text not null default 'post',
  add column if not exists next_attempt_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists max_attempts int not null default 8,
  add column if not exists review_required boolean not null default false;

-- Expand status set safely
alter table public.accounting_posting_outbox
  drop constraint if exists accounting_posting_outbox_status_check;

alter table public.accounting_posting_outbox
  add constraint accounting_posting_outbox_status_check
  check (status in (
    'pending',
    'processing',
    'posted',
    'failed',
    'error',
    'skipped',
    'cancelled',
    'review_required'
  ));

create index if not exists accounting_posting_outbox_retry_idx
  on public.accounting_posting_outbox (status, next_attempt_at)
  where status in ('pending', 'failed', 'error');

-- ---------------------------------------------------------------------------
-- Accounting event status log (source visibility; no hard delete)
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_event_status (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  event_kind text not null,
  status text not null
    check (status in (
      'not_applicable',
      'disabled',
      'pending',
      'posted',
      'failed',
      'reversed',
      'legacy_pre_cutover',
      'review_required',
      'skipped'
    )),
  journal_entry_id uuid references public.journal_entries (id) on delete set null,
  outbox_id uuid references public.accounting_posting_outbox (id) on delete set null,
  error_code text,
  error_message text,
  flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounting_event_status_source_unique unique (source_type, source_id, event_kind)
);

create index if not exists accounting_event_status_status_idx
  on public.accounting_event_status (status, updated_at desc);

alter table public.customer_deposits enable row level security;
alter table public.accounting_payment_method_mappings enable row level security;
alter table public.accounting_expense_category_mappings enable row level security;
alter table public.accounting_event_status enable row level security;

drop policy if exists customer_deposits_staff on public.customer_deposits;
create policy customer_deposits_staff on public.customer_deposits
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists pay_method_map_staff_select on public.accounting_payment_method_mappings;
create policy pay_method_map_staff_select on public.accounting_payment_method_mappings
  for select to authenticated using (public.is_staff());

drop policy if exists pay_method_map_admin_write on public.accounting_payment_method_mappings;
create policy pay_method_map_admin_write on public.accounting_payment_method_mappings
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists expense_cat_map_staff_select on public.accounting_expense_category_mappings;
create policy expense_cat_map_staff_select on public.accounting_expense_category_mappings
  for select to authenticated using (public.is_staff());

drop policy if exists expense_cat_map_admin_write on public.accounting_expense_category_mappings;
create policy expense_cat_map_admin_write on public.accounting_expense_category_mappings
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Event status: staff SELECT + write (routine visibility / skip recording).
-- CoA/mapping configuration remains admin-only above.
-- Ops SECURITY DEFINER RPCs also write status (bypass RLS as owner).
drop policy if exists accounting_event_status_staff on public.accounting_event_status;
drop policy if exists accounting_event_status_select on public.accounting_event_status;
drop policy if exists accounting_event_status_admin_write on public.accounting_event_status;
create policy accounting_event_status_staff_select on public.accounting_event_status
  for select to authenticated
  using (public.is_staff());
create policy accounting_event_status_staff_write on public.accounting_event_status
  for insert to authenticated
  with check (public.is_staff());
create policy accounting_event_status_staff_update on public.accounting_event_status
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Deposits: office/admin operational table (not CoA config).
grant select, insert, update on public.customer_deposits to authenticated;
-- Mappings: SELECT for staff; mutation restricted by admin RLS (no DELETE).
grant select on public.accounting_payment_method_mappings to authenticated;
grant insert, update on public.accounting_payment_method_mappings to authenticated;
grant select on public.accounting_expense_category_mappings to authenticated;
grant insert, update on public.accounting_expense_category_mappings to authenticated;
grant select on public.accounting_event_status to authenticated;
grant insert, update on public.accounting_event_status to authenticated;
-- No DELETE grants.

-- ---------------------------------------------------------------------------
-- F4 reliability: durable outbox enqueue + claim (same-TX with ops RPCs)
--
-- SECURITY:
--   enqueue_accounting_outbox_safe — INTERNAL ONLY.
--     NOT granted to authenticated. Called only from trusted SECURITY DEFINER
--     operational RPCs (payment / void / credit apply / refund) that share the
--     same function owner, so nested EXECUTE succeeds without client grants.
--   claim_accounting_outbox_item — admin/office (is_staff) role check INSIDE
--     the function; granted to authenticated + service_role for admin retry
--     and future cron. Sales/crew/customer cannot claim.
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
-- service_role may call for maintenance; ordinary clients must not.
grant execute on function public.enqueue_accounting_outbox_safe to service_role;

-- Safe claim: one worker wins. Stale processing (>15m) reclaimable.
-- Role check INSIDE: admin or office only (is_staff). Not sales/crew/customer.
create or replace function public.claim_accounting_outbox_item(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.accounting_posting_outbox%rowtype;
begin
  -- service_role has no auth.uid(); allow for future cron. Authenticated must be staff.
  if auth.uid() is not null and not public.is_staff() then
    return jsonb_build_object(
      'ok', false,
      'error', 'Only admin/office may claim accounting outbox items.'
    );
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

revoke all on function public.claim_accounting_outbox_item from public;
revoke all on function public.claim_accounting_outbox_item from authenticated;
grant execute on function public.claim_accounting_outbox_item to authenticated;
grant execute on function public.claim_accounting_outbox_item to service_role;

-- ---------------------------------------------------------------------------
-- Extend payment RPC: same-TX outbox with immutable snapshot when enabled
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
  v_inv public.invoices%rowtype;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_remaining numeric := 0;
  v_existing uuid;
  v_pay_id uuid;
  v_item_count int := 0;
  v_cash uuid;
  v_ar uuid;
  v_payload jsonb;
  v_econ date;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Payment amount must be greater than zero.');
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.payments
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object(
        'ok', true,
        'payment_id', v_existing,
        'duplicate', true
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

  select coalesce(sum(coalesce(quantity, 0) * coalesce(rate, 0)), 0), count(*)
    into v_subtotal, v_item_count
  from public.invoice_items
  where invoice_id = p_invoice_id;

  v_total := v_subtotal + (v_subtotal * (coalesce(v_inv.tax_rate, 0) / 100.0));

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where invoice_id = p_invoice_id
    and status = 'active';

  v_remaining := round((v_total - v_paid)::numeric, 2);

  if not (
    p_allow_deposit_on_zero_total
    and v_item_count = 0
    and v_total <= 0.005
  ) then
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
    p_created_by,
    'active',
    nullif(p_idempotency_key, '')
  )
  returning id into v_pay_id;

  -- Durable accounting outbox (same TX) when posting pilots enabled.
  -- Economic date = payment paid_at (same value stored on payments.paid_at).
  -- coalesce matches the insert above — never invent a different accounting date.
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
    select id into v_existing
    from public.payments
    where idempotency_key = p_idempotency_key
    limit 1;
    return jsonb_build_object(
      'ok', true,
      'payment_id', v_existing,
      'duplicate', true
    );
end;
$$;

revoke all on function public.record_invoice_payment_safe from public;
grant execute on function public.record_invoice_payment_safe to authenticated;

-- Void payment + same-TX outbox (immutable reversal basis)
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
  v_pay public.payments%rowtype;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
begin
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
      voided_by = p_voided_by,
      void_reason = coalesce(nullif(p_void_reason, ''), 'Voided by staff')
  where id = p_payment_id;

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'payment:' || p_payment_id::text || ':post'
    and status = 'posted'
  limit 1;

  -- Economic date for VOID = authorization/reversal date (UTC today at void),
  -- NOT the original payment paid_at. Reversal posts into the period when the
  -- void was authorized; original payment journal remains historical.
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

revoke all on function public.void_invoice_payment_safe from public;
grant execute on function public.void_invoice_payment_safe to authenticated;

-- Credit application: same-TX outbox
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
  v_memo public.credit_memos%rowtype;
  v_inv public.invoices%rowtype;
  v_subtotal numeric := 0;
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

  select coalesce(sum(coalesce(quantity, 0) * coalesce(rate, 0)), 0)
    into v_subtotal
  from public.invoice_items
  where invoice_id = p_invoice_id;
  v_total := v_subtotal + (v_subtotal * (coalesce(v_inv.tax_rate, 0) / 100.0));

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
      p_credit_memo_id, p_invoice_id, v_apply, 'active', p_created_by, p_idempotency_key
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
  -- Economic date = credit APPLICATION authorization date (UTC day the apply
  -- RPC commits). This is the economic event of reducing AR / consuming liability,
  -- not the original credit-memo issue date and not a silent "missing date → today".
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
    'applied', v_apply,
    'duplicate', false,
    'available_after', round((v_available - v_apply)::numeric, 2)
  );
end;
$$;

revoke all on function public.apply_credit_to_invoice_safe from public;
grant execute on function public.apply_credit_to_invoice_safe to authenticated;

-- Refund: same-TX outbox
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
  v_memo public.credit_memos%rowtype;
  v_available numeric := 0;
  v_existing uuid;
  v_refund_id uuid;
  v_liab uuid;
  v_cash uuid;
  v_payload jsonb;
  v_econ date;
begin
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
      'active', p_created_by, p_idempotency_key
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
  -- Economic date = refunded_at (same value stored on refunds.refunded_at).
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

revoke all on function public.record_refund_safe from public;
grant execute on function public.record_refund_safe to authenticated;
