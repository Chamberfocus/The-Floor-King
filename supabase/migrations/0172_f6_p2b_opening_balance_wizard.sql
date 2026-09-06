-- F6-P2B: Opening balance wizard (batch + AR/AP subledger + finalize/void).
-- Non-destructive. Does NOT enable posting, books_of_record, cutover, or PITR.
-- Applied AFTER 0171. DO NOT auto-apply.
-- OWNER POLICY: NEVER silently plug imbalances into opening_balance_equity.
-- Debits must equal credits from entered lines + AR/AP subledgers only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.opening_balance_batches (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'validated', 'posted', 'void')),
  description text not null default 'Opening balances',
  journal_entry_id uuid references public.journal_entries (id) on delete restrict,
  reversal_of_batch_id uuid references public.opening_balance_batches (id) on delete set null,
  reversed_by_batch_id uuid references public.opening_balance_batches (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  validated_at timestamptz,
  validated_by uuid references auth.users (id) on delete set null,
  posted_at timestamptz,
  posted_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  idempotency_key text
);

create unique index if not exists opening_balance_batches_idempotency_uidx
  on public.opening_balance_batches (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists opening_balance_batches_one_posted_uidx
  on public.opening_balance_batches (status)
  where status = 'posted';

create index if not exists opening_balance_batches_status_idx
  on public.opening_balance_batches (status, as_of_date desc);

create table if not exists public.opening_balance_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.opening_balance_batches (id) on delete cascade,
  account_id uuid not null references public.gl_accounts (id) on delete restrict,
  -- Signed amount: positive = debit, negative = credit.
  signed_amount numeric(12, 2) not null,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint opening_balance_lines_nonzero_chk check (signed_amount <> 0)
);

create index if not exists opening_balance_lines_batch_idx
  on public.opening_balance_lines (batch_id, sort_order);

create unique index if not exists opening_balance_lines_batch_account_uidx
  on public.opening_balance_lines (batch_id, account_id);

create table if not exists public.opening_ar_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.opening_balance_batches (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  due_date date,
  as_of_date date,
  legacy_invoice_number text,
  reference text,
  job_id uuid references public.jobs (id) on delete set null,
  note text,
  status text not null default 'active' check (status in ('active', 'void')),
  created_at timestamptz not null default now()
);

create index if not exists opening_ar_items_batch_idx
  on public.opening_ar_items (batch_id) where status = 'active';
create index if not exists opening_ar_items_customer_idx
  on public.opening_ar_items (customer_id) where status = 'active';

create table if not exists public.opening_ap_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.opening_balance_batches (id) on delete cascade,
  vendor_id uuid not null references public.suppliers (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  bill_date date,
  due_date date,
  as_of_date date,
  legacy_bill_number text,
  reference text,
  note text,
  status text not null default 'active' check (status in ('active', 'void')),
  created_at timestamptz not null default now()
);

create index if not exists opening_ap_items_batch_idx
  on public.opening_ap_items (batch_id) where status = 'active';
create index if not exists opening_ap_items_vendor_idx
  on public.opening_ap_items (vendor_id) where status = 'active';

alter table public.opening_balance_batches enable row level security;
alter table public.opening_balance_lines enable row level security;
alter table public.opening_ar_items enable row level security;
alter table public.opening_ap_items enable row level security;

drop policy if exists opening_balance_batches_staff_select on public.opening_balance_batches;
create policy opening_balance_batches_staff_select on public.opening_balance_batches
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

drop policy if exists opening_balance_lines_staff_select on public.opening_balance_lines;
create policy opening_balance_lines_staff_select on public.opening_balance_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

drop policy if exists opening_ar_items_staff_select on public.opening_ar_items;
create policy opening_ar_items_staff_select on public.opening_ar_items
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

drop policy if exists opening_ap_items_staff_select on public.opening_ap_items;
create policy opening_ap_items_staff_select on public.opening_ap_items
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

revoke all on public.opening_balance_batches from public;
revoke all on public.opening_balance_lines from public;
revoke all on public.opening_ar_items from public;
revoke all on public.opening_ap_items from public;
revoke insert, update, delete on public.opening_balance_batches from authenticated;
revoke insert, update, delete on public.opening_balance_lines from authenticated;
revoke insert, update, delete on public.opening_ar_items from authenticated;
revoke insert, update, delete on public.opening_ap_items from authenticated;
grant select on public.opening_balance_batches to authenticated;
grant select on public.opening_balance_lines to authenticated;
grant select on public.opening_ar_items to authenticated;
grant select on public.opening_ap_items to authenticated;
grant select, insert, update, delete on public.opening_balance_batches to service_role;
grant select, insert, update, delete on public.opening_balance_lines to service_role;
grant select, insert, update, delete on public.opening_ar_items to service_role;
grant select, insert, update, delete on public.opening_ap_items to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.opening_balance_account_allowed(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gl_accounts a
    where a.id = p_account_id
      and a.is_active
      and a.account_type in ('asset', 'liability', 'equity')
      -- AR/AP control accounts must come from opening subledgers, not manual lines.
      and coalesce(a.subtype, '') not in ('receivable', 'payable')
  );
$$;

revoke all on function public.opening_balance_account_allowed(uuid) from public;
revoke all on function public.opening_balance_account_allowed(uuid) from anon;
grant execute on function public.opening_balance_account_allowed(uuid) to authenticated;
grant execute on function public.opening_balance_account_allowed(uuid) to service_role;

-- Server-side package rebuild (no equity auto-plug). Shared by validate + finalize.
create or replace function public.opening_balance_compute_package(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_batch public.opening_balance_batches%rowtype;
  v_ar_acct uuid;
  v_ap_acct uuid;
  v_ar_total numeric := 0;
  v_ap_total numeric := 0;
  v_debits numeric := 0;
  v_credits numeric := 0;
  v_diff numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  r record;
  v_item record;
  v_as_of date;
begin
  select * into v_batch from public.opening_balance_batches where id = p_batch_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Opening balance batch not found.');
  end if;

  select account_id into v_ar_acct from public.accounting_account_mappings where mapping_key = 'accounts_receivable';
  select account_id into v_ap_acct from public.accounting_account_mappings where mapping_key = 'accounts_payable';

  for r in
    select l.account_id, l.signed_amount, l.note, a.is_active, a.account_type, a.subtype, a.code
    from public.opening_balance_lines l
    join public.gl_accounts a on a.id = l.account_id
    where l.batch_id = p_batch_id
    order by l.sort_order, a.code
  loop
    if not r.is_active or r.account_type not in ('asset', 'liability', 'equity') then
      return jsonb_build_object('ok', false, 'error', format('Invalid opening account %s.', r.code));
    end if;
    if coalesce(r.subtype, '') in ('receivable', 'payable')
       or (v_ar_acct is not null and r.account_id = v_ar_acct)
       or (v_ap_acct is not null and r.account_id = v_ap_acct) then
      return jsonb_build_object(
        'ok', false,
        'error', 'AR/AP control amounts must come from opening subledger items, not manual lines.'
      );
    end if;
    if r.signed_amount > 0 then
      v_debits := v_debits + r.signed_amount;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', r.account_id,
        'debit', round(r.signed_amount::numeric, 2),
        'credit', 0,
        'memo', coalesce(r.note, 'Opening balance')
      ));
    else
      v_credits := v_credits + abs(r.signed_amount);
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', r.account_id,
        'debit', 0,
        'credit', round(abs(r.signed_amount)::numeric, 2),
        'memo', coalesce(r.note, 'Opening balance')
      ));
    end if;
  end loop;

  for v_item in
    select *
    from public.opening_ar_items
    where batch_id = p_batch_id and status = 'active'
  loop
    if not exists (select 1 from public.customers c where c.id = v_item.customer_id) then
      return jsonb_build_object('ok', false, 'error', 'Opening AR item references a missing customer.');
    end if;
    if coalesce(v_item.amount, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Opening AR amounts must be greater than zero.');
    end if;
    v_as_of := coalesce(v_item.as_of_date, v_batch.as_of_date);
    if v_as_of > v_batch.as_of_date then
      return jsonb_build_object(
        'ok', false,
        'error', 'Opening AR as-of date cannot be after the batch opening-balance date.'
      );
    end if;
    if v_item.job_id is not null
       and not exists (select 1 from public.jobs j where j.id = v_item.job_id) then
      return jsonb_build_object('ok', false, 'error', 'Opening AR item references a missing job.');
    end if;
    v_ar_total := v_ar_total + v_item.amount;
  end loop;

  for v_item in
    select *
    from public.opening_ap_items
    where batch_id = p_batch_id and status = 'active'
  loop
    if not exists (select 1 from public.suppliers s where s.id = v_item.vendor_id) then
      return jsonb_build_object('ok', false, 'error', 'Opening AP item references a missing vendor.');
    end if;
    if coalesce(v_item.amount, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Opening AP amounts must be greater than zero.');
    end if;
    v_as_of := coalesce(v_item.as_of_date, v_batch.as_of_date);
    if v_as_of > v_batch.as_of_date then
      return jsonb_build_object(
        'ok', false,
        'error', 'Opening AP as-of date cannot be after the batch opening-balance date.'
      );
    end if;
    v_ap_total := v_ap_total + v_item.amount;
  end loop;

  v_ar_total := round(v_ar_total::numeric, 2);
  v_ap_total := round(v_ap_total::numeric, 2);

  if v_ar_total > 0.005 then
    if v_ar_acct is null then
      return jsonb_build_object(
        'ok', false,
        'error', 'Missing mapping: accounts_receivable (required because opening AR > 0).',
        'code', 'MISSING_ACCOUNT_MAPPING'
      );
    end if;
    if not exists (
      select 1 from public.gl_accounts a
      where a.id = v_ar_acct and a.is_active and a.account_type = 'asset'
    ) then
      return jsonb_build_object('ok', false, 'error', 'Accounts receivable mapping is inactive or invalid.');
    end if;
    v_debits := v_debits + v_ar_total;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_ar_acct,
      'debit', v_ar_total,
      'credit', 0,
      'memo', 'Opening accounts receivable'
    ));
  end if;

  if v_ap_total > 0.005 then
    if v_ap_acct is null then
      return jsonb_build_object(
        'ok', false,
        'error', 'Missing mapping: accounts_payable (required because opening AP > 0).',
        'code', 'MISSING_ACCOUNT_MAPPING'
      );
    end if;
    if not exists (
      select 1 from public.gl_accounts a
      where a.id = v_ap_acct and a.is_active and a.account_type = 'liability'
    ) then
      return jsonb_build_object('ok', false, 'error', 'Accounts payable mapping is inactive or invalid.');
    end if;
    v_credits := v_credits + v_ap_total;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_ap_acct,
      'debit', 0,
      'credit', v_ap_total,
      'memo', 'Opening accounts payable'
    ));
  end if;

  v_debits := round(v_debits::numeric, 2);
  v_credits := round(v_credits::numeric, 2);
  v_diff := round((v_debits - v_credits)::numeric, 2);

  -- NO automatic equity plug. Owner must enter equity explicitly if needed.
  if abs(v_diff) > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Opening balances do not balance.',
      'total_debits', v_debits,
      'total_credits', v_credits,
      'difference', v_diff,
      'ar_total', v_ar_total,
      'ap_total', v_ap_total,
      'lines', v_lines
    );
  end if;

  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('ok', false, 'error', 'No opening balance lines to post.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'total_debits', v_debits,
    'total_credits', v_credits,
    'difference', 0,
    'ar_total', v_ar_total,
    'ap_total', v_ap_total,
    'lines', v_lines
  );
end;
$$;

revoke all on function public.opening_balance_compute_package(uuid) from public;
revoke all on function public.opening_balance_compute_package(uuid) from anon;
revoke all on function public.opening_balance_compute_package(uuid) from authenticated;
grant execute on function public.opening_balance_compute_package(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- Trusted opening-balance journal posting (internal — mirrors audit definer)
-- ---------------------------------------------------------------------------
create or replace function public.post_opening_balance_journal_from_definer_safe(
  p_batch_id uuid,
  p_entry_date date,
  p_description text,
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
  v_result jsonb;
begin
  if p_batch_id is null then
    return jsonb_build_object('ok', false, 'error', 'Opening balance batch id is required.');
  end if;
  if not exists (
    select 1 from public.opening_balance_batches b where b.id = p_batch_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'Opening balance batch not found.');
  end if;

  perform set_config('app.trusted_opening_balance_post', 'true', true);
  perform set_config('app.trusted_opening_balance_batch_id', p_batch_id::text, true);

  v_result := public.post_journal_entry_safe(
    p_entry_date,
    coalesce(p_description, 'Opening balances'),
    'opening_balance',
    p_batch_id,
    coalesce(p_entry_kind, 'opening_balance'),
    p_idempotency_key,
    p_lines,
    p_posted_by,
    p_reversal_of_id,
    p_reversal_reason
  );

  perform set_config('app.trusted_opening_balance_post', 'false', true);
  perform set_config('app.trusted_opening_balance_batch_id', '', true);
  return v_result;
exception
  when others then
    perform set_config('app.trusted_opening_balance_post', 'false', true);
    perform set_config('app.trusted_opening_balance_batch_id', '', true);
    raise;
end;
$$;

revoke all on function public.post_opening_balance_journal_from_definer_safe(
  uuid, date, text, text, text, jsonb, uuid, uuid, text
) from public;
revoke all on function public.post_opening_balance_journal_from_definer_safe(
  uuid, date, text, text, text, jsonb, uuid, uuid, text
) from anon;
revoke all on function public.post_opening_balance_journal_from_definer_safe(
  uuid, date, text, text, text, jsonb, uuid, uuid, text
) from authenticated;
grant execute on function public.post_opening_balance_journal_from_definer_safe(
  uuid, date, text, text, text, jsonb, uuid, uuid, text
) to service_role;


-- ---------------------------------------------------------------------------
-- post_journal_entry_safe — hardened opening-balance posting gate (0172)
-- Base: 0171 F6-P2A audit retrofit. Preserves all journal safety checks.
-- Opening-balance journals ALWAYS require trusted definer context.
-- While posting_enabled=false, all other journal posting is OFF (incl. manual).
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
  v_is_opening boolean := false;
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

  v_is_opening :=
    coalesce(p_source_type, '') = 'opening_balance'
    or coalesce(p_entry_kind, '') = 'opening_balance'
    or (
      coalesce(p_entry_kind, '') = 'reversal'
      and coalesce(p_source_type, '') = 'opening_balance'
    );

  -- Opening balance channel: ALWAYS trusted definer workflow (even if posting ON).
  if v_is_opening then
    if coalesce(current_setting('app.trusted_opening_balance_post', true), '') <> 'true' then
      return jsonb_build_object(
        'ok', false,
        'error', 'Opening balance journals require the controlled opening-balance workflow.',
        'code', 'OPENING_BALANCE_TRUST_REQUIRED'
      );
    end if;
    if p_source_id is null then
      return jsonb_build_object(
        'ok', false,
        'error', 'Opening balance batch id is required.',
        'code', 'OPENING_BALANCE_SOURCE_MISMATCH'
      );
    end if;
    if coalesce(current_setting('app.trusted_opening_balance_batch_id', true), '') <> p_source_id::text then
      return jsonb_build_object(
        'ok', false,
        'error', 'Opening balance source batch mismatch.',
        'code', 'OPENING_BALANCE_SOURCE_MISMATCH'
      );
    end if;
    if not exists (
      select 1 from public.opening_balance_batches b where b.id = p_source_id
    ) then
      return jsonb_build_object(
        'ok', false,
        'error', 'Opening balance batch not found.',
        'code', 'OPENING_BALANCE_SOURCE_MISMATCH'
      );
    end if;
  end if;

  -- While posting is OFF: only trusted opening-balance journals may post.
  if coalesce(v_settings.posting_enabled, false) = false and not v_is_opening then
    return jsonb_build_object(
      'ok', false,
      'error', 'Accounting posting is disabled. Enable after cutover validation.',
      'code', 'POSTING_DISABLED',
      'skipped', true
    );
  end if;

  if v_settings.cutover_date is not null
     and p_entry_date < v_settings.cutover_date
     and not v_is_opening then
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
      when p_reversal_of_id is not null then 'journal_reversal_posted'
      when v_is_opening then 'journal_entry_posted'
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

revoke all on function public.post_journal_entry_safe(
  date, text, text, uuid, text, text, jsonb, uuid, uuid, text
) from public;
revoke all on function public.post_journal_entry_safe(
  date, text, text, uuid, text, text, jsonb, uuid, uuid, text
) from anon;
grant execute on function public.post_journal_entry_safe(
  date, text, text, uuid, text, text, jsonb, uuid, uuid, text
) to authenticated;
grant execute on function public.post_journal_entry_safe(
  date, text, text, uuid, text, text, jsonb, uuid, uuid, text
) to service_role;


-- ---------------------------------------------------------------------------
-- create_opening_balance_batch_safe
-- ---------------------------------------------------------------------------
create or replace function public.create_opening_balance_batch_safe(
  p_as_of_date date,
  p_description text default 'Opening balances',
  p_actor uuid default null,
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
  v_id uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin'], 'create opening balance batches');
  v_actor := public.accounting_actor_id(p_actor);

  if p_as_of_date is null then
    return jsonb_build_object('ok', false, 'error', 'Opening balance as-of date is required.');
  end if;

  if exists (select 1 from public.opening_balance_batches where status = 'posted') then
    return jsonb_build_object(
      'ok', false,
      'error', 'A posted opening balance batch already exists. Void/reverse it before creating another.',
      'code', 'OPENING_ALREADY_POSTED'
    );
  end if;

  if p_idempotency_key is not null then
    select id into v_existing
    from public.opening_balance_batches
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'batch_id', v_existing, 'duplicate', true);
    end if;
  end if;

  insert into public.opening_balance_batches (
    as_of_date, description, created_by, idempotency_key, status
  ) values (
    p_as_of_date,
    coalesce(nullif(trim(p_description), ''), 'Opening balances'),
    v_actor,
    nullif(p_idempotency_key, ''),
    'draft'
  )
  returning id into v_id;

  perform public.accounting_audit_from_definer_safe(
    'opening_balance_batch_created',
    'opening_balance_batch',
    v_id,
    p_as_of_date,
    null,
    jsonb_build_object('batchId', v_id, 'asOfDate', p_as_of_date),
    v_actor,
    'audit:opening_batch_create:' || v_id::text
  );

  return jsonb_build_object('ok', true, 'batch_id', v_id, 'duplicate', false);
exception
  when unique_violation then
    if p_idempotency_key is not null then
      select id into v_existing from public.opening_balance_batches
      where idempotency_key = p_idempotency_key limit 1;
      if v_existing is not null then
        return jsonb_build_object('ok', true, 'batch_id', v_existing, 'duplicate', true);
      end if;
    end if;
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- opening_balance_validate_draft_payload — phase A validation (no mutations)
-- ---------------------------------------------------------------------------
create or replace function public.opening_balance_validate_draft_payload(
  p_batch_id uuid,
  p_as_of_date date,
  p_lines jsonb,
  p_ar_items jsonb,
  p_ap_items jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_item jsonb;
  v_acct uuid;
  v_ar_acct uuid;
  v_ap_acct uuid;
  v_signed numeric;
  v_amount numeric;
  v_cust uuid;
  v_vend uuid;
  v_job uuid;
  v_due date;
  v_bill date;
  v_as_of_item date;
begin
  if p_as_of_date is null then
    return jsonb_build_object('ok', false, 'error', 'Opening balance as-of date is required.');
  end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'Invalid GL lines payload.');
  end if;
  if p_ar_items is not null and jsonb_typeof(p_ar_items) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'Invalid opening AR payload.');
  end if;
  if p_ap_items is not null and jsonb_typeof(p_ap_items) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'Invalid opening AP payload.');
  end if;

  select account_id into v_ar_acct from public.accounting_account_mappings where mapping_key = 'accounts_receivable';
  select account_id into v_ap_acct from public.accounting_account_mappings where mapping_key = 'accounts_payable';

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    begin
      v_acct := nullif(trim(coalesce(v_line->>'accountId', '')), '')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'Invalid GL account id.');
    end;
    begin
      v_signed := round(coalesce((v_line->>'signedAmount')::numeric, 0), 2);
    exception when invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'Invalid signed amount on GL line.');
    end;
    if v_acct is null or v_signed = 0 then
      continue;
    end if;
    if v_ar_acct is not null and v_acct = v_ar_acct then
      return jsonb_build_object(
        'ok', false,
        'error', 'Do not enter AR GL manually. Opening AR comes from customer opening items.'
      );
    end if;
    if v_ap_acct is not null and v_acct = v_ap_acct then
      return jsonb_build_object(
        'ok', false,
        'error', 'Do not enter AP GL manually. Opening AP comes from vendor opening items.'
      );
    end if;
    if not public.opening_balance_account_allowed(v_acct) then
      return jsonb_build_object(
        'ok', false,
        'error', 'Opening lines must use active balance-sheet accounts only.'
      );
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_ar_items, '[]'::jsonb))
  loop
    if nullif(trim(coalesce(v_item->>'customerId', '')), '') is null then
      return jsonb_build_object('ok', false, 'error', 'Each opening AR item requires a customer.');
    end if;
    begin
      v_cust := (v_item->>'customerId')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'Invalid customer id on opening AR item.');
    end;
    if not exists (select 1 from public.customers c where c.id = v_cust) then
      return jsonb_build_object('ok', false, 'error', 'Opening AR item references a missing customer.');
    end if;
    begin
      v_amount := round((v_item->>'amount')::numeric, 2);
    exception when invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'Invalid amount on opening AR item.');
    end;
    if coalesce(v_amount, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Opening AR amounts must be greater than zero.');
    end if;
    if nullif(trim(coalesce(v_item->>'dueDate', '')), '') is not null then
      begin
        v_due := (v_item->>'dueDate')::date;
      exception when invalid_text_representation then
        return jsonb_build_object('ok', false, 'error', 'Invalid due date on opening AR item.');
      end;
    end if;
    if nullif(trim(coalesce(v_item->>'asOfDate', '')), '') is not null then
      begin
        v_as_of_item := (v_item->>'asOfDate')::date;
      exception when invalid_text_representation then
        return jsonb_build_object('ok', false, 'error', 'Invalid as-of date on opening AR item.');
      end;
    else
      v_as_of_item := p_as_of_date;
    end if;
    if v_as_of_item > p_as_of_date then
      return jsonb_build_object(
        'ok', false,
        'error', 'Opening AR as-of date cannot be after the batch opening-balance date.'
      );
    end if;
    if nullif(trim(coalesce(v_item->>'jobId', '')), '') is not null then
      begin
        v_job := (v_item->>'jobId')::uuid;
      exception when invalid_text_representation then
        return jsonb_build_object('ok', false, 'error', 'Invalid job id on opening AR item.');
      end;
      if not exists (select 1 from public.jobs j where j.id = v_job) then
        return jsonb_build_object('ok', false, 'error', 'Opening AR item references a missing job.');
      end if;
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_ap_items, '[]'::jsonb))
  loop
    if nullif(trim(coalesce(v_item->>'vendorId', '')), '') is null then
      return jsonb_build_object('ok', false, 'error', 'Each opening AP item requires a vendor.');
    end if;
    begin
      v_vend := (v_item->>'vendorId')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'Invalid vendor id on opening AP item.');
    end;
    if not exists (select 1 from public.suppliers s where s.id = v_vend) then
      return jsonb_build_object('ok', false, 'error', 'Opening AP item references a missing vendor.');
    end if;
    begin
      v_amount := round((v_item->>'amount')::numeric, 2);
    exception when invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'Invalid amount on opening AP item.');
    end;
    if coalesce(v_amount, 0) <= 0 then
      return jsonb_build_object('ok', false, 'error', 'Opening AP amounts must be greater than zero.');
    end if;
    if nullif(trim(coalesce(v_item->>'billDate', '')), '') is not null then
      begin
        v_bill := (v_item->>'billDate')::date;
      exception when invalid_text_representation then
        return jsonb_build_object('ok', false, 'error', 'Invalid bill date on opening AP item.');
      end;
    end if;
    if nullif(trim(coalesce(v_item->>'dueDate', '')), '') is not null then
      begin
        v_due := (v_item->>'dueDate')::date;
      exception when invalid_text_representation then
        return jsonb_build_object('ok', false, 'error', 'Invalid due date on opening AP item.');
      end;
    end if;
    if nullif(trim(coalesce(v_item->>'asOfDate', '')), '') is not null then
      begin
        v_as_of_item := (v_item->>'asOfDate')::date;
      exception when invalid_text_representation then
        return jsonb_build_object('ok', false, 'error', 'Invalid as-of date on opening AP item.');
      end;
    else
      v_as_of_item := p_as_of_date;
    end if;
    if v_as_of_item > p_as_of_date then
      return jsonb_build_object(
        'ok', false,
        'error', 'Opening AP as-of date cannot be after the batch opening-balance date.'
      );
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'batch_id', p_batch_id);
end;
$$;

revoke all on function public.opening_balance_validate_draft_payload(
  uuid, date, jsonb, jsonb, jsonb
) from public;
revoke all on function public.opening_balance_validate_draft_payload(
  uuid, date, jsonb, jsonb, jsonb
) from anon;
revoke all on function public.opening_balance_validate_draft_payload(
  uuid, date, jsonb, jsonb, jsonb
) from authenticated;
grant execute on function public.opening_balance_validate_draft_payload(
  uuid, date, jsonb, jsonb, jsonb
) to service_role;


-- ---------------------------------------------------------------------------
-- save_opening_balance_draft_safe — validate entire payload, then replace atomically
-- ---------------------------------------------------------------------------
create or replace function public.save_opening_balance_draft_safe(
  p_batch_id uuid,
  p_as_of_date date,
  p_description text,
  p_lines jsonb,
  p_ar_items jsonb,
  p_ap_items jsonb,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_batch public.opening_balance_batches%rowtype;
  v_validation jsonb;
  v_line jsonb;
  v_item jsonb;
  v_acct uuid;
  v_signed numeric;
  v_sort int := 0;
begin
  perform public.accounting_require_roles(ARRAY['admin'], 'edit opening balance drafts');
  v_actor := public.accounting_actor_id(p_actor);

  select * into v_batch from public.opening_balance_batches where id = p_batch_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Opening balance batch not found.');
  end if;
  if v_batch.status not in ('draft', 'validated') then
    return jsonb_build_object('ok', false, 'error', 'Only draft/validated batches can be edited.');
  end if;

  -- PHASE A: validate entire payload without mutating opening-balance tables.
  v_validation := public.opening_balance_validate_draft_payload(
    p_batch_id, p_as_of_date, p_lines, p_ar_items, p_ap_items
  );
  if coalesce((v_validation->>'ok')::boolean, false) is not true then
    return v_validation;
  end if;

  -- PHASE B: replace draft atomically (single transaction; any error rolls back all).
  delete from public.opening_balance_lines where batch_id = p_batch_id;
  delete from public.opening_ar_items where batch_id = p_batch_id;
  delete from public.opening_ap_items where batch_id = p_batch_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_acct := nullif(trim(coalesce(v_line->>'accountId', '')), '')::uuid;
    v_signed := round(coalesce((v_line->>'signedAmount')::numeric, 0), 2);
    if v_acct is null or v_signed = 0 then
      continue;
    end if;
    v_sort := v_sort + 1;
    insert into public.opening_balance_lines (batch_id, account_id, signed_amount, note, sort_order)
    values (
      p_batch_id, v_acct, v_signed,
      nullif(trim(coalesce(v_line->>'note', '')), ''),
      v_sort
    );
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_ar_items, '[]'::jsonb))
  loop
    insert into public.opening_ar_items (
      batch_id, customer_id, amount, due_date, as_of_date,
      legacy_invoice_number, reference, job_id, note, status
    ) values (
      p_batch_id,
      (v_item->>'customerId')::uuid,
      round((v_item->>'amount')::numeric, 2),
      nullif(trim(coalesce(v_item->>'dueDate', '')), '')::date,
      coalesce(nullif(trim(coalesce(v_item->>'asOfDate', '')), '')::date, p_as_of_date),
      nullif(trim(coalesce(v_item->>'legacyInvoiceNumber', '')), ''),
      nullif(trim(coalesce(v_item->>'reference', '')), ''),
      nullif(trim(coalesce(v_item->>'jobId', '')), '')::uuid,
      nullif(trim(coalesce(v_item->>'note', '')), ''),
      'active'
    );
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_ap_items, '[]'::jsonb))
  loop
    insert into public.opening_ap_items (
      batch_id, vendor_id, amount, bill_date, due_date, as_of_date,
      legacy_bill_number, reference, note, status
    ) values (
      p_batch_id,
      (v_item->>'vendorId')::uuid,
      round((v_item->>'amount')::numeric, 2),
      nullif(trim(coalesce(v_item->>'billDate', '')), '')::date,
      nullif(trim(coalesce(v_item->>'dueDate', '')), '')::date,
      coalesce(nullif(trim(coalesce(v_item->>'asOfDate', '')), '')::date, p_as_of_date),
      nullif(trim(coalesce(v_item->>'legacyBillNumber', '')), ''),
      nullif(trim(coalesce(v_item->>'reference', '')), ''),
      nullif(trim(coalesce(v_item->>'note', '')), ''),
      'active'
    );
  end loop;

  update public.opening_balance_batches
  set as_of_date = p_as_of_date,
      description = coalesce(nullif(trim(p_description), ''), description),
      status = 'draft',
      validated_at = null,
      validated_by = null,
      updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'status', 'draft');
end;
$$;

-- ---------------------------------------------------------------------------
-- validate_opening_balance_batch_safe
-- ---------------------------------------------------------------------------
create or replace function public.validate_opening_balance_batch_safe(
  p_batch_id uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_batch public.opening_balance_batches%rowtype;
  v_pkg jsonb;
  v_debits numeric;
  v_credits numeric;
  v_diff numeric;
  v_ar_total numeric;
  v_ap_total numeric;
begin
  perform public.accounting_require_roles(ARRAY['admin'], 'validate opening balances');
  v_actor := public.accounting_actor_id(p_actor);

  select * into v_batch from public.opening_balance_batches where id = p_batch_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Opening balance batch not found.');
  end if;
  if v_batch.status not in ('draft', 'validated') then
    return jsonb_build_object('ok', false, 'error', 'Only draft batches can be validated.');
  end if;

  v_pkg := public.opening_balance_compute_package(p_batch_id);
  if coalesce((v_pkg->>'ok')::boolean, false) is not true then
    return v_pkg;
  end if;

  v_debits := (v_pkg->>'total_debits')::numeric;
  v_credits := (v_pkg->>'total_credits')::numeric;
  v_diff := (v_pkg->>'difference')::numeric;
  v_ar_total := (v_pkg->>'ar_total')::numeric;
  v_ap_total := (v_pkg->>'ap_total')::numeric;

  -- Totals must already balance; never modify them to force a pass.
  if abs(coalesce(v_diff, 0)) > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Opening balances do not balance.',
      'total_debits', v_debits,
      'total_credits', v_credits,
      'difference', v_diff
    );
  end if;

  if public.accounting_period_for_date(v_batch.as_of_date) is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'No accounting period covers the opening as-of date. Create an open period first.'
    );
  end if;

  update public.opening_balance_batches
  set status = 'validated',
      validated_at = now(),
      validated_by = v_actor,
      updated_at = now()
  where id = p_batch_id;

  perform public.accounting_audit_from_definer_safe(
    'opening_balance_validated',
    'opening_balance_batch',
    p_batch_id,
    v_batch.as_of_date,
    null,
    jsonb_build_object(
      'batchId', p_batch_id,
      'totalDebits', v_debits,
      'totalCredits', v_credits,
      'difference', 0,
      'arTotal', v_ar_total,
      'apTotal', v_ap_total
    ),
    v_actor,
    'audit:opening_batch_validate:' || p_batch_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'status', 'validated',
    'total_debits', v_debits,
    'total_credits', v_credits,
    'difference', 0,
    'ar_total', v_ar_total,
    'ap_total', v_ap_total
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- finalize_opening_balances_safe
-- ---------------------------------------------------------------------------
create or replace function public.finalize_opening_balances_safe(
  p_batch_id uuid,
  p_actor uuid default null,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_batch public.opening_balance_batches%rowtype;
  v_pkg jsonb;
  v_debits numeric;
  v_credits numeric;
  v_diff numeric;
  v_ar_total numeric;
  v_ap_total numeric;
  v_lines jsonb;
  v_post jsonb;
  v_je uuid;
  v_key text;
begin
  perform public.accounting_require_roles(ARRAY['admin'], 'finalize opening balances');
  v_actor := public.accounting_actor_id(p_actor);

  if not coalesce(p_confirm, false) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Explicit confirmation is required to finalize opening balances.'
    );
  end if;

  select * into v_batch from public.opening_balance_batches where id = p_batch_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Opening balance batch not found.');
  end if;

  if v_batch.status = 'posted' then
    return jsonb_build_object(
      'ok', true,
      'batch_id', p_batch_id,
      'journal_entry_id', v_batch.journal_entry_id,
      'duplicate', true
    );
  end if;
  if v_batch.status = 'void' then
    return jsonb_build_object('ok', false, 'error', 'Cannot finalize a voided opening balance batch.');
  end if;
  if v_batch.status = 'draft' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Validate opening balances before finalizing. Draft batches cannot be posted.'
    );
  end if;
  if v_batch.status <> 'validated' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Opening balance batch must be validated before finalization.'
    );
  end if;

  if exists (
    select 1 from public.opening_balance_batches
    where status = 'posted' and id <> p_batch_id
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Another posted opening balance batch already exists.'
    );
  end if;

  -- Independently recompute and revalidate (do not trust prior validation alone).
  v_pkg := public.opening_balance_compute_package(p_batch_id);
  if coalesce((v_pkg->>'ok')::boolean, false) is not true then
    return v_pkg;
  end if;

  v_debits := (v_pkg->>'total_debits')::numeric;
  v_credits := (v_pkg->>'total_credits')::numeric;
  v_diff := (v_pkg->>'difference')::numeric;
  v_ar_total := (v_pkg->>'ar_total')::numeric;
  v_ap_total := (v_pkg->>'ap_total')::numeric;
  v_lines := v_pkg->'lines';

  if abs(coalesce(v_diff, 0)) > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Opening balances do not balance.',
      'total_debits', v_debits,
      'total_credits', v_credits,
      'difference', v_diff
    );
  end if;

  if public.accounting_period_for_date(v_batch.as_of_date) is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'No accounting period covers the opening as-of date. Create an open period first.'
    );
  end if;

  -- Never auto-insert opening_balance_equity. Package must already balance.
  v_key := 'opening_balance:batch:' || p_batch_id::text;
  v_post := public.post_opening_balance_journal_from_definer_safe(
    p_batch_id,
    v_batch.as_of_date,
    coalesce(v_batch.description, 'Opening balances'),
    'opening_balance',
    v_key,
    v_lines,
    v_actor,
    null,
    null
  );

  if coalesce((v_post->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_post->>'error', 'Opening journal post failed.'),
      'code', v_post->>'code'
    );
  end if;

  v_je := nullif(v_post->>'journal_entry_id', '')::uuid;

  update public.opening_balance_batches
  set status = 'posted',
      journal_entry_id = v_je,
      posted_at = now(),
      posted_by = v_actor,
      updated_at = now()
  where id = p_batch_id;

  -- Completion flag only after successful finalize (not draft/validate).
  update public.accounting_settings
  set opening_balances_entered = true,
      updated_at = now(),
      updated_by = v_actor
  where id = 1;

  perform public.accounting_audit_from_definer_safe(
    'opening_balance_posted',
    'opening_balance_batch',
    p_batch_id,
    v_batch.as_of_date,
    null,
    jsonb_build_object(
      'batchId', p_batch_id,
      'journalEntryId', v_je,
      'totalDebits', v_debits,
      'totalCredits', v_credits,
      'difference', 0,
      'arTotal', v_ar_total,
      'apTotal', v_ap_total,
      'duplicate', coalesce((v_post->>'duplicate')::boolean, false)
    ),
    v_actor,
    'audit:opening_batch_post:' || p_batch_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'journal_entry_id', v_je,
    'duplicate', coalesce((v_post->>'duplicate')::boolean, false),
    'total_debits', v_debits,
    'total_credits', v_credits,
    'difference', 0
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- void_opening_balance_batch_safe — reverse posted batch before books_of_record
-- ---------------------------------------------------------------------------
create or replace function public.void_opening_balance_batch_safe(
  p_batch_id uuid,
  p_void_reason text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_batch public.opening_balance_batches%rowtype;
  v_settings public.accounting_settings%rowtype;
  v_reason text;
  v_rev jsonb;
  v_rev_id uuid;
  v_lines jsonb := '[]'::jsonb;
  r record;
  v_key text;
begin
  perform public.accounting_require_roles(ARRAY['admin'], 'void opening balances');
  v_actor := public.accounting_actor_id(p_actor);
  v_reason := coalesce(nullif(trim(p_void_reason), ''), 'Opening balances reversed before books of record');

  select * into v_settings from public.accounting_settings where id = 1 for update;
  if coalesce(v_settings.books_of_record, false) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Opening balances cannot be casually reset after books_of_record is enabled.',
      'code', 'BOOKS_OF_RECORD'
    );
  end if;

  select * into v_batch from public.opening_balance_batches where id = p_batch_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Opening balance batch not found.');
  end if;
  if v_batch.status = 'void' then
    return jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'duplicate', true);
  end if;
  if v_batch.status <> 'posted' or v_batch.journal_entry_id is null then
    -- Allow discarding unposted drafts without journal reversal.
    if v_batch.status in ('draft', 'validated') then
      update public.opening_balance_batches
      set status = 'void', voided_at = now(), voided_by = v_actor, void_reason = v_reason, updated_at = now()
      where id = p_batch_id;
      return jsonb_build_object('ok', true, 'batch_id', p_batch_id, 'duplicate', false, 'draft_discarded', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'Only posted opening batches can be reversed.');
  end if;

  for r in
    select account_id, debit, credit, memo
    from public.journal_lines
    where journal_entry_id = v_batch.journal_entry_id
    order by line_no
  loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', r.account_id,
      'debit', r.credit,
      'credit', r.debit,
      'memo', coalesce('Reversal: ' || r.memo, 'Opening balance reversal')
    ));
  end loop;

  v_key := 'opening_balance:batch:' || p_batch_id::text || ':void';
  -- Use opening as-of date so the reversal lands in a known open period when possible.
  v_rev := public.post_opening_balance_journal_from_definer_safe(
    p_batch_id,
    v_batch.as_of_date,
    'Reversal of opening balances',
    'reversal',
    v_key,
    v_lines,
    v_actor,
    v_batch.journal_entry_id,
    v_reason
  );
  if coalesce((v_rev->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_rev->>'error', 'Opening balance reversal failed.')
    );
  end if;
  v_rev_id := nullif(v_rev->>'journal_entry_id', '')::uuid;

  update public.opening_balance_batches
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = v_reason,
      updated_at = now()
  where id = p_batch_id;

  update public.opening_ar_items set status = 'void' where batch_id = p_batch_id and status = 'active';
  update public.opening_ap_items set status = 'void' where batch_id = p_batch_id and status = 'active';

  update public.accounting_settings
  set opening_balances_entered = false,
      updated_at = now(),
      updated_by = v_actor
  where id = 1;

  perform public.accounting_audit_from_definer_safe(
    'opening_balance_reversed',
    'opening_balance_batch',
    p_batch_id,
    (timezone('utc', now()))::date,
    v_reason,
    jsonb_build_object(
      'batchId', p_batch_id,
      'originalJournalEntryId', v_batch.journal_entry_id,
      'reversalJournalEntryId', v_rev_id
    ),
    v_actor,
    'audit:opening_batch_void:' || p_batch_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'reversal_journal_entry_id', v_rev_id,
    'duplicate', coalesce((v_rev->>'duplicate')::boolean, false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- ACL sweep
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_admin text[] := array[
    'create_opening_balance_batch_safe',
    'save_opening_balance_draft_safe',
    'validate_opening_balance_batch_safe',
    'finalize_opening_balances_safe',
    'void_opening_balance_batch_safe'
  ];
  v_read text[] := array['opening_balance_account_allowed'];
  v_internal text[] := array[
    'opening_balance_compute_package',
    'post_opening_balance_journal_from_definer_safe',
    'opening_balance_validate_draft_payload'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_admin || v_read || v_internal)
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    if r.proname = any (v_internal) then
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname = any (v_admin) then
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end;
$$;
