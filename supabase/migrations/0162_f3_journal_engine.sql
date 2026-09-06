-- F3 Accounting Foundation (2/2): Journal engine, immutability, posting RPCs.
-- Non-destructive. No historical backfill. Posted entries are not hard-deleted.

-- ---------------------------------------------------------------------------
-- Journal entries
-- ---------------------------------------------------------------------------
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  description text not null default '',
  source_type text not null,
  source_id uuid,
  entry_kind text not null default 'post'
    check (entry_kind in (
      'post',
      'reversal',
      'opening_balance',
      'manual',
      'correction'
    )),
  status text not null default 'draft'
    check (status in ('draft', 'posted', 'void')),
  period_id uuid references public.accounting_periods (id) on delete restrict,
  idempotency_key text,
  reversal_of_id uuid references public.journal_entries (id) on delete restrict,
  reversed_by_id uuid references public.journal_entries (id) on delete set null,
  reversal_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  posted_by uuid references auth.users (id) on delete set null,
  posted_at timestamptz,
  memo text
);

create unique index if not exists journal_entries_idempotency_key_uidx
  on public.journal_entries (idempotency_key)
  where idempotency_key is not null;

-- One posted (non-reversal) entry per source event
create unique index if not exists journal_entries_source_post_uidx
  on public.journal_entries (source_type, source_id, entry_kind)
  where status = 'posted'
    and source_id is not null
    and entry_kind in ('post', 'opening_balance');

create index if not exists journal_entries_date_idx
  on public.journal_entries (entry_date, status);

create index if not exists journal_entries_source_idx
  on public.journal_entries (source_type, source_id);

create index if not exists journal_entries_reversal_of_idx
  on public.journal_entries (reversal_of_id)
  where reversal_of_id is not null;

-- ---------------------------------------------------------------------------
-- Journal lines
-- ---------------------------------------------------------------------------
create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries (id) on delete restrict,
  account_id uuid not null references public.gl_accounts (id) on delete restrict,
  debit numeric(12, 2) not null default 0 check (debit >= 0),
  credit numeric(12, 2) not null default 0 check (credit >= 0),
  memo text,
  customer_id uuid references public.customers (id) on delete set null,
  vendor_id uuid references public.suppliers (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  invoice_id uuid references public.invoices (id) on delete set null,
  bill_id uuid references public.bills (id) on delete set null,
  line_no int not null default 1,
  created_at timestamptz not null default now(),
  constraint journal_lines_debit_xor_credit_chk check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  )
);

create index if not exists journal_lines_entry_idx
  on public.journal_lines (journal_entry_id);

create index if not exists journal_lines_account_idx
  on public.journal_lines (account_id);

-- ---------------------------------------------------------------------------
-- Optional posting outbox for non-atomic source→ledger retry
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_posting_outbox (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'posted', 'error', 'skipped')),
  attempt_count int not null default 0,
  last_error text,
  journal_entry_id uuid references public.journal_entries (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounting_posting_outbox_idem_unique unique (idempotency_key)
);

create index if not exists accounting_posting_outbox_pending_idx
  on public.accounting_posting_outbox (status, created_at)
  where status in ('pending', 'error');

-- ---------------------------------------------------------------------------
-- Immutability: block mutating posted journals / their lines
-- ---------------------------------------------------------------------------
create or replace function public.prevent_posted_journal_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'Posted journal entries cannot be deleted. Reverse them.';
    end if;
    return old;
  end if;

  if old.status = 'posted' then
    -- Allow only linking a reversal id onto the original
    if new.status is distinct from old.status
       or new.entry_date is distinct from old.entry_date
       or new.description is distinct from old.description
       or new.source_type is distinct from old.source_type
       or new.source_id is distinct from old.source_id
       or new.entry_kind is distinct from old.entry_kind
       or new.idempotency_key is distinct from old.idempotency_key
       or new.reversal_of_id is distinct from old.reversal_of_id
       or new.period_id is distinct from old.period_id
       or new.posted_at is distinct from old.posted_at
       or new.posted_by is distinct from old.posted_by
    then
      if not (
        new.reversed_by_id is distinct from old.reversed_by_id
        and new.status = old.status
        and new.entry_date = old.entry_date
        and new.source_type = old.source_type
        and new.source_id is not distinct from old.source_id
      ) then
        raise exception 'Posted journal entries are immutable. Create a reversal.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists journal_entries_posted_immutable on public.journal_entries;
create trigger journal_entries_posted_immutable
  before update or delete on public.journal_entries
  for each row execute function public.prevent_posted_journal_mutation();

create or replace function public.prevent_posted_journal_line_mutation()
returns trigger
language plpgsql
as $$
declare
  st text;
begin
  select status into st
  from public.journal_entries
  where id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if st = 'posted' then
    raise exception 'Posted journal lines cannot be changed. Reverse the entry.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists journal_lines_posted_immutable on public.journal_lines;
create trigger journal_lines_posted_immutable
  before insert or update or delete on public.journal_lines
  for each row execute function public.prevent_posted_journal_line_mutation();

-- ---------------------------------------------------------------------------
-- Resolve open period for a date
-- ---------------------------------------------------------------------------
create or replace function public.accounting_period_for_date(p_date date)
returns uuid
language sql
stable
as $$
  select id
  from public.accounting_periods
  where p_date between start_date and end_date
  order by start_date desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Post a balanced journal atomically (idempotent by key)
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

  -- Opening balances and explicit admin posts may run even when auto-posting is off.
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
  -- Strict: closed and locked periods accept no new journals (including reversals).
  -- Post reversals into an OPEN period date so closed/locked history is not rewritten.
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
    p_posted_by,
    p_posted_by,
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

revoke all on function public.post_journal_entry_safe(
  date, text, text, uuid, text, text, jsonb, uuid, uuid, text
) from public;
grant execute on function public.post_journal_entry_safe(
  date, text, text, uuid, text, text, jsonb, uuid, uuid, text
) to authenticated;

alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.accounting_posting_outbox enable row level security;

drop policy if exists journal_entries_staff_select on public.journal_entries;
create policy journal_entries_staff_select on public.journal_entries
  for select to authenticated
  using (public.is_staff());

drop policy if exists journal_entries_admin_write on public.journal_entries;
create policy journal_entries_admin_write on public.journal_entries
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'office')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'office')
  ));

drop policy if exists journal_lines_staff_select on public.journal_lines;
create policy journal_lines_staff_select on public.journal_lines
  for select to authenticated
  using (public.is_staff());

drop policy if exists journal_lines_admin_write on public.journal_lines;
create policy journal_lines_admin_write on public.journal_lines
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'office')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'office')
  ));

drop policy if exists accounting_outbox_staff on public.accounting_posting_outbox;
create policy accounting_outbox_staff on public.accounting_posting_outbox
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select on public.journal_entries to authenticated;
grant select, insert, update on public.journal_entries to authenticated;
grant select on public.journal_lines to authenticated;
grant select, insert, update on public.journal_lines to authenticated;
grant select, insert, update on public.accounting_posting_outbox to authenticated;
-- No DELETE grants — reverse posted journals; void drafts only via status.
