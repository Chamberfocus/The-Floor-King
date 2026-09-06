-- F0 Launch Trust: payment void/idempotency + schedule material overrides.
-- Safe with existing data. No fabricated history. No payment backfill of voids.

-- ---------------------------------------------------------------------------
-- Payments: active vs void (void preserves audit history)
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists status text not null default 'active';

alter table public.payments
  add column if not exists voided_at timestamptz;

alter table public.payments
  add column if not exists voided_by uuid references auth.users (id) on delete set null;

alter table public.payments
  add column if not exists void_reason text;

alter table public.payments
  add column if not exists idempotency_key text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_status_check'
  ) then
    alter table public.payments
      add constraint payments_status_check
      check (status in ('active', 'void'));
  end if;
end $$;

-- Historical rows keep status='active' via default.
create unique index if not exists payments_idempotency_key_uidx
  on public.payments (idempotency_key)
  where idempotency_key is not null;

create index if not exists payments_invoice_active_idx
  on public.payments (invoice_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Atomic invoice payment: lock invoice, enforce remaining balance, insert.
-- Excludes void payments from paid total. Rejects overpay and non-positive.
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

  -- Blank deposit invoice (no lines, $0 total): allow when flagged.
  -- Otherwise never exceed remaining collectible balance.
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

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_pay_id,
    'duplicate', false,
    'remaining_after', greatest(0, round((v_remaining - p_amount)::numeric, 2))
  );
exception
  when unique_violation then
    -- Concurrent duplicate idempotency key
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

-- ---------------------------------------------------------------------------
-- Schedule override when materials are not ready
-- ---------------------------------------------------------------------------
create table if not exists public.job_schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  overridden_by uuid references auth.users (id) on delete set null,
  reason text not null,
  materials_ready boolean not null default false,
  warehouse_ready_at timestamptz,
  scheduled_date date,
  created_at timestamptz not null default now()
);
create index if not exists job_schedule_overrides_job_idx
  on public.job_schedule_overrides (job_id, created_at desc);

alter table public.job_schedule_overrides enable row level security;
drop policy if exists job_schedule_overrides_staff_all on public.job_schedule_overrides;
create policy job_schedule_overrides_staff_all on public.job_schedule_overrides
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());
grant select, insert, update, delete on public.job_schedule_overrides to authenticated;
