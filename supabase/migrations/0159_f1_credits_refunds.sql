-- F1 Credits, Refunds & Effective AR
-- Safe with existing data. No destructive backfill. Does not weaken F0 payment safety.

-- ---------------------------------------------------------------------------
-- Credit memos (AR reduction — NOT a refund)
-- ---------------------------------------------------------------------------
create table if not exists public.credit_memos (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  estimate_id uuid references public.estimates (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  approval_snapshot_id uuid references public.estimate_approval_snapshots (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  reason text not null default '',
  notes text,
  kind text not null default 'manual'
    check (kind in ('commercial', 'manual')),
  status text not null default 'issued'
    check (status in ('issued', 'void')),
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  idempotency_key text
);

create unique index if not exists credit_memos_idempotency_key_uidx
  on public.credit_memos (idempotency_key)
  where idempotency_key is not null;

create index if not exists credit_memos_customer_idx
  on public.credit_memos (customer_id, created_at desc);

create index if not exists credit_memos_estimate_idx
  on public.credit_memos (estimate_id)
  where estimate_id is not null and status = 'issued';

create index if not exists credit_memos_job_idx
  on public.credit_memos (job_id)
  where job_id is not null and status = 'issued';

-- ---------------------------------------------------------------------------
-- Credit applications (which invoice a credit reduces)
-- ---------------------------------------------------------------------------
create table if not exists public.credit_applications (
  id uuid primary key default gen_random_uuid(),
  credit_memo_id uuid not null references public.credit_memos (id) on delete restrict,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'active'
    check (status in ('active', 'void')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  idempotency_key text
);

create unique index if not exists credit_applications_idempotency_key_uidx
  on public.credit_applications (idempotency_key)
  where idempotency_key is not null;

create index if not exists credit_applications_invoice_active_idx
  on public.credit_applications (invoice_id)
  where status = 'active';

create index if not exists credit_applications_memo_active_idx
  on public.credit_applications (credit_memo_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Refunds (cash returned — consumes available credit, not a negative payment)
-- ---------------------------------------------------------------------------
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  credit_memo_id uuid not null references public.credit_memos (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  method public.payment_method not null default 'other',
  reference text,
  refunded_at date,
  notes text,
  status text not null default 'active'
    check (status in ('active', 'void')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  idempotency_key text
);

create unique index if not exists refunds_idempotency_key_uidx
  on public.refunds (idempotency_key)
  where idempotency_key is not null;

create index if not exists refunds_customer_idx
  on public.refunds (customer_id, created_at desc);

create index if not exists refunds_memo_active_idx
  on public.refunds (credit_memo_id)
  where status = 'active';

alter table public.credit_memos enable row level security;
alter table public.credit_applications enable row level security;
alter table public.refunds enable row level security;

drop policy if exists credit_memos_staff_all on public.credit_memos;
create policy credit_memos_staff_all on public.credit_memos
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists credit_applications_staff_all on public.credit_applications;
create policy credit_applications_staff_all on public.credit_applications
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists refunds_staff_all on public.refunds;
create policy refunds_staff_all on public.refunds
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select, insert, update on public.credit_memos to authenticated;
grant select, insert, update on public.credit_applications to authenticated;
grant select, insert, update on public.refunds to authenticated;
-- No DELETE grant for normal workflow (void instead).

-- ---------------------------------------------------------------------------
-- Helpers: remaining invoice collectible (payments + applied credits)
-- ---------------------------------------------------------------------------
create or replace function public.invoice_applied_credits(p_invoice_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric
  from public.credit_applications
  where invoice_id = p_invoice_id
    and status = 'active';
$$;

create or replace function public.credit_memo_available(p_memo_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select greatest(
    0,
    (
      select coalesce(amount, 0) from public.credit_memos where id = p_memo_id and status = 'issued'
    )
    - coalesce((
        select sum(amount) from public.credit_applications
        where credit_memo_id = p_memo_id and status = 'active'
      ), 0)
    - coalesce((
        select sum(amount) from public.refunds
        where credit_memo_id = p_memo_id and status = 'active'
      ), 0)
  )::numeric;
$$;

-- ---------------------------------------------------------------------------
-- Update F0 payment RPC: remaining = total - active payments - applied credits
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
  v_credited numeric := 0;
  v_remaining numeric := 0;
  v_existing uuid;
  v_pay_id uuid;
  v_item_count int := 0;
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

  v_credited := public.invoice_applied_credits(p_invoice_id);
  v_remaining := round((v_total - v_paid - v_credited)::numeric, 2);

  if not (
    p_allow_deposit_on_zero_total
    and v_item_count = 0
    and v_total <= 0.005
  ) then
    if p_amount > v_remaining + 0.005 then
      return jsonb_build_object(
        'ok', false,
        'error',
        format(
          'Payment exceeds the remaining balance on this invoice. Remaining: $%s.',
          to_char(greatest(v_remaining, 0), 'FM999999990.00')
        ),
        'remaining', v_remaining
      );
    end if;
  end if;

  begin
    insert into public.payments (
      invoice_id, amount, method, reference, paid_at, notes, created_by,
      status, idempotency_key
    ) values (
      p_invoice_id, p_amount, p_method, nullif(p_reference, ''), p_paid_at,
      nullif(p_notes, ''), p_created_by, 'active', p_idempotency_key
    )
    returning id into v_pay_id;
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

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_pay_id,
    'duplicate', false,
    'remaining_after', round((v_remaining - p_amount)::numeric, 2)
  );
end;
$$;

revoke all on function public.record_invoice_payment_safe from public;
grant execute on function public.record_invoice_payment_safe to authenticated;

-- ---------------------------------------------------------------------------
-- Apply available credit to an invoice (locks memo + invoice)
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

  -- Same-job preference: if memo has job_id, invoice must match (or invoice has no job).
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

-- ---------------------------------------------------------------------------
-- Issue refund against available credit on a memo
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
  v_memo public.credit_memos%rowtype;
  v_available numeric := 0;
  v_existing uuid;
  v_refund_id uuid;
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

grant execute on function public.invoice_applied_credits to authenticated;
grant execute on function public.credit_memo_available to authenticated;
