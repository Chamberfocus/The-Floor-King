-- =============================================================================
-- 0177_f6_p5_financial_reporting_control_center.sql
-- F6-P5: Financial Reporting + Accounting Control Center
--
-- STATUS: UNAPPLIED — apply only after owner review, AFTER 0176.
-- Posting stays OFF. Do NOT set posting_enabled / inventory_posting_enabled /
-- books_of_record / installer_posting_enabled / opening_balances_entered /
-- accountant_validated / backup_PITR flags. External books remain official.
--
-- Scope: report RPCs (TB/P&L/BS/GL/aging), control reconciliations, exception
-- scan, cutover readiness snapshot (read-only), period close/reopen/lock with
-- audit + idempotency, CoA deactivate/upsert guards, overlapping-period guard.
-- Does NOT invent fake financial data. Does NOT enable posting.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Period reopen / close reason columns (never erase close history)
-- ---------------------------------------------------------------------------
alter table public.accounting_periods
  add column if not exists close_reason text,
  add column if not exists reopen_reason text,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references auth.users (id) on delete set null;

comment on column public.accounting_periods.close_reason is
  'Reason supplied at most recent close; prior closes preserved via financial_audit_log.';
comment on column public.accounting_periods.reopen_reason is
  'Reason for last reopen; closed_at/closed_by/close_reason retained as evidence.';

-- ---------------------------------------------------------------------------
-- 1) Control-center idempotency
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_control_idempotency (
  key text primary key,
  action text not null,
  context_hash text not null,
  result jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint accounting_control_idempotency_status_check
    check (status in ('pending', 'completed'))
);

create index if not exists accounting_control_idempotency_action_idx
  on public.accounting_control_idempotency (action, status);

create index if not exists accounting_control_idempotency_created_idx
  on public.accounting_control_idempotency (created_at desc);

alter table public.accounting_control_idempotency enable row level security;

revoke all on public.accounting_control_idempotency from public, anon, authenticated;
grant all on public.accounting_control_idempotency to service_role;

-- ---------------------------------------------------------------------------
-- 2) Internal helpers (idempotency / money / column probes)
-- ---------------------------------------------------------------------------
create or replace function public.acct_control_context_hash(p_action text, p_payload jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select md5(p_action || chr(31) || coalesce(p_payload::text, ''));
$$;

create or replace function public.acct_control_lock_idempotency(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or btrim(p_key) = '' then
    return;
  end if;
  perform pg_advisory_xact_lock(
    179,
    ('x' || substr(md5(p_key), 1, 8))::bit(32)::int
  );
end;
$$;

create or replace function public.acct_control_begin_action(
  p_key text,
  p_action text,
  p_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.accounting_control_idempotency%rowtype;
begin
  if p_key is null or btrim(p_key) = '' then
    return null;
  end if;
  perform public.acct_control_lock_idempotency(p_key);
  insert into public.accounting_control_idempotency (key, action, context_hash, status)
  values (p_key, p_action, p_hash, 'pending')
  on conflict (key) do nothing;

  select * into v
  from public.accounting_control_idempotency
  where key = p_key
  for update;

  if v.action is distinct from p_action or v.context_hash is distinct from p_hash then
    raise exception 'IDEMPOTENCY_CONFLICT: key reused with different control context.'
      using errcode = 'P0001';
  end if;
  if v.status = 'completed' then
    return coalesce(v.result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;
  return null;
end;
$$;

create or replace function public.acct_control_complete_action(
  p_key text,
  p_action text,
  p_hash text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or btrim(p_key) = '' then
    return p_result;
  end if;
  update public.accounting_control_idempotency
  set result = p_result,
      status = 'completed',
      completed_at = now()
  where key = p_key
    and action = p_action
    and context_hash = p_hash
    and status = 'pending';
  return p_result;
end;
$$;

create or replace function public.acct_round2(p_n numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select round(coalesce(p_n, 0)::numeric, 2);
$$;

create or replace function public.acct_is_debit_normal(p_type text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_type in ('asset', 'expense');
$$;

create or replace function public.acct_natural_balance(
  p_type text,
  p_debit numeric,
  p_credit numeric
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when public.acct_is_debit_normal(p_type) then public.acct_round2(p_debit - p_credit)
    else public.acct_round2(p_credit - p_debit)
  end;
$$;

create or replace function public.acct_table_has_column(p_table text, p_column text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = p_table
      and c.column_name = p_column
  );
$$;

create or replace function public.acct_function_exists(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = p_name
  );
$$;

create or replace function public.acct_mapped_account_id(p_key text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select account_id
  from public.accounting_account_mappings
  where mapping_key = p_key
  limit 1;
$$;

create or replace function public.acct_gl_account_balance_as_of(
  p_account_id uuid,
  p_as_of date
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type text;
  v_debit numeric := 0;
  v_credit numeric := 0;
begin
  if p_account_id is null or p_as_of is null then
    return 0;
  end if;
  select account_type into v_type
  from public.gl_accounts
  where id = p_account_id;
  if v_type is null then
    return 0;
  end if;
  select
    coalesce(sum(jl.debit), 0),
    coalesce(sum(jl.credit), 0)
  into v_debit, v_credit
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  where jl.account_id = p_account_id
    and je.status = 'posted'
    and je.entry_date <= p_as_of;
  return public.acct_natural_balance(v_type, v_debit, v_credit);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Role gate — admin/office only (warehouse must fail)
-- ---------------------------------------------------------------------------
create or replace function public.acct_report_require_finance()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.accounting_require_roles(
    array['admin', 'office'],
    'access financial reporting / accounting control center'
  );
end;
$$;

create or replace function public.acct_require_admin(p_action text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.accounting_require_roles(array['admin'], p_action);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Books status (read-only; never flips flags)
-- ---------------------------------------------------------------------------
create or replace function public.acct_books_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_posting boolean := false;
  v_books boolean := false;
  v_official boolean := false;
  v_msg text;
begin
  perform public.acct_report_require_finance();

  select
    coalesce(posting_enabled, false),
    coalesce(books_of_record, false)
  into v_posting, v_books
  from public.accounting_settings
  where id = 1;

  -- Official only when both activation flags are on (external books otherwise).
  v_official := (v_posting is true and v_books is true);
  if not v_official then
    v_msg := 'NOT OFFICIAL BOOKS — posting and/or books_of_record are off; external books remain official.';
  else
    v_msg := 'CRM ledger flags indicate books-of-record mode (owner-validated).';
  end if;

  return jsonb_build_object(
    'posting_enabled', coalesce(v_posting, false),
    'books_of_record', coalesce(v_books, false),
    'official_books', v_official,
    'message', v_msg,
    'label', 'ACCT_BOOKS_STATUS'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Trial Balance — FULL PERIOD CONTRACT
-- beginning_balance = natural balance of posted lines with entry_date < p_start
-- period_debits/credits = sum where entry_date between p_start and p_end inclusive
-- ending_balance = natural balance of lines with entry_date <= p_end
-- PROOF: ending_balance = beginning_balance + natural_balance(period_debits, period_credits)
--        because natural(D0+Dp, C0+Cp) = natural(D0,C0) + natural(Dp,Cp) for fixed account_type.
-- HISTORICAL ACCOUNT LIFECYCLE:
-- Include accounts with relevant posted journal history regardless of is_active.
-- Deactivation = not for new activity; NEVER erase historical TB amounts.
-- is_active / code / name are CURRENT PRESENTATION METADATA on the row.
-- ---------------------------------------------------------------------------
drop function if exists public.acct_report_trial_balance(date);
drop function if exists public.acct_report_trial_balance(date, date);
drop function if exists public.acct_report_trial_balance(date, date, boolean);
drop function if exists public.acct_report_trial_balance_as_of(date);

create or replace function public.acct_report_trial_balance(
  p_start date,
  p_end date,
  p_include_zero boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_period_debits numeric := 0;
  v_period_credits numeric := 0;
  v_balanced boolean;
  v_books jsonb;
begin
  perform public.acct_report_require_finance();
  if p_start is null or p_end is null then
    raise exception 'ACCT_REPORT_DATE_RANGE_REQUIRED';
  end if;
  if p_end < p_start then
    raise exception 'ACCT_REPORT_DATE_RANGE_INVALID';
  end if;
  v_books := public.acct_books_status();

  with beg as (
    select
      jl.account_id,
      public.acct_round2(sum(jl.debit)) as debit,
      public.acct_round2(sum(jl.credit)) as credit
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted'
      and je.entry_date < p_start
    group by jl.account_id
  ),
  period as (
    select
      jl.account_id,
      public.acct_round2(sum(jl.debit)) as debit,
      public.acct_round2(sum(jl.credit)) as credit
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted'
      and je.entry_date >= p_start
      and je.entry_date <= p_end
    group by jl.account_id
  ),
  endc as (
    select
      jl.account_id,
      public.acct_round2(sum(jl.debit)) as debit,
      public.acct_round2(sum(jl.credit)) as credit
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted'
      and je.entry_date <= p_end
    group by jl.account_id
  ),
  acct_ids as (
    select account_id from beg
    union
    select account_id from period
    union
    select account_id from endc
  ),
  rows_cte as (
    select
      a.id as account_id,
      a.code,
      a.name,
      a.account_type,
      a.subtype,
      coalesce(a.is_active, true) as is_active,
      public.acct_natural_balance(
        a.account_type,
        coalesce(b.debit, 0),
        coalesce(b.credit, 0)
      ) as beginning_balance,
      coalesce(p.debit, 0) as period_debits,
      coalesce(p.credit, 0) as period_credits,
      public.acct_natural_balance(
        a.account_type,
        coalesce(e.debit, 0),
        coalesce(e.credit, 0)
      ) as ending_balance,
      -- Identity check column (not returned): beg + natural(period) = end
      public.acct_round2(
        public.acct_natural_balance(a.account_type, coalesce(b.debit, 0), coalesce(b.credit, 0))
        + public.acct_natural_balance(a.account_type, coalesce(p.debit, 0), coalesce(p.credit, 0))
      ) as ending_via_movement
    from acct_ids ids
    join public.gl_accounts a on a.id = ids.account_id
    left join beg b on b.account_id = a.id
    left join period p on p.account_id = a.id
    left join endc e on e.account_id = a.id
    where (
        -- Do NOT filter on is_active — inactive accounts with history must remain.
        p_include_zero
        or coalesce(b.debit, 0) <> 0
        or coalesce(b.credit, 0) <> 0
        or coalesce(p.debit, 0) <> 0
        or coalesce(p.credit, 0) <> 0
        or coalesce(e.debit, 0) <> 0
        or coalesce(e.credit, 0) <> 0
      )
  ),
  checked as (
    select *
    from rows_cte
    where abs(ending_balance - ending_via_movement) <= 0.005
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'account_id', c.account_id,
          'code', c.code,
          'name', c.name,
          'account_type', c.account_type,
          'subtype', c.subtype,
          'is_active', c.is_active,
          'beginning_balance', c.beginning_balance,
          'period_debits', c.period_debits,
          'period_credits', c.period_credits,
          'ending_balance', c.ending_balance
        )
        order by c.code
      ),
      '[]'::jsonb
    ),
    public.acct_round2(coalesce(sum(c.period_debits), 0)),
    public.acct_round2(coalesce(sum(c.period_credits), 0))
  into v_rows, v_period_debits, v_period_credits
  from checked c;

  -- Fail closed if identity broken for any included account
  if exists (
    select 1
    from (
      select
        a.account_type,
        public.acct_natural_balance(a.account_type, coalesce(b.debit, 0), coalesce(b.credit, 0)) as beg_bal,
        public.acct_natural_balance(a.account_type, coalesce(p.debit, 0), coalesce(p.credit, 0)) as per_bal,
        public.acct_natural_balance(a.account_type, coalesce(e.debit, 0), coalesce(e.credit, 0)) as end_bal
      from (
        select account_id from (
          select jl.account_id
          from public.journal_lines jl
          join public.journal_entries je on je.id = jl.journal_entry_id
          where je.status = 'posted' and je.entry_date <= p_end
          group by jl.account_id
        ) x
      ) ids
      join public.gl_accounts a on a.id = ids.account_id
      left join (
        select jl.account_id, sum(jl.debit) as debit, sum(jl.credit) as credit
        from public.journal_lines jl
        join public.journal_entries je on je.id = jl.journal_entry_id
        where je.status = 'posted' and je.entry_date < p_start
        group by jl.account_id
      ) b on b.account_id = a.id
      left join (
        select jl.account_id, sum(jl.debit) as debit, sum(jl.credit) as credit
        from public.journal_lines jl
        join public.journal_entries je on je.id = jl.journal_entry_id
        where je.status = 'posted' and je.entry_date >= p_start and je.entry_date <= p_end
        group by jl.account_id
      ) p on p.account_id = a.id
      left join (
        select jl.account_id, sum(jl.debit) as debit, sum(jl.credit) as credit
        from public.journal_lines jl
        join public.journal_entries je on je.id = jl.journal_entry_id
        where je.status = 'posted' and je.entry_date <= p_end
        group by jl.account_id
      ) e on e.account_id = a.id
    ) q
    where abs(q.end_bal - public.acct_round2(q.beg_bal + q.per_bal)) > 0.005
  ) then
    raise exception 'ACCT_REPORT_TB_IDENTITY_BROKEN: beginning + period natural != ending';
  end if;

  v_balanced := abs(v_period_debits - v_period_credits) <= 0.005;

  return jsonb_build_object(
    'start_date', p_start,
    'end_date', p_end,
    'rows', v_rows,
    'total_period_debits', v_period_debits,
    'total_period_credits', v_period_credits,
    'balanced', v_balanced,
    'critical_error', case
      when v_balanced then null
      else format(
        'CRITICAL: Trial Balance out of balance — period debits %s vs credits %s.',
        v_period_debits::text,
        v_period_credits::text
      )
    end,
    'books_status', v_books,
    'label', 'ACCOUNTING_TRIAL_BALANCE'
  );
end;
$$;

comment on function public.acct_report_trial_balance(date, date, boolean) is
  'FULL PERIOD TB: beginning (< start), period [start,end], ending (<= end). '
  'Includes inactive accounts with posted history; is_active/code/name are presentation. '
  'Identity: ending = beginning + natural(period_debits, period_credits).';

-- Thin as-of wrapper: cumulative period from epoch through as_of (ending balances only meaningfully).
create or replace function public.acct_report_trial_balance_as_of(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_as_of is null then
    raise exception 'ACCT_REPORT_AS_OF_REQUIRED';
  end if;
  -- Prefer full period function as primary; this wrapper is cumulative ending through as_of.
  return public.acct_report_trial_balance('1970-01-01'::date, p_as_of, false);
end;
$$;

comment on function public.acct_report_trial_balance_as_of(date) is
  'Convenience wrapper: acct_report_trial_balance(1970-01-01, as_of). Prefer period form for official TB.';

-- ---------------------------------------------------------------------------
-- 6) P&L — richer classification + account rows + optional compare
-- ---------------------------------------------------------------------------
drop function if exists public.acct_report_pnl(date, date);
drop function if exists public.acct_report_pnl(date, date, date, date);

create or replace function public.acct_report_pnl(
  p_start date,
  p_end date,
  p_compare_start date default null,
  p_compare_end date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_revenue numeric := 0;
  v_cogs numeric := 0;
  v_opex numeric := 0;
  v_other_income numeric := 0;
  v_other_expense numeric := 0;
  v_gross numeric;
  v_op_income numeric;
  v_net numeric;
  v_account_rows jsonb := '[]'::jsonb;
  v_books jsonb;
  v_compare jsonb := null;
begin
  perform public.acct_report_require_finance();
  if p_start is null or p_end is null then
    raise exception 'ACCT_REPORT_DATE_RANGE_REQUIRED';
  end if;
  if p_end < p_start then
    raise exception 'ACCT_REPORT_DATE_RANGE_INVALID';
  end if;
  if (p_compare_start is null) <> (p_compare_end is null) then
    raise exception 'ACCT_REPORT_COMPARE_RANGE_INCOMPLETE';
  end if;
  if p_compare_start is not null and p_compare_end < p_compare_start then
    raise exception 'ACCT_REPORT_COMPARE_RANGE_INVALID';
  end if;
  v_books := public.acct_books_status();

  with lines as (
    select
      a.id as account_id,
      a.code,
      a.name,
      a.account_type,
      coalesce(a.subtype, '') as subtype,
      coalesce(a.is_active, true) as is_active,
      public.acct_round2(sum(jl.debit)) as debit,
      public.acct_round2(sum(jl.credit)) as credit
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.gl_accounts a on a.id = jl.account_id
    where je.status = 'posted'
      and je.entry_date >= p_start
      and je.entry_date <= p_end
      and a.account_type in ('revenue', 'expense')
      -- No is_active filter: inactive P&L accounts with history remain.
    group by a.id, a.code, a.name, a.account_type, a.subtype, a.is_active
  ),
  classified as (
    select
      l.*,
      case
        when l.account_type = 'revenue' and l.subtype in ('other_income', 'other')
          then 'other_income'
        when l.account_type = 'revenue'
          then 'revenue'
        when l.account_type = 'expense' and l.subtype = 'cogs'
          then 'cogs'
        when l.account_type = 'expense' and l.subtype in ('other_expense', 'other')
          then 'other_expense'
        when l.account_type = 'expense'
          then 'operating_expense'
        else 'operating_expense'
      end as group_key,
      case
        when l.account_type = 'revenue'
          then public.acct_round2(l.credit - l.debit)
        else public.acct_round2(l.debit - l.credit)
      end as amount
    from lines l
  )
  select
    public.acct_round2(coalesce(sum(amount) filter (where group_key = 'revenue'), 0)),
    public.acct_round2(coalesce(sum(amount) filter (where group_key = 'cogs'), 0)),
    public.acct_round2(coalesce(sum(amount) filter (where group_key = 'operating_expense'), 0)),
    public.acct_round2(coalesce(sum(amount) filter (where group_key = 'other_income'), 0)),
    public.acct_round2(coalesce(sum(amount) filter (where group_key = 'other_expense'), 0)),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'account_id', account_id,
          'code', code,
          'name', name,
          'account_type', account_type,
          'subtype', nullif(subtype, ''),
          'is_active', is_active,
          'group_key', group_key,
          'amount', amount
        )
        order by group_key, code
      ) filter (where amount <> 0),
      '[]'::jsonb
    )
  into v_revenue, v_cogs, v_opex, v_other_income, v_other_expense, v_account_rows
  from classified;

  v_gross := public.acct_round2(v_revenue - v_cogs);
  v_op_income := public.acct_round2(v_gross - v_opex);
  v_net := public.acct_round2(v_op_income + v_other_income - v_other_expense);

  if p_compare_start is not null then
    -- Nested call: strip books_status nesting noise by taking core fields
    v_compare := public.acct_report_pnl(p_compare_start, p_compare_end, null, null)
      - 'books_status'
      - 'compare'
      - 'label';
    v_compare := v_compare || jsonb_build_object(
      'start_date', p_compare_start,
      'end_date', p_compare_end
    );
  end if;

  return jsonb_build_object(
    'start_date', p_start,
    'end_date', p_end,
    'revenue', v_revenue,
    'cogs', v_cogs,
    'gross_profit', v_gross,
    'operating_expenses', v_opex,
    'operating_income', v_op_income,
    'other_income', v_other_income,
    'other_expense', v_other_expense,
    'net_income', v_net,
    'account_rows', coalesce(v_account_rows, '[]'::jsonb),
    'compare', v_compare,
    'books_status', v_books,
    'label', 'ACCOUNTING_PNL'
  );
end;
$$;

comment on function public.acct_report_pnl(date, date, date, date) is
  'P&L with group_key classification: revenue / cogs / operating_expense / other_income / other_expense. '
  'Revenue excludes other_income subtypes. Optional compare period.';

-- ---------------------------------------------------------------------------
-- 7) Balance Sheet — retained earnings / unclosed earnings policy
-- POLICY (works pre-close AND post-close without double-counting):
--   equity_reported = equity_account_natural_balances(as_of)
--                   + unclosed_earnings(as_of)
-- SIGN-CORRECT unclosed_earnings:
--   SUM(revenue natural balances) - SUM(expense natural balances)
-- Both revenue and expense natural balances are normally POSITIVE
-- (credit-debit vs debit-credit). Do NOT add expense naturals to earnings.
-- Equivalent from journals: SUM(revenue: C-D) + SUM(expense: C-D)
--   = revenue_nat - expense_nat.
-- After year-close zeroes P&L into retained_earnings equity, residual is
-- current-year only. Before year-close, residual is all historical NI.
-- NEVER add lifetime income on top of equity blindly.
-- Disclosure-only: current_year_net_income = P&L(fy_start..as_of) —
-- NOT added again into equity_reported (already inside unclosed residual).
-- FY start = date_trunc('year', p_as_of)::date (calendar Jan 1).
-- Assets = Liabilities + equity_reported. Imbalance → critical_error (no force).
-- ---------------------------------------------------------------------------
drop function if exists public.acct_report_balance_sheet(date);

create or replace function public.acct_report_balance_sheet(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fy_start date;
  v_tb jsonb;
  v_pnl jsonb;
  v_assets numeric := 0;
  v_liab numeric := 0;
  v_equity numeric := 0;
  v_rev_nat numeric := 0;
  v_exp_nat numeric := 0;
  v_unclosed numeric := 0;
  v_cy_ni numeric := 0;
  v_eq_reported numeric;
  v_balanced boolean;
  v_books jsonb;
  v_account_rows jsonb := '[]'::jsonb;
  r jsonb;
begin
  perform public.acct_report_require_finance();
  if p_as_of is null then
    raise exception 'ACCT_REPORT_AS_OF_REQUIRED';
  end if;
  -- Fiscal year start: calendar Jan 1 of as_of year (documented policy).
  v_fy_start := date_trunc('year', p_as_of::timestamp)::date;
  v_books := public.acct_books_status();
  v_tb := public.acct_report_trial_balance_as_of(p_as_of);
  -- Disclosure only: FY-scoped P&L (does NOT drive BS equation / equity_reported).
  v_pnl := public.acct_report_pnl(v_fy_start, p_as_of, null, null);
  v_cy_ni := coalesce((v_pnl->>'net_income')::numeric, 0);

  for r in
    select value
    from jsonb_array_elements(coalesce(v_tb->'rows', '[]'::jsonb))
  loop
    if r->>'account_type' = 'asset' then
      v_assets := public.acct_round2(v_assets + coalesce((r->>'ending_balance')::numeric, 0));
      v_account_rows := v_account_rows || jsonb_build_array(jsonb_build_object(
        'account_id', r->>'account_id',
        'code', r->>'code',
        'name', r->>'name',
        'account_type', 'asset',
        'group_key', 'asset',
        'balance', coalesce((r->>'ending_balance')::numeric, 0)
      ));
    elsif r->>'account_type' = 'liability' then
      v_liab := public.acct_round2(v_liab + coalesce((r->>'ending_balance')::numeric, 0));
      v_account_rows := v_account_rows || jsonb_build_array(jsonb_build_object(
        'account_id', r->>'account_id',
        'code', r->>'code',
        'name', r->>'name',
        'account_type', 'liability',
        'group_key', 'liability',
        'balance', coalesce((r->>'ending_balance')::numeric, 0)
      ));
    elsif r->>'account_type' = 'equity' then
      v_equity := public.acct_round2(v_equity + coalesce((r->>'ending_balance')::numeric, 0));
      v_account_rows := v_account_rows || jsonb_build_array(jsonb_build_object(
        'account_id', r->>'account_id',
        'code', r->>'code',
        'name', r->>'name',
        'account_type', 'equity',
        'group_key', 'equity',
        'balance', coalesce((r->>'ending_balance')::numeric, 0)
      ));
    elsif r->>'account_type' = 'revenue' then
      -- Natural balance is credit-normal (normally positive). Sum for NI numerator.
      v_rev_nat := public.acct_round2(
        v_rev_nat + coalesce((r->>'ending_balance')::numeric, 0)
      );
    elsif r->>'account_type' = 'expense' then
      -- Natural balance is debit-normal (normally positive). SUBTRACT from earnings.
      v_exp_nat := public.acct_round2(
        v_exp_nat + coalesce((r->>'ending_balance')::numeric, 0)
      );
    end if;
  end loop;

  -- Sign-correct residual P&L: revenue_nat - expense_nat (NOT revenue + expense).
  v_unclosed := public.acct_round2(coalesce(v_rev_nat, 0) - coalesce(v_exp_nat, 0));

  -- Synthetic presentation of residual posted P&L earnings (not a GL account;
  -- mathematically derived statement presentation — never force-balance).
  v_account_rows := v_account_rows || jsonb_build_array(jsonb_build_object(
    'account_id', null,
    'code', 'UCE',
    'name', 'Unclosed earnings',
    'account_type', 'equity',
    'group_key', 'unclosed_earnings',
    'balance', v_unclosed,
    'synthetic', true,
    'revenue_natural', v_rev_nat,
    'expense_natural', v_exp_nat
  ));
  -- Disclosure row: current-year NI from FY P&L — NOT added into equity_reported.
  v_account_rows := v_account_rows || jsonb_build_array(jsonb_build_object(
    'account_id', null,
    'code', 'CYE',
    'name', 'Current year earnings (disclosure)',
    'account_type', 'equity',
    'group_key', 'current_year_earnings_disclosure',
    'balance', v_cy_ni,
    'synthetic', true,
    'disclosure_only', true
  ));

  -- equity_reported uses unclosed only — never also add v_cy_ni (would double-count).
  v_eq_reported := public.acct_round2(v_equity + coalesce(v_unclosed, 0));
  v_balanced := abs(v_assets - public.acct_round2(v_liab + v_eq_reported)) <= 0.005;

  return jsonb_build_object(
    'as_of', p_as_of,
    'fiscal_year_start', v_fy_start,
    'assets', v_assets,
    'liabilities', v_liab,
    'equity', v_equity,
    'unclosed_earnings', coalesce(v_unclosed, 0),
    'current_year_net_income', coalesce(v_cy_ni, 0),
    'equity_reported', v_eq_reported,
    'equity_with_income', v_eq_reported,
    'account_rows', v_account_rows,
    'balanced', v_balanced,
    'critical_error', case
      when v_balanced then null
      else format(
        'CRITICAL: Balance Sheet out of balance — Assets %s vs Liabilities+Equity %s.',
        v_assets::text,
        public.acct_round2(v_liab + v_eq_reported)::text
      )
    end,
    'books_status', v_books,
    'label', 'ACCOUNTING_BALANCE_SHEET'
  );
end;
$$;

comment on function public.acct_report_balance_sheet(date) is
  'POLICY: equity_reported = equity_accounts(as_of) + unclosed_earnings(as_of). '
  'unclosed_earnings = SUM(revenue natural) - SUM(expense natural) through as_of '
  '(works pre-close and post year-close without double-counting RE). '
  'current_year_net_income is FY disclosure only — not added again to equity. '
  'Imbalance returns critical_error; never force-balance.';

-- ---------------------------------------------------------------------------
-- 8) General Ledger (paginated) — unchanged contract; books_status key
-- ---------------------------------------------------------------------------
create or replace function public.acct_report_general_ledger(
  p_start date,
  p_end date,
  p_account_id uuid default null,
  p_limit int default 100,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(nullif(p_limit, 0), 100), 1000));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_books jsonb;
begin
  perform public.acct_report_require_finance();
  if p_start is null or p_end is null then
    raise exception 'ACCT_REPORT_DATE_RANGE_REQUIRED';
  end if;
  if p_end < p_start then
    raise exception 'ACCT_REPORT_DATE_RANGE_INVALID';
  end if;
  v_books := public.acct_books_status();

  select count(*)
  into v_total
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  where je.status = 'posted'
    and je.entry_date >= p_start
    and je.entry_date <= p_end
    and (p_account_id is null or jl.account_id = p_account_id);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.entry_date, x.account_code, x.line_no), '[]'::jsonb)
  into v_rows
  from (
    select
      je.entry_date,
      je.id as journal_entry_id,
      jl.id as journal_line_id,
      jl.account_id,
      a.code as account_code,
      a.name as account_name,
      coalesce(a.is_active, true) as account_is_active,
      public.acct_round2(jl.debit) as debit,
      public.acct_round2(jl.credit) as credit,
      jl.memo,
      jl.customer_id,
      jl.invoice_id,
      jl.bill_id,
      jl.line_no,
      je.source_type,
      je.source_id,
      je.description
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.gl_accounts a on a.id = jl.account_id
    where je.status = 'posted'
      and je.entry_date >= p_start
      and je.entry_date <= p_end
      and (p_account_id is null or jl.account_id = p_account_id)
      -- No is_active filter: inactive accounts remain in historical GL drill-down.
    order by je.entry_date, a.code, jl.line_no
    limit v_limit
    offset v_offset
  ) x;

  return jsonb_build_object(
    'start_date', p_start,
    'end_date', p_end,
    'account_id', p_account_id,
    'rows', v_rows,
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total', v_total,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'books_status', v_books,
    'label', 'ACCOUNTING_GENERAL_LEDGER'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Historical open AR as-of — FAIL CLOSED commercial (jsonb)
-- invoice_commercial_total reads LIVE invoice_items — NEVER use for historical.
-- Commercial freeze from (in order): frozen columns, posted invoice journals,
-- accounting_posting_outbox invoice_issue payload, approval_snapshot payload.total.
-- Else: HISTORICAL_COMMERCIAL_UNSUPPORTED (never silent live items).
-- ---------------------------------------------------------------------------
drop function if exists public.acct_invoice_open_ar_as_of(uuid, date);

create or replace function public.acct_invoice_open_ar_as_of(
  p_invoice_id uuid,
  p_as_of date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_voided_at timestamptz;
  v_issue_date date;
  v_commercial numeric := null;
  v_provenance text := null;
  v_limitation text := null;
  v_payments numeric := 0;
  v_credits numeric := 0;
  v_deposits numeric := 0;
  v_writeoffs numeric := 0;
  v_reductions numeric := 0;
  v_balance numeric := null;
  v_ok boolean := true;
  v_error text := null;
begin
  -- Internal helper: no finance gate here (callers are staff report RPCs / service).
  if p_invoice_id is null or p_as_of is null then
    return jsonb_build_object(
      'ok', false,
      'invoice_id', p_invoice_id,
      'as_of', p_as_of,
      'issue_date', null,
      'commercial', null,
      'reductions', 0,
      'balance', null,
      'provenance', null,
      'limitation_code', 'ARGS_REQUIRED',
      'error', 'INV_ACCT_REPORT_ERROR: invoice_id and as_of required'
    );
  end if;

  select status::text, voided_at, issue_date
  into v_status, v_voided_at, v_issue_date
  from public.invoices
  where id = p_invoice_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'invoice_id', p_invoice_id,
      'as_of', p_as_of,
      'issue_date', null,
      'commercial', null,
      'reductions', 0,
      'balance', null,
      'provenance', null,
      'limitation_code', 'INVOICE_NOT_FOUND',
      'error', 'INV_ACCT_REPORT_ERROR: invoice not found'
    );
  end if;

  -- Not issued yet as-of
  if v_issue_date is null or v_issue_date > p_as_of then
    return jsonb_build_object(
      'ok', true,
      'invoice_id', p_invoice_id,
      'as_of', p_as_of,
      'issue_date', v_issue_date,
      'commercial', 0,
      'reductions', 0,
      'balance', 0,
      'provenance', 'excluded',
      'limitation_code', 'NOT_ISSUED_YET',
      'error', null
    );
  end if;

  -- Exclude if voided on/before as-of
  if v_voided_at is not null and (v_voided_at::date <= p_as_of) then
    return jsonb_build_object(
      'ok', true,
      'invoice_id', p_invoice_id,
      'as_of', p_as_of,
      'issue_date', v_issue_date,
      'commercial', 0,
      'reductions', 0,
      'balance', 0,
      'provenance', 'excluded',
      'limitation_code', 'VOIDED_AS_OF',
      'error', null
    );
  end if;
  if v_status = 'void' and v_voided_at is null then
    return jsonb_build_object(
      'ok', true,
      'invoice_id', p_invoice_id,
      'as_of', p_as_of,
      'issue_date', v_issue_date,
      'commercial', 0,
      'reductions', 0,
      'balance', 0,
      'provenance', 'excluded',
      'limitation_code', 'VOIDED_AS_OF',
      'error', null
    );
  end if;

  -- Commercial provenance (immutable only; NEVER live invoice_items):
  -- 1) issued_commercial_total / frozen_total column if present
  -- 2) posted invoice journal AR debit (entry_date <= as_of)
  -- 3) accounting_posting_outbox invoice_issue payload.amount (economicEventDate <= as_of)
  -- 4) estimate_approval_snapshots.payload.total via invoices.approval_snapshot_id
  --    (append-only snapshot; invoice FK points at issue-time commercial)
  -- else HISTORICAL_COMMERCIAL_UNSUPPORTED (fail closed)
  if public.acct_table_has_column('invoices', 'issued_commercial_total') then
    execute $q$ select issued_commercial_total from public.invoices where id = $1 $q$
      into v_commercial using p_invoice_id;
    if v_commercial is not null then
      v_provenance := 'issued_commercial_total';
    end if;
  end if;

  if v_provenance is null and public.acct_table_has_column('invoices', 'frozen_total') then
    execute $q$ select frozen_total from public.invoices where id = $1 $q$
      into v_commercial using p_invoice_id;
    if v_commercial is not null then
      v_provenance := 'frozen_total';
    end if;
  end if;

  if v_provenance is null then
    select public.acct_round2(coalesce(sum(jl.debit), 0))
    into v_commercial
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted'
      and je.entry_date <= p_as_of
      and jl.debit > 0
      and (
        (je.source_type like 'invoice%' and je.source_id = p_invoice_id)
        or (jl.invoice_id = p_invoice_id and je.source_type like 'invoice%')
      );

    if coalesce(v_commercial, 0) > 0.005 then
      v_provenance := 'posted_invoice_journal_ar_debit';
    end if;
  end if;

  if v_provenance is null and to_regclass('public.accounting_posting_outbox') is not null then
    begin
      execute $q$
        select public.acct_round2((o.payload->>'amount')::numeric)
        from public.accounting_posting_outbox o
        where o.source_type = 'invoice'
          and o.source_id = $1
          and o.event_kind = 'invoice_issue'
          and coalesce(
            nullif(o.payload->>'economicEventDate', '')::date,
            $2
          ) <= $2
          and (o.payload->>'amount') is not null
        order by o.created_at asc nulls last
        limit 1
      $q$ into v_commercial using p_invoice_id, p_as_of;
      if v_commercial is not null and v_commercial > 0.005 then
        v_provenance := 'accounting_posting_outbox_invoice_issue';
      else
        v_commercial := null;
      end if;
    exception
      when undefined_table then
        null;
      when undefined_column then
        raise exception 'INV_ACCT_REPORT_ERROR: accounting_posting_outbox columns missing for historical AR';
    end;
  end if;

  if v_provenance is null
     and public.acct_table_has_column('invoices', 'approval_snapshot_id')
     and to_regclass('public.estimate_approval_snapshots') is not null then
    begin
      execute $q$
        select public.acct_round2((s.payload->>'total')::numeric)
        from public.invoices i
        join public.estimate_approval_snapshots s on s.id = i.approval_snapshot_id
        where i.id = $1
          and (s.payload->>'total') is not null
          and s.approved_at::date <= $2
      $q$ into v_commercial using p_invoice_id, p_as_of;
      if v_commercial is not null and v_commercial > 0.005 then
        v_provenance := 'approval_snapshot_payload_total';
      else
        v_commercial := null;
      end if;
    exception
      when undefined_table then
        null;
      when undefined_column then
        raise exception 'INV_ACCT_REPORT_ERROR: approval snapshot columns missing for historical AR';
    end;
  end if;

  if v_provenance is null then
    -- FAIL CLOSED — never use live invoice_items / invoice_commercial_total
    return jsonb_build_object(
      'ok', true,
      'invoice_id', p_invoice_id,
      'as_of', p_as_of,
      'issue_date', v_issue_date,
      'commercial', null,
      'reductions', null,
      'balance', null,
      'provenance', null,
      'limitation_code', 'HISTORICAL_COMMERCIAL_UNSUPPORTED',
      'error', null
    );
  end if;

  v_commercial := public.acct_round2(coalesce(v_commercial, 0));

  -- Payments: paid_at <= as_of AND (voided_at is null OR voided_at::date > as_of)
  begin
    if public.acct_table_has_column('payments', 'paid_at') then
      if public.acct_table_has_column('payments', 'voided_at')
         and public.acct_table_has_column('payments', 'status') then
        execute $q$
          select coalesce(sum(amount), 0)::numeric
          from public.payments
          where invoice_id = $1
            and coalesce(paid_at, created_at::date) <= $2
            and (voided_at is null or voided_at::date > $2)
            and status is distinct from 'void'
        $q$ into v_payments using p_invoice_id, p_as_of;
      elsif public.acct_table_has_column('payments', 'voided_at') then
        execute $q$
          select coalesce(sum(amount), 0)::numeric
          from public.payments
          where invoice_id = $1
            and coalesce(paid_at, created_at::date) <= $2
            and (voided_at is null or voided_at::date > $2)
        $q$ into v_payments using p_invoice_id, p_as_of;
      elsif public.acct_table_has_column('payments', 'status') then
        execute $q$
          select coalesce(sum(amount), 0)::numeric
          from public.payments
          where invoice_id = $1
            and status = 'active'
            and coalesce(paid_at, created_at::date) <= $2
        $q$ into v_payments using p_invoice_id, p_as_of;
      else
        execute $q$
          select coalesce(sum(amount), 0)::numeric
          from public.payments
          where invoice_id = $1
            and coalesce(paid_at, created_at::date) <= $2
        $q$ into v_payments using p_invoice_id, p_as_of;
      end if;
    end if;
  exception
    when undefined_table then
      v_payments := 0;
    when undefined_column then
      raise exception 'INV_ACCT_REPORT_ERROR: payments column probe failed for invoice %', p_invoice_id;
  end;

  -- Credit applications: created_at <= as_of
  begin
    if to_regclass('public.credit_applications') is not null then
      execute $q$
        select coalesce(sum(amount), 0)::numeric
        from public.credit_applications
        where invoice_id = $1
          and coalesce(status, 'active') = 'active'
          and created_at::date <= $2
      $q$ into v_credits using p_invoice_id, p_as_of;
    end if;
  exception
    when undefined_table then
      v_credits := 0;
    when undefined_column then
      raise exception 'INV_ACCT_REPORT_ERROR: credit_applications column missing for invoice %', p_invoice_id;
  end;

  -- Deposits: applied_on <= as_of
  begin
    if to_regclass('public.customer_deposit_applications') is not null then
      if public.acct_table_has_column('customer_deposit_applications', 'applied_on') then
        execute $q$
          select coalesce(sum(amount), 0)::numeric
          from public.customer_deposit_applications
          where invoice_id = $1
            and coalesce(status, 'active') = 'active'
            and applied_on <= $2
        $q$ into v_deposits using p_invoice_id, p_as_of;
      else
        execute $q$
          select coalesce(sum(amount), 0)::numeric
          from public.customer_deposit_applications
          where invoice_id = $1
            and coalesce(status, 'active') = 'active'
            and created_at::date <= $2
        $q$ into v_deposits using p_invoice_id, p_as_of;
      end if;
    end if;
  exception
    when undefined_table then
      v_deposits := 0;
    when undefined_column then
      raise exception 'INV_ACCT_REPORT_ERROR: deposit application columns missing for invoice %', p_invoice_id;
  end;

  -- Write-offs: written_off_at <= as_of
  begin
    if to_regclass('public.invoice_write_offs') is not null then
      execute $q$
        select coalesce(sum(amount), 0)::numeric
        from public.invoice_write_offs
        where invoice_id = $1
          and coalesce(status, 'active') = 'active'
          and written_off_at::date <= $2
      $q$ into v_writeoffs using p_invoice_id, p_as_of;
    end if;
  exception
    when undefined_table then
      v_writeoffs := 0;
    when undefined_column then
      raise exception 'INV_ACCT_REPORT_ERROR: invoice_write_offs.written_off_at missing for invoice %', p_invoice_id;
  end;

  v_reductions := public.acct_round2(
    coalesce(v_payments, 0)
    + coalesce(v_credits, 0)
    + coalesce(v_deposits, 0)
    + coalesce(v_writeoffs, 0)
  );
  v_balance := greatest(0, public.acct_round2(v_commercial - v_reductions));

  return jsonb_build_object(
    'ok', v_ok,
    'invoice_id', p_invoice_id,
    'as_of', p_as_of,
    'issue_date', v_issue_date,
    'commercial', v_commercial,
    'reductions', v_reductions,
    'reductions_detail', jsonb_build_object(
      'payments', public.acct_round2(coalesce(v_payments, 0)),
      'credits', public.acct_round2(coalesce(v_credits, 0)),
      'deposits', public.acct_round2(coalesce(v_deposits, 0)),
      'writeoffs', public.acct_round2(coalesce(v_writeoffs, 0))
    ),
    'balance', v_balance,
    'provenance', v_provenance,
    'limitation_code', v_limitation,
    'error', v_error
  );
end;
$$;

comment on function public.acct_invoice_open_ar_as_of(uuid, date) is
  'Historical AR as-of jsonb. FAIL CLOSED without commercial freeze — never live invoice_items. '
  'Exclude if voided on/before as-of. INTERNAL (service_role).';

-- ---------------------------------------------------------------------------
-- 10) AR aging — SET-BASED (no per-invoice helper N+1)
-- Commercial provenance mirrors acct_invoice_open_ar_as_of without live items.
-- ---------------------------------------------------------------------------
create or replace function public.acct_report_ar_aging(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_totals jsonb;
  v_total numeric := 0;
  v_books jsonb;
  v_limitations jsonb := '[]'::jsonb;
  v_supported int := 0;
  v_unsupported int := 0;
  v_status text;
begin
  perform public.acct_report_require_finance();
  if p_as_of is null then
    raise exception 'ACCT_REPORT_AS_OF_REQUIRED';
  end if;
  v_books := public.acct_books_status();

  with base as (
    select
      i.id,
      i.number,
      i.issue_date,
      coalesce(i.due_date, i.issue_date) as due_anchor,
      i.status::text as status,
      i.voided_at,
      case
        when i.issue_date is null or i.issue_date > p_as_of then 'NOT_ISSUED_YET'
        when i.voided_at is not null and i.voided_at::date <= p_as_of then 'VOIDED_AS_OF'
        when i.status::text = 'void' and i.voided_at is null then 'VOIDED_AS_OF'
        else null
      end as gate_code
    from public.invoices i
    where i.status::text is distinct from 'draft'
  ),
  journal_comm as (
    select
      coalesce(je.source_id, jl.invoice_id) as invoice_id,
      public.acct_round2(sum(jl.debit)) as commercial
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.status = 'posted'
      and je.entry_date <= p_as_of
      and jl.debit > 0
      and (
        (je.source_type like 'invoice%' and je.source_id is not null)
        or (jl.invoice_id is not null and je.source_type like 'invoice%')
      )
    group by coalesce(je.source_id, jl.invoice_id)
  ),
  outbox_comm as (
    select distinct on (o.source_id)
      o.source_id as invoice_id,
      public.acct_round2((o.payload->>'amount')::numeric) as commercial
    from public.accounting_posting_outbox o
    where o.source_type = 'invoice'
      and o.event_kind = 'invoice_issue'
      and (o.payload->>'amount') is not null
      and coalesce(
        nullif(o.payload->>'economicEventDate', '')::date,
        p_as_of
      ) <= p_as_of
    order by o.source_id, o.created_at asc nulls last
  ),
  snap_comm as (
    select
      i.id as invoice_id,
      public.acct_round2((s.payload->>'total')::numeric) as commercial
    from public.invoices i
    join public.estimate_approval_snapshots s on s.id = i.approval_snapshot_id
    where (s.payload->>'total') is not null
      and s.approved_at::date <= p_as_of
  ),
  commercial as (
    select
      b.id,
      b.number,
      b.issue_date,
      b.due_anchor,
      b.gate_code,
      case
        when b.gate_code is not null then null
        when coalesce(jc.commercial, 0) > 0.005 then jc.commercial
        when coalesce(oc.commercial, 0) > 0.005 then oc.commercial
        when coalesce(sc.commercial, 0) > 0.005 then sc.commercial
        else null
      end as commercial,
      case
        when b.gate_code is not null then 'excluded'
        when coalesce(jc.commercial, 0) > 0.005 then 'posted_invoice_journal_ar_debit'
        when coalesce(oc.commercial, 0) > 0.005 then 'accounting_posting_outbox_invoice_issue'
        when coalesce(sc.commercial, 0) > 0.005 then 'approval_snapshot_payload_total'
        else null
      end as provenance
    from base b
    left join journal_comm jc on jc.invoice_id = b.id
    left join outbox_comm oc on oc.invoice_id = b.id
    left join snap_comm sc on sc.invoice_id = b.id
  ),
  pay as (
    select
      p.invoice_id,
      public.acct_round2(coalesce(sum(p.amount), 0)) as amt
    from public.payments p
    where coalesce(p.paid_at, p.created_at::date) <= p_as_of
      and (p.voided_at is null or p.voided_at::date > p_as_of)
      and coalesce(p.status::text, 'active') is distinct from 'void'
    group by p.invoice_id
  ),
  cred as (
    select
      ca.invoice_id,
      public.acct_round2(coalesce(sum(ca.amount), 0)) as amt
    from public.credit_applications ca
    where coalesce(ca.status, 'active') = 'active'
      and ca.created_at::date <= p_as_of
    group by ca.invoice_id
  ),
  dep as (
    select
      d.invoice_id,
      public.acct_round2(coalesce(sum(d.amount), 0)) as amt
    from public.customer_deposit_applications d
    where coalesce(d.status, 'active') = 'active'
      and coalesce(d.applied_on, d.created_at::date) <= p_as_of
    group by d.invoice_id
  ),
  wo as (
    select
      w.invoice_id,
      public.acct_round2(coalesce(sum(w.amount), 0)) as amt
    from public.invoice_write_offs w
    where coalesce(w.status, 'active') = 'active'
      and w.written_off_at::date <= p_as_of
    group by w.invoice_id
  ),
  classified as (
    select
      c.id,
      c.number,
      c.issue_date,
      c.due_anchor,
      c.provenance,
      case
        when c.gate_code is not null then c.gate_code
        when c.commercial is null then 'HISTORICAL_COMMERCIAL_UNSUPPORTED'
        else null
      end as limitation_code,
      case
        when c.gate_code is not null then true
        when c.commercial is null then true
        else false
      end as is_unsupported,
      case
        when c.gate_code is not null then 0::numeric
        when c.commercial is null then null::numeric
        else greatest(
          0,
          public.acct_round2(
            c.commercial
            - coalesce(pay.amt, 0)
            - coalesce(cred.amt, 0)
            - coalesce(dep.amt, 0)
            - coalesce(wo.amt, 0)
          )
        )
      end as balance
    from commercial c
    left join pay on pay.invoice_id = c.id
    left join cred on cred.invoice_id = c.id
    left join dep on dep.invoice_id = c.id
    left join wo on wo.invoice_id = c.id
    where c.issue_date is not null
      and c.issue_date <= p_as_of
  ),
  lim as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'invoice_id', id,
          'reference', coalesce(number, left(id::text, 8)),
          'limitation_code', limitation_code
        )
        order by number nulls last
      ) filter (where is_unsupported and limitation_code = 'HISTORICAL_COMMERCIAL_UNSUPPORTED'),
      '[]'::jsonb
    ) as limitations,
    count(*) filter (
      where is_unsupported and limitation_code = 'HISTORICAL_COMMERCIAL_UNSUPPORTED'
    )::int as unsupported_count,
    count(*) filter (where not is_unsupported)::int as supported_count
  from classified
  ),
  aged as (
    select
      id as source_id,
      coalesce(number, left(id::text, 8)) as reference,
      due_anchor as due_date,
      balance,
      greatest(0, (p_as_of - coalesce(due_anchor, p_as_of)))::int as days_past_due,
      case
        when (p_as_of - coalesce(due_anchor, p_as_of)) <= 0 then 'current'
        when (p_as_of - coalesce(due_anchor, p_as_of)) <= 30 then '1-30'
        when (p_as_of - coalesce(due_anchor, p_as_of)) <= 60 then '31-60'
        when (p_as_of - coalesce(due_anchor, p_as_of)) <= 90 then '61-90'
        else '90+'
      end as bucket
    from classified
    where not is_unsupported
      and coalesce(balance, 0) > 0.005
  )
  select
    coalesce(jsonb_agg(to_jsonb(a) order by a.days_past_due desc, a.reference), '[]'::jsonb),
    public.acct_round2(coalesce(sum(a.balance), 0)),
    jsonb_build_object(
      'current', public.acct_round2(coalesce(sum(a.balance) filter (where a.bucket = 'current'), 0)),
      '1-30', public.acct_round2(coalesce(sum(a.balance) filter (where a.bucket = '1-30'), 0)),
      '31-60', public.acct_round2(coalesce(sum(a.balance) filter (where a.bucket = '31-60'), 0)),
      '61-90', public.acct_round2(coalesce(sum(a.balance) filter (where a.bucket = '61-90'), 0)),
      '90+', public.acct_round2(coalesce(sum(a.balance) filter (where a.bucket = '90+'), 0))
    ),
    (select limitations from lim),
    (select supported_count from lim),
    (select unsupported_count from lim)
  into v_rows, v_total, v_totals, v_limitations, v_supported, v_unsupported
  from aged a;

  if coalesce(v_unsupported, 0) = 0 then
    v_status := 'OK';
  elsif coalesce(v_supported, 0) = 0 then
    v_status := 'UNSUPPORTED';
  else
    v_status := 'PARTIAL';
  end if;

  return jsonb_build_object(
    'as_of', p_as_of,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'totals', coalesce(v_totals, jsonb_build_object(
      'current', 0, '1-30', 0, '31-60', 0, '61-90', 0, '90+', 0
    )),
    'total', coalesce(v_total, 0),
    'limitations', coalesce(v_limitations, '[]'::jsonb),
    'supported_count', coalesce(v_supported, 0),
    'unsupported_count', coalesce(v_unsupported, 0),
    'status', v_status,
    'performance', 'set_based',
    'books_status', v_books,
    'label', 'AR_AGING'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11) Historical AP remaining as-of — immutable open/void bill lines (jsonb)
-- Bill items immutable after ap_lifecycle open/void (0175).
-- original = ap_bill_original_total; payments use bill_payments.date.
-- ---------------------------------------------------------------------------
drop function if exists public.acct_bill_remaining_as_of(uuid, date);

create or replace function public.acct_bill_remaining_as_of(
  p_bill_id uuid,
  p_as_of date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_life text;
  v_voided_at timestamptz;
  v_bill_date date;
  v_activated date;
  v_orig numeric := 0;
  v_paid numeric := 0;
  v_balance numeric := 0;
begin
  if p_bill_id is null or p_as_of is null then
    return jsonb_build_object(
      'ok', false,
      'bill_id', p_bill_id,
      'as_of', p_as_of,
      'bill_date', null,
      'original', null,
      'payments', 0,
      'balance', null,
      'provenance', null,
      'limitation_code', 'ARGS_REQUIRED',
      'error', 'INV_ACCT_REPORT_ERROR: bill_id and as_of required'
    );
  end if;

  select ap_lifecycle::text, bill_date
  into v_life, v_bill_date
  from public.bills
  where id = p_bill_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'bill_id', p_bill_id,
      'as_of', p_as_of,
      'bill_date', null,
      'original', null,
      'payments', 0,
      'balance', null,
      'provenance', null,
      'limitation_code', 'BILL_NOT_FOUND',
      'error', 'INV_ACCT_REPORT_ERROR: bill not found'
    );
  end if;

  if public.acct_table_has_column('bills', 'voided_at') then
    execute $q$ select voided_at from public.bills where id = $1 $q$
      into v_voided_at using p_bill_id;
  end if;

  if public.acct_table_has_column('bills', 'activated_at') then
    execute $q$ select activated_at::date from public.bills where id = $1 $q$
      into v_activated using p_bill_id;
  end if;

  -- Only open/void have immutable bill_items (0175). Draft/other → fail closed.
  if v_life is null or v_life not in ('open', 'void') then
    return jsonb_build_object(
      'ok', true,
      'bill_id', p_bill_id,
      'as_of', p_as_of,
      'bill_date', v_bill_date,
      'original', null,
      'payments', null,
      'balance', null,
      'provenance', null,
      'limitation_code', case
        when v_life = 'draft' then 'DRAFT'
        else 'HISTORICAL_AP_UNSUPPORTED'
      end,
      'error', null
    );
  end if;

  -- Exclude if bill_date > as_of (or activated_at::date > as_of when present)
  if v_bill_date is not null and v_bill_date > p_as_of then
    return jsonb_build_object(
      'ok', true,
      'bill_id', p_bill_id,
      'as_of', p_as_of,
      'bill_date', v_bill_date,
      'original', 0,
      'payments', 0,
      'balance', 0,
      'provenance', 'excluded',
      'limitation_code', 'NOT_OPEN_YET',
      'error', null
    );
  end if;
  if v_activated is not null and v_activated > p_as_of then
    return jsonb_build_object(
      'ok', true,
      'bill_id', p_bill_id,
      'as_of', p_as_of,
      'bill_date', v_bill_date,
      'original', 0,
      'payments', 0,
      'balance', 0,
      'provenance', 'excluded',
      'limitation_code', 'NOT_OPEN_YET',
      'error', null
    );
  end if;

  -- If voided_at::date <= as_of → 0 (voided after as-of: include historically)
  if v_life = 'void' then
    if v_voided_at is not null and v_voided_at::date > p_as_of then
      null; -- voided after as-of: include historically
    else
      return jsonb_build_object(
        'ok', true,
        'bill_id', p_bill_id,
        'as_of', p_as_of,
        'bill_date', v_bill_date,
        'original', 0,
        'payments', 0,
        'balance', 0,
        'provenance', 'excluded',
        'limitation_code', 'VOIDED_AS_OF',
        'error', null
      );
    end if;
  elsif v_voided_at is not null and v_voided_at::date <= p_as_of then
    return jsonb_build_object(
      'ok', true,
      'bill_id', p_bill_id,
      'as_of', p_as_of,
      'bill_date', v_bill_date,
      'original', 0,
      'payments', 0,
      'balance', 0,
      'provenance', 'excluded',
      'limitation_code', 'VOIDED_AS_OF',
      'error', null
    );
  end if;

  if public.acct_function_exists('ap_bill_original_total') then
    v_orig := public.ap_bill_original_total(p_bill_id);
  else
    raise exception 'INV_ACCT_REPORT_ERROR: ap_bill_original_total missing — cannot compute historical AP';
  end if;

  -- Payments: bill_payments.date <= as_of and (voided_at null or voided_at::date > as_of)
  begin
    if public.acct_table_has_column('bill_payments', 'date') then
      if public.acct_table_has_column('bill_payments', 'voided_at') then
        execute $q$
          select coalesce(sum(amount), 0)::numeric
          from public.bill_payments
          where bill_id = $1
            and coalesce(status, 'active') = 'active'
            and "date" <= $2
            and (voided_at is null or voided_at::date > $2)
        $q$ into v_paid using p_bill_id, p_as_of;
      else
        execute $q$
          select coalesce(sum(amount), 0)::numeric
          from public.bill_payments
          where bill_id = $1
            and coalesce(status, 'active') = 'active'
            and "date" <= $2
        $q$ into v_paid using p_bill_id, p_as_of;
      end if;
    elsif public.acct_table_has_column('bill_payments', 'paid_at') then
      execute $q$
        select coalesce(sum(amount), 0)::numeric
        from public.bill_payments
        where bill_id = $1
          and coalesce(status, 'active') = 'active'
          and paid_at <= $2
      $q$ into v_paid using p_bill_id, p_as_of;
    end if;
  exception
    when undefined_table then
      v_paid := 0;
    when undefined_column then
      raise exception 'INV_ACCT_REPORT_ERROR: bill_payments date columns missing for bill %', p_bill_id;
  end;

  v_balance := greatest(0, public.acct_round2(coalesce(v_orig, 0) - coalesce(v_paid, 0)));

  return jsonb_build_object(
    'ok', true,
    'bill_id', p_bill_id,
    'as_of', p_as_of,
    'bill_date', v_bill_date,
    'original', public.acct_round2(coalesce(v_orig, 0)),
    'payments', public.acct_round2(coalesce(v_paid, 0)),
    'balance', v_balance,
    'provenance', 'ap_bill_original_total',
    'limitation_code', null,
    'error', null
  );
end;
$$;

comment on function public.acct_bill_remaining_as_of(uuid, date) is
  'Historical AP as-of jsonb using immutable ap_bill_original_total for open/void bills. '
  'voided after as-of: include historically. INTERNAL (service_role).';

-- ---------------------------------------------------------------------------
-- 12) AP aging — SET-BASED (bills ledger only; no installer_bills double count)
-- ---------------------------------------------------------------------------
create or replace function public.acct_report_ap_aging(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_totals jsonb;
  v_total numeric := 0;
  v_books jsonb;
  v_limitations jsonb := '[]'::jsonb;
  v_status text := 'OK';
  v_unsupported int := 0;
begin
  perform public.acct_report_require_finance();
  if p_as_of is null then
    raise exception 'ACCT_REPORT_AS_OF_REQUIRED';
  end if;
  v_books := public.acct_books_status();

  with base as (
    select
      b.id,
      b.bill_number,
      b.bill_date,
      coalesce(b.due_date, b.bill_date) as due_anchor,
      b.ap_lifecycle::text as life,
      b.voided_at,
      b.activated_at,
      b.source_type
    from public.bills b
  ),
  originals as (
    select
      bi.bill_id,
      public.acct_round2(coalesce(sum(public.ap_line_total(bi.quantity, bi.unit_cost)), 0)) as original
    from public.bill_items bi
    group by bi.bill_id
  ),
  pays as (
    select
      bp.bill_id,
      public.acct_round2(coalesce(sum(bp.amount), 0)) as paid
    from public.bill_payments bp
    where coalesce(bp.status, 'active') = 'active'
      and bp."date" <= p_as_of
      and (bp.voided_at is null or bp.voided_at::date > p_as_of)
    group by bp.bill_id
  ),
  classified as (
    select
      b.id,
      b.bill_number,
      b.due_anchor,
      case
        when b.life is null or b.life not in ('open', 'void') then
          case when b.life = 'draft' then 'DRAFT' else 'HISTORICAL_AP_UNSUPPORTED' end
        when b.bill_date is not null and b.bill_date > p_as_of then 'NOT_OPEN_YET'
        when b.activated_at is not null and b.activated_at::date > p_as_of then 'NOT_OPEN_YET'
        when b.life = 'void' and (b.voided_at is null or b.voided_at::date <= p_as_of) then 'VOIDED_AS_OF'
        when b.voided_at is not null and b.voided_at::date <= p_as_of then 'VOIDED_AS_OF'
        else null
      end as limitation_code,
      case
        when b.life is null or b.life not in ('open', 'void') then null::numeric
        when b.bill_date is not null and b.bill_date > p_as_of then 0::numeric
        when b.activated_at is not null and b.activated_at::date > p_as_of then 0::numeric
        when b.life = 'void' and (b.voided_at is null or b.voided_at::date <= p_as_of) then 0::numeric
        when b.voided_at is not null and b.voided_at::date <= p_as_of then 0::numeric
        else greatest(0, public.acct_round2(coalesce(o.original, 0) - coalesce(p.paid, 0)))
      end as balance
    from base b
    left join originals o on o.bill_id = b.id
    left join pays p on p.bill_id = b.id
  ),
  scored as (
    select
      *,
      case
        when limitation_code in ('HISTORICAL_AP_UNSUPPORTED') then true
        when limitation_code is not null and limitation_code not in ('NOT_OPEN_YET', 'VOIDED_AS_OF', 'DRAFT') then true
        when balance is null then true
        else false
      end as is_unsupported
    from classified
  ),
  lim as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bill_id', id,
          'reference', coalesce(bill_number, left(id::text, 8)),
          'limitation_code', limitation_code
        )
        order by bill_number nulls last
      ) filter (where is_unsupported),
      '[]'::jsonb
    ) as limitations,
    count(*) filter (where is_unsupported)::int as unsupported_count
    from scored
  ),
  aged as (
    select
      id as source_id,
      coalesce(bill_number, left(id::text, 8)) as reference,
      due_anchor as due_date,
      balance,
      greatest(0, (p_as_of - coalesce(due_anchor, p_as_of)))::int as days_past_due,
      case
        when (p_as_of - coalesce(due_anchor, p_as_of)) <= 0 then 'current'
        when (p_as_of - coalesce(due_anchor, p_as_of)) <= 30 then '1-30'
        when (p_as_of - coalesce(due_anchor, p_as_of)) <= 60 then '31-60'
        when (p_as_of - coalesce(due_anchor, p_as_of)) <= 90 then '61-90'
        else '90+'
      end as bucket
    from scored
    where not is_unsupported
      and coalesce(balance, 0) > 0.005
      and coalesce(limitation_code, '') not in ('NOT_OPEN_YET', 'VOIDED_AS_OF', 'DRAFT')
  )
  select
    coalesce(jsonb_agg(to_jsonb(a) order by a.days_past_due desc, a.reference), '[]'::jsonb),
    public.acct_round2(coalesce(sum(a.balance), 0)),
    jsonb_build_object(
      'current', public.acct_round2(coalesce(sum(a.balance) filter (where a.bucket = 'current'), 0)),
      '1-30', public.acct_round2(coalesce(sum(a.balance) filter (where a.bucket = '1-30'), 0)),
      '31-60', public.acct_round2(coalesce(sum(a.balance) filter (where a.bucket = '31-60'), 0)),
      '61-90', public.acct_round2(coalesce(sum(a.balance) filter (where a.bucket = '61-90'), 0)),
      '90+', public.acct_round2(coalesce(sum(a.balance) filter (where a.bucket = '90+'), 0))
    ),
    (select limitations from lim),
    (select unsupported_count from lim)
  into v_rows, v_total, v_totals, v_limitations, v_unsupported
  from aged a;

  if coalesce(v_unsupported, 0) > 0 then
    v_status := 'PARTIAL';
  end if;

  return jsonb_build_object(
    'as_of', p_as_of,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'totals', coalesce(v_totals, jsonb_build_object(
      'current', 0, '1-30', 0, '31-60', 0, '61-90', 0, '90+', 0
    )),
    'total', coalesce(v_total, 0),
    'limitations', coalesce(v_limitations, '[]'::jsonb),
    'status', v_status,
    'performance', 'set_based',
    'ledger', 'bills',
    'books_status', v_books,
    'label', 'AP_AGING'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 13) Control reconciliations
-- ---------------------------------------------------------------------------
create or replace function public.acct_recon_ar_control(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_posting boolean := false;
  v_ar_id uuid;
  v_ops numeric := 0;
  v_gl numeric := 0;
  v_diff numeric;
  v_status text;
begin
  perform public.acct_report_require_finance();
  if p_as_of is null then
    raise exception 'ACCT_REPORT_AS_OF_REQUIRED';
  end if;

  select coalesce(posting_enabled, false) into v_posting
  from public.accounting_settings where id = 1;

  v_ar_id := public.acct_mapped_account_id('accounts_receivable');

  select public.acct_round2(coalesce(sum((s.snap->>'balance')::numeric), 0))
  into v_ops
  from public.invoices i
  cross join lateral (
    select public.acct_invoice_open_ar_as_of(i.id, p_as_of) as snap
  ) s
  where s.snap->>'balance' is not null
    and coalesce(s.snap->>'limitation_code', '')
      is distinct from 'HISTORICAL_COMMERCIAL_UNSUPPORTED';

  if v_ar_id is null then
    return jsonb_build_object(
      'as_of', p_as_of,
      'operational_ar', v_ops,
      'gl_ar', null,
      'difference', null,
      'status', 'NOT_ACTIVE',
      'message', 'accounts_receivable mapping missing or posting inactive.',
      'label', 'RECON_AR_CONTROL'
    );
  end if;

  v_gl := public.acct_gl_account_balance_as_of(v_ar_id, p_as_of);
  v_diff := public.acct_round2(v_ops - v_gl);

  if not coalesce(v_posting, false) then
    v_status := 'NOT_ACTIVE';
  elsif abs(v_diff) <= 0.02 then
    v_status := 'PASS';
  else
    v_status := 'DIFF';
  end if;

  return jsonb_build_object(
    'as_of', p_as_of,
    'operational_ar', v_ops,
    'gl_ar', v_gl,
    'difference', v_diff,
    'status', v_status,
    'posting_enabled', v_posting,
    'label', 'RECON_AR_CONTROL'
  );
end;
$$;

create or replace function public.acct_recon_ap_control(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_posting boolean := false;
  v_ap_id uuid;
  v_ops numeric := 0;
  v_gl numeric := 0;
  v_diff numeric;
  v_status text;
begin
  perform public.acct_report_require_finance();
  if p_as_of is null then
    raise exception 'ACCT_REPORT_AS_OF_REQUIRED';
  end if;

  select coalesce(posting_enabled, false) into v_posting
  from public.accounting_settings where id = 1;

  v_ap_id := public.acct_mapped_account_id('accounts_payable');

  select public.acct_round2(coalesce(sum((s.snap->>'balance')::numeric), 0))
  into v_ops
  from public.bills b
  cross join lateral (
    select public.acct_bill_remaining_as_of(b.id, p_as_of) as snap
  ) s
  where coalesce(b.ap_lifecycle, 'active') not in ('draft')
    and s.snap->>'balance' is not null
    and coalesce((s.snap->>'ok')::boolean, false);

  if v_ap_id is null then
    return jsonb_build_object(
      'as_of', p_as_of,
      'operational_ap', v_ops,
      'gl_ap', null,
      'difference', null,
      'status', 'NOT_ACTIVE',
      'message', 'accounts_payable mapping missing or posting inactive.',
      'label', 'RECON_AP_CONTROL'
    );
  end if;

  v_gl := public.acct_gl_account_balance_as_of(v_ap_id, p_as_of);
  v_diff := public.acct_round2(v_ops - v_gl);

  if not coalesce(v_posting, false) then
    v_status := 'NOT_ACTIVE';
  elsif abs(v_diff) <= 0.02 then
    v_status := 'PASS';
  else
    v_status := 'DIFF';
  end if;

  return jsonb_build_object(
    'as_of', p_as_of,
    'operational_ap', v_ops,
    'gl_ap', v_gl,
    'difference', v_diff,
    'status', v_status,
    'posting_enabled', v_posting,
    'label', 'RECON_AP_CONTROL'
  );
end;
$$;

create or replace function public.acct_recon_inventory_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_inv_posting boolean := false;
  v_inv_id uuid;
  v_ops numeric := 0;
  v_gl numeric := 0;
  v_diff numeric;
  v_status text;
  v_as_of date := (timezone('utc', now()))::date;
begin
  perform public.acct_report_require_finance();

  select coalesce(inventory_posting_enabled, false) into v_inv_posting
  from public.accounting_settings where id = 1;

  select public.acct_round2(coalesce(sum(coalesce(inventory_carrying_value, 0)), 0))
  into v_ops
  from public.products;

  v_inv_id := public.acct_mapped_account_id('inventory_asset');

  if not coalesce(v_inv_posting, false) or v_inv_id is null then
    return jsonb_build_object(
      'as_of', v_as_of,
      'operational_inventory', v_ops,
      'gl_inventory', case when v_inv_id is null then null else public.acct_gl_account_balance_as_of(v_inv_id, v_as_of) end,
      'difference', null,
      'status', 'NOT_ACTIVE',
      'inventory_posting_enabled', coalesce(v_inv_posting, false),
      'message', 'inventory_posting_enabled is false or inventory_asset unmapped.',
      'label', 'RECON_INVENTORY_CONTROL'
    );
  end if;

  v_gl := public.acct_gl_account_balance_as_of(v_inv_id, v_as_of);
  v_diff := public.acct_round2(v_ops - v_gl);
  v_status := case when abs(v_diff) <= 0.02 then 'PASS' else 'DIFF' end;

  return jsonb_build_object(
    'as_of', v_as_of,
    'operational_inventory', v_ops,
    'gl_inventory', v_gl,
    'difference', v_diff,
    'status', v_status,
    'inventory_posting_enabled', true,
    'label', 'RECON_INVENTORY_CONTROL'
  );
end;
$$;

create or replace function public.acct_recon_cash_book(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cash_id uuid;
  v_undeposited_id uuid;
  v_cash numeric := 0;
  v_undeposited numeric := 0;
  v_posting boolean := false;
  v_status text;
begin
  perform public.acct_report_require_finance();
  if p_as_of is null then
    raise exception 'ACCT_REPORT_AS_OF_REQUIRED';
  end if;

  select coalesce(posting_enabled, false) into v_posting
  from public.accounting_settings where id = 1;

  v_cash_id := public.acct_mapped_account_id('cash_operating');
  v_undeposited_id := public.acct_mapped_account_id('undeposited_funds');

  if v_cash_id is not null then
    v_cash := public.acct_gl_account_balance_as_of(v_cash_id, p_as_of);
  end if;
  if v_undeposited_id is not null then
    v_undeposited := public.acct_gl_account_balance_as_of(v_undeposited_id, p_as_of);
  end if;

  if not coalesce(v_posting, false) then
    v_status := 'NOT_ACTIVE';
  elsif v_cash_id is null and v_undeposited_id is null then
    v_status := 'NOT_ACTIVE';
  else
    v_status := 'PASS';
  end if;

  return jsonb_build_object(
    'as_of', p_as_of,
    'cash_operating', v_cash,
    'undeposited_funds', v_undeposited,
    'book_cash_total', public.acct_round2(v_cash + v_undeposited),
    'status', v_status,
    'posting_enabled', v_posting,
    'note', 'GL cash book balances only — not bank statement reconciliation.',
    'label', 'RECON_CASH_BOOK'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 14) Journal integrity + exceptions
-- ---------------------------------------------------------------------------
create or replace function public.acct_journal_integrity_scan()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_unbalanced jsonb := '[]'::jsonb;
  v_orphans jsonb := '[]'::jsonb;
  v_unbal_count int := 0;
  v_orphan_count int := 0;
begin
  perform public.acct_report_require_finance();

  select
    coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb),
    count(*)::int
  into v_unbalanced, v_unbal_count
  from (
    select
      je.id as journal_entry_id,
      je.entry_date,
      je.source_type,
      je.source_id,
      public.acct_round2(sum(jl.debit)) as total_debit,
      public.acct_round2(sum(jl.credit)) as total_credit,
      public.acct_round2(sum(jl.debit) - sum(jl.credit)) as difference
    from public.journal_entries je
    join public.journal_lines jl on jl.journal_entry_id = je.id
    where je.status = 'posted'
    group by je.id, je.entry_date, je.source_type, je.source_id
    having abs(sum(jl.debit) - sum(jl.credit)) > 0.005
    order by je.entry_date desc
    limit 200
  ) x;

  select
    coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb),
    count(*)::int
  into v_orphans, v_orphan_count
  from (
    select jl.id as journal_line_id, jl.journal_entry_id, jl.account_id
    from public.journal_lines jl
    left join public.journal_entries je on je.id = jl.journal_entry_id
    where je.id is null
    limit 200
  ) x;

  return jsonb_build_object(
    'unbalanced_posted_journals', coalesce(v_unbalanced, '[]'::jsonb),
    'unbalanced_count', coalesce(v_unbal_count, 0),
    'orphan_lines', coalesce(v_orphans, '[]'::jsonb),
    'orphan_count', coalesce(v_orphan_count, 0),
    'ok', coalesce(v_unbal_count, 0) = 0 and coalesce(v_orphan_count, 0) = 0,
    'label', 'JOURNAL_INTEGRITY_SCAN'
  );
end;
$$;

create or replace function public.acct_exceptions_scan()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_as_of date := (timezone('utc', now()))::date;
  v_integrity jsonb;
  v_ar jsonb;
  v_ap jsonb;
  v_inv jsonb;
  v_cash jsonb;
  v_tb jsonb;
  v_bs jsonb;
  v_items jsonb := '[]'::jsonb;
  v_posting boolean := false;
begin
  perform public.acct_report_require_finance();

  select coalesce(posting_enabled, false) into v_posting
  from public.accounting_settings where id = 1;

  v_integrity := public.acct_journal_integrity_scan();
  v_ar := public.acct_recon_ar_control(v_as_of);
  v_ap := public.acct_recon_ap_control(v_as_of);
  v_inv := public.acct_recon_inventory_control();
  v_cash := public.acct_recon_cash_book(v_as_of);
  v_tb := public.acct_report_trial_balance_as_of(v_as_of);
  v_bs := public.acct_report_balance_sheet(v_as_of);

  if coalesce((v_integrity->>'unbalanced_count')::int, 0) > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'UNBALANCED_JOURNALS',
      'severity', 'CRITICAL',
      'message', format('%s unbalanced posted journal(s).', v_integrity->>'unbalanced_count'),
      'detail', v_integrity->'unbalanced_posted_journals'
    ));
  end if;

  if coalesce((v_integrity->>'orphan_count')::int, 0) > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'ORPHAN_JOURNAL_LINES',
      'severity', 'CRITICAL',
      'message', format('%s orphan journal line(s).', v_integrity->>'orphan_count')
    ));
  end if;

  if coalesce((v_tb->>'balanced')::boolean, true) is false then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'TRIAL_BALANCE_OUT',
      'severity', 'CRITICAL',
      'message', v_tb->>'critical_error'
    ));
  end if;

  if coalesce((v_bs->>'balanced')::boolean, true) is false then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'BALANCE_SHEET_OUT',
      'severity', 'CRITICAL',
      'message', v_bs->>'critical_error'
    ));
  end if;

  if v_ar->>'status' = 'DIFF' then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'AR_CONTROL_DIFF',
      'severity', case when v_posting then 'HIGH' else 'WARNING' end,
      'message', 'Operational AR differs from GL AR control.',
      'detail', v_ar
    ));
  elsif v_ar->>'status' = 'NOT_ACTIVE' then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'AR_CONTROL_NOT_ACTIVE',
      'severity', 'EXPECTED_NOT_ACTIVE',
      'message', 'AR control recon not active while posting is off or mapping missing.',
      'detail', v_ar
    ));
  end if;

  if v_ap->>'status' = 'DIFF' then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'AP_CONTROL_DIFF',
      'severity', case when v_posting then 'HIGH' else 'WARNING' end,
      'message', 'Operational AP differs from GL AP control.',
      'detail', v_ap
    ));
  elsif v_ap->>'status' = 'NOT_ACTIVE' then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'AP_CONTROL_NOT_ACTIVE',
      'severity', 'EXPECTED_NOT_ACTIVE',
      'message', 'AP control recon not active while posting is off or mapping missing.',
      'detail', v_ap
    ));
  end if;

  if v_inv->>'status' = 'DIFF' then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'INVENTORY_CONTROL_DIFF',
      'severity', 'HIGH',
      'message', 'Inventory carrying value differs from GL inventory_asset.',
      'detail', v_inv
    ));
  elsif v_inv->>'status' = 'NOT_ACTIVE' then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'INVENTORY_CONTROL_NOT_ACTIVE',
      'severity', 'EXPECTED_NOT_ACTIVE',
      'message', 'Inventory control recon not active (inventory_posting_enabled false).',
      'detail', v_inv
    ));
  end if;

  if v_cash->>'status' = 'NOT_ACTIVE' then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'CASH_BOOK_NOT_ACTIVE',
      'severity', 'EXPECTED_NOT_ACTIVE',
      'message', 'Cash book recon informational while posting is off.',
      'detail', v_cash
    ));
  end if;

  return jsonb_build_object(
    'as_of', v_as_of,
    'exceptions', v_items,
    'counts', jsonb_build_object(
      'critical', (
        select count(*) from jsonb_array_elements(v_items) e
        where e->>'severity' = 'CRITICAL'
      ),
      'high', (
        select count(*) from jsonb_array_elements(v_items) e
        where e->>'severity' = 'HIGH'
      ),
      'warning', (
        select count(*) from jsonb_array_elements(v_items) e
        where e->>'severity' = 'WARNING'
      ),
      'expected_not_active', (
        select count(*) from jsonb_array_elements(v_items) e
        where e->>'severity' = 'EXPECTED_NOT_ACTIVE'
      )
    ),
    'integrity', v_integrity,
    'recons', jsonb_build_object(
      'ar', v_ar,
      'ap', v_ap,
      'inventory', v_inv,
      'cash', v_cash
    ),
    'label', 'ACCT_EXCEPTIONS_SCAN'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 15) Cutover readiness snapshot (evaluate only — never mutate settings)
-- ---------------------------------------------------------------------------
create or replace function public.acct_cutover_readiness_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.accounting_settings%rowtype;
  v_as_of date := (timezone('utc', now()))::date;
  v_tb jsonb;
  v_bs jsonb;
  v_blockers text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
  v_sys_missing text[] := array[]::text[];
  v_pm_missing text[] := array[]::text[];
  v_failed_outbox int := 0;
  v_pending_critical int := 0;
  v_pitr_confirmed boolean := false;
  v_verdict text := 'NOT_READY';
  v_required text[] := array[
    'accounts_receivable', 'accounts_payable', 'sales_tax_payable',
    'cash_operating', 'undeposited_funds', 'customer_deposits',
    'customer_credit_liability', 'default_sales_revenue',
    'opening_balance_equity', 'bad_debt_expense'
  ];
  v_key text;
begin
  perform public.acct_report_require_finance();

  select * into s from public.accounting_settings where id = 1;

  foreach v_key in array v_required loop
    if public.acct_mapped_account_id(v_key) is null then
      v_sys_missing := array_append(v_sys_missing, v_key);
    end if;
  end loop;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'accounting_payment_method_mappings'
  ) then
    select coalesce(array_agg(m), array[]::text[])
    into v_pm_missing
    from unnest(array['card','cash','check','echeck','financing','link','other']) m
    where not exists (
      select 1 from public.accounting_payment_method_mappings p
      where p.payment_method::text = m
    );
  end if;

  select count(*)::int into v_failed_outbox
  from public.accounting_posting_outbox
  where status = 'error';

  select count(*)::int into v_pending_critical
  from public.accounting_posting_outbox
  where status in ('pending', 'error');

  v_pitr_confirmed := (s.backup_pitr_confirmed_at is not null);
  v_tb := public.acct_report_trial_balance_as_of(v_as_of);
  v_bs := public.acct_report_balance_sheet(v_as_of);

  if cardinality(v_sys_missing) > 0 then
    v_blockers := array_append(v_blockers, 'System account mappings incomplete.');
  end if;
  if cardinality(v_pm_missing) > 0 then
    v_blockers := array_append(v_blockers, 'Payment method mappings incomplete.');
  end if;
  if s.cutover_date is null then
    v_blockers := array_append(v_blockers, 'Cutover date not set.');
  end if;
  if not coalesce(s.opening_balances_entered, false) then
    v_blockers := array_append(v_blockers, 'Opening balances not entered.');
  end if;
  if coalesce((v_tb->>'balanced')::boolean, true) is false then
    v_blockers := array_append(v_blockers, 'Trial Balance unbalanced.');
  end if;
  if coalesce((v_bs->>'balanced')::boolean, true) is false then
    v_blockers := array_append(v_blockers, 'Balance Sheet unbalanced.');
  end if;
  if v_failed_outbox > 0 then
    v_blockers := array_append(v_blockers, format('%s failed accounting outbox event(s).', v_failed_outbox));
  end if;
  if v_pending_critical > 0 then
    v_blockers := array_append(v_blockers, format('%s pending/error outbox event(s).', v_pending_critical));
  end if;
  if coalesce(s.books_of_record, false) then
    v_blockers := array_append(v_blockers, 'books_of_record is already true — unexpected during readiness evaluation.');
  end if;
  if not v_pitr_confirmed then
    v_warnings := array_append(v_warnings, 'Backup/PITR owner confirmation still required (external).');
  end if;
  if not coalesce(s.accountant_validated, false) then
    v_warnings := array_append(v_warnings, 'Accountant/owner sign-off required before READY_FOR_CUTOVER.');
  end if;
  if not coalesce(s.posting_enabled, false) then
    v_warnings := array_append(v_warnings, 'posting_enabled is still false — enable only for controlled pilot.');
  end if;

  -- Expected while flags off / PITR unconfirmed.
  if cardinality(v_blockers) > 0 or not v_pitr_confirmed then
    v_verdict := 'NOT_READY';
  elsif not coalesce(s.accountant_validated, false) then
    v_verdict := 'READY_FOR_PILOT';
  else
    v_verdict := 'READY_FOR_CUTOVER';
  end if;

  return jsonb_build_object(
    'verdict', v_verdict,
    'pitr_status', case when v_pitr_confirmed then 'CONFIRMED' else 'NOT CONFIRMED' end,
    'flags', jsonb_build_object(
      'posting_enabled', coalesce(s.posting_enabled, false),
      'inventory_posting_enabled', coalesce(s.inventory_posting_enabled, false),
      'books_of_record', coalesce(s.books_of_record, false),
      'opening_balances_entered', coalesce(s.opening_balances_entered, false),
      'accountant_validated', coalesce(s.accountant_validated, false),
      'cutover_date', s.cutover_date,
      'installer_posting_enabled', coalesce(s.installer_posting_enabled, false)
    ),
    'missing_system_mappings', to_jsonb(v_sys_missing),
    'missing_payment_method_mappings', to_jsonb(coalesce(v_pm_missing, array[]::text[])),
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings),
    'trial_balance_balanced', coalesce((v_tb->>'balanced')::boolean, true),
    'balance_sheet_balanced', coalesce((v_bs->>'balanced')::boolean, true),
    'failed_outbox_count', v_failed_outbox,
    'pending_outbox_count', v_pending_critical,
    'mutated_settings', false,
    'label', 'ACCT_CUTOVER_READINESS'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 16) Period close readiness (internal)
-- Outbox eligibility is PERIOD-SCOPED by payload.economicEventDate.
-- Malformed/missing dates fail closed (OUTBOX_EVENT_DATE_UNRESOLVED).
-- Future-period pending events do not block closing an earlier period.
-- ---------------------------------------------------------------------------
create or replace function public.acct_parse_outbox_economic_date(p_payload jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_raw text;
  v_date date;
begin
  v_raw := nullif(trim(coalesce(p_payload->>'economicEventDate', '')), '');
  if v_raw is null then
    return jsonb_build_object('ok', false, 'code', 'OUTBOX_EVENT_DATE_UNRESOLVED');
  end if;
  begin
    v_date := v_raw::date;
  exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'OUTBOX_EVENT_DATE_UNRESOLVED');
  end;
  if v_date is null then
    return jsonb_build_object('ok', false, 'code', 'OUTBOX_EVENT_DATE_UNRESOLVED');
  end if;
  return jsonb_build_object('ok', true, 'date', v_date::text);
end;
$$;

comment on function public.acct_parse_outbox_economic_date(jsonb) is
  'INTERNAL: safe economicEventDate parse for close readiness. Never silent-exclude.';

create or replace function public.acct_period_close_readiness(p_period_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period public.accounting_periods%rowtype;
  v_tb jsonb;
  v_bs jsonb;
  v_failed int := 0;
  v_pending int := 0;
  v_unresolved int := 0;
  v_blockers text[] := array[]::text[];
  v_row record;
  v_parsed jsonb;
  v_econ date;
begin
  select * into v_period from public.accounting_periods where id = p_period_id;
  if not found then
    return jsonb_build_object('ready', false, 'blockers', jsonb_build_array('Period not found.'));
  end if;
  if v_period.status = 'locked' then
    return jsonb_build_object('ready', false, 'blockers', jsonb_build_array('Period is locked.'));
  end if;
  if v_period.status = 'closed' then
    return jsonb_build_object('ready', true, 'blockers', '[]'::jsonb, 'already_closed', true);
  end if;

  v_tb := public.acct_report_trial_balance_as_of(v_period.end_date);
  v_bs := public.acct_report_balance_sheet(v_period.end_date);

  -- Unprocessed / failed outbox rows: scope by economicEventDate into this period.
  -- Unresolvable dates block ANY close (fail closed — do not guess period).
  for v_row in
    select o.id, o.status, o.payload
    from public.accounting_posting_outbox o
    where o.status in ('pending', 'processing', 'error', 'failed', 'review_required')
  loop
    v_parsed := public.acct_parse_outbox_economic_date(v_row.payload);
    if coalesce((v_parsed->>'ok')::boolean, false) is not true then
      v_unresolved := v_unresolved + 1;
      continue;
    end if;
    -- Date already validated by parser; cast from ISO text is safe.
    v_econ := (v_parsed->>'date')::date;
    if v_econ < v_period.start_date or v_econ > v_period.end_date then
      continue; -- other period; do not block this close
    end if;
    if v_row.status in ('error', 'failed') then
      v_failed := v_failed + 1;
    else
      v_pending := v_pending + 1;
    end if;
  end loop;

  if v_unresolved > 0 then
    v_blockers := array_append(v_blockers, 'OUTBOX_EVENT_DATE_UNRESOLVED');
  end if;
  if v_failed > 0 then
    v_blockers := array_append(v_blockers, 'Failed accounting events exist for this period.');
  end if;
  if v_pending > 0 then
    v_blockers := array_append(v_blockers, 'Pending accounting events exist for this period.');
  end if;
  if coalesce((v_tb->>'balanced')::boolean, true) is false then
    v_blockers := array_append(v_blockers, 'Trial Balance unbalanced.');
  end if;
  if coalesce((v_bs->>'balanced')::boolean, true) is false then
    v_blockers := array_append(v_blockers, 'Balance Sheet unbalanced.');
  end if;

  return jsonb_build_object(
    'ready', cardinality(v_blockers) = 0,
    'blockers', to_jsonb(v_blockers),
    'period_id', p_period_id,
    'start_date', v_period.start_date,
    'end_date', v_period.end_date,
    'period_pending_outbox', v_pending,
    'period_failed_outbox', v_failed,
    'unresolved_outbox_dates', v_unresolved
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 17) Period close / reopen / lock (admin, idempotent, audited)
-- ---------------------------------------------------------------------------
create or replace function public.acct_period_close_safe(
  p_period_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_hash text;
  v_dup jsonb;
  v_period public.accounting_periods%rowtype;
  v_ready jsonb;
  v_result jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.acct_require_admin('close accounting periods');
  v_actor := public.accounting_actor_id(p_created_by);

  if p_period_id is null then
    raise exception 'ACCT_PERIOD_ID_REQUIRED';
  end if;
  if v_reason is null then
    raise exception 'ACCT_PERIOD_CLOSE_REASON_REQUIRED';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'ACCT_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_hash := public.acct_control_context_hash(
    'period_close',
    jsonb_build_object('period_id', p_period_id, 'reason', v_reason)
  );
  v_dup := public.acct_control_begin_action(p_idempotency_key, 'period_close', v_hash);
  if v_dup is not null then
    return v_dup;
  end if;

  select * into v_period
  from public.accounting_periods
  where id = p_period_id
  for update;

  if not found then
    raise exception 'ACCT_PERIOD_NOT_FOUND';
  end if;

  if v_period.status = 'locked' then
    raise exception 'ACCT_PERIOD_LOCKED: cannot close a locked period.';
  end if;

  if v_period.status = 'closed' then
    v_result := jsonb_build_object(
      'ok', true,
      'period_id', p_period_id,
      'status', 'closed',
      'already_closed', true,
      'duplicate', false
    );
    return public.acct_control_complete_action(p_idempotency_key, 'period_close', v_hash, v_result);
  end if;

  -- Final readiness WHILE holding period FOR UPDATE.
  -- Writers (post_journal + enqueue_accounting_outbox_safe) take the same row
  -- lock first, so no same-period event can become eligible mid-close.
  v_ready := public.acct_period_close_readiness(p_period_id);
  if coalesce((v_ready->>'ready')::boolean, false) is not true then
    raise exception 'ACCT_PERIOD_CLOSE_NOT_READY: %', v_ready->>'blockers';
  end if;

  update public.accounting_periods
  set status = 'closed',
      closed_at = now(),
      closed_by = v_actor,
      close_reason = v_reason,
      reopen_reason = null,
      reopened_at = null,
      reopened_by = null
  where id = p_period_id;

  if public.acct_function_exists('accounting_audit_from_definer_safe') then
    perform public.accounting_audit_from_definer_safe(
      'period_closed',
      'accounting_period',
      p_period_id,
      v_period.end_date,
      v_reason,
      jsonb_build_object('label', v_period.label, 'start_date', v_period.start_date, 'end_date', v_period.end_date),
      v_actor,
      'audit:period_close:' || p_period_id::text || ':' || p_idempotency_key
    );
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'period_id', p_period_id,
    'status', 'closed',
    'closed_at', now(),
    'closed_by', v_actor,
    'close_reason', v_reason
  );
  return public.acct_control_complete_action(p_idempotency_key, 'period_close', v_hash, v_result);
end;
$$;

create or replace function public.acct_period_reopen_safe(
  p_period_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_hash text;
  v_dup jsonb;
  v_period public.accounting_periods%rowtype;
  v_result jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.acct_require_admin('reopen accounting periods');
  v_actor := public.accounting_actor_id(p_created_by);

  if p_period_id is null then
    raise exception 'ACCT_PERIOD_ID_REQUIRED';
  end if;
  if v_reason is null then
    raise exception 'ACCT_PERIOD_REOPEN_REASON_REQUIRED';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'ACCT_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_hash := public.acct_control_context_hash(
    'period_reopen',
    jsonb_build_object('period_id', p_period_id, 'reason', v_reason)
  );
  v_dup := public.acct_control_begin_action(p_idempotency_key, 'period_reopen', v_hash);
  if v_dup is not null then
    return v_dup;
  end if;

  select * into v_period
  from public.accounting_periods
  where id = p_period_id
  for update;

  if not found then
    raise exception 'ACCT_PERIOD_NOT_FOUND';
  end if;
  if v_period.status = 'locked' then
    raise exception 'ACCT_PERIOD_LOCKED: unlock/admin workflow required before reopen.';
  end if;
  if v_period.status = 'open' then
    v_result := jsonb_build_object(
      'ok', true,
      'period_id', p_period_id,
      'status', 'open',
      'already_open', true
    );
    return public.acct_control_complete_action(p_idempotency_key, 'period_reopen', v_hash, v_result);
  end if;
  if v_period.status is distinct from 'closed' then
    raise exception 'ACCT_PERIOD_REOPEN_INVALID_STATUS: %', v_period.status;
  end if;

  -- closed → open; preserve closed_at / closed_by / close_reason as history
  update public.accounting_periods
  set status = 'open',
      reopen_reason = v_reason,
      reopened_at = now(),
      reopened_by = v_actor
  where id = p_period_id;

  if public.acct_function_exists('accounting_audit_from_definer_safe') then
    perform public.accounting_audit_from_definer_safe(
      'period_reopened',
      'accounting_period',
      p_period_id,
      v_period.end_date,
      v_reason,
      jsonb_build_object(
        'prior_closed_at', v_period.closed_at,
        'prior_closed_by', v_period.closed_by,
        'prior_close_reason', v_period.close_reason,
        'label', v_period.label
      ),
      v_actor,
      'audit:period_reopen:' || p_period_id::text || ':' || p_idempotency_key
    );
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'period_id', p_period_id,
    'status', 'open',
    'reopened_at', now(),
    'reopened_by', v_actor,
    'reopen_reason', v_reason,
    'prior_close_preserved', true
  );
  return public.acct_control_complete_action(p_idempotency_key, 'period_reopen', v_hash, v_result);
end;
$$;

create or replace function public.acct_period_lock_safe(
  p_period_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_hash text;
  v_dup jsonb;
  v_period public.accounting_periods%rowtype;
  v_result jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.acct_require_admin('lock accounting periods');
  v_actor := public.accounting_actor_id(p_created_by);

  if p_period_id is null then
    raise exception 'ACCT_PERIOD_ID_REQUIRED';
  end if;
  if v_reason is null then
    raise exception 'ACCT_PERIOD_LOCK_REASON_REQUIRED';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'ACCT_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_hash := public.acct_control_context_hash(
    'period_lock',
    jsonb_build_object('period_id', p_period_id, 'reason', v_reason)
  );
  v_dup := public.acct_control_begin_action(p_idempotency_key, 'period_lock', v_hash);
  if v_dup is not null then
    return v_dup;
  end if;

  select * into v_period
  from public.accounting_periods
  where id = p_period_id
  for update;

  if not found then
    raise exception 'ACCT_PERIOD_NOT_FOUND';
  end if;

  if v_period.status = 'locked' then
    v_result := jsonb_build_object(
      'ok', true,
      'period_id', p_period_id,
      'status', 'locked',
      'already_locked', true
    );
    return public.acct_control_complete_action(p_idempotency_key, 'period_lock', v_hash, v_result);
  end if;

  if v_period.status is distinct from 'closed' then
    raise exception 'ACCT_PERIOD_LOCK_REQUIRES_CLOSED: close the period before locking.';
  end if;

  update public.accounting_periods
  set status = 'locked',
      locked_at = now(),
      locked_by = v_actor
  where id = p_period_id;

  if public.acct_function_exists('accounting_audit_from_definer_safe') then
    perform public.accounting_audit_from_definer_safe(
      'period_locked',
      'accounting_period',
      p_period_id,
      v_period.end_date,
      v_reason,
      jsonb_build_object('label', v_period.label),
      v_actor,
      'audit:period_lock:' || p_period_id::text || ':' || p_idempotency_key
    );
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'period_id', p_period_id,
    'status', 'locked',
    'locked_at', now(),
    'locked_by', v_actor,
    'lock_reason', v_reason
  );
  return public.acct_control_complete_action(p_idempotency_key, 'period_lock', v_hash, v_result);
end;
$$;


-- ---------------------------------------------------------------------------
-- 17b) Canonical period lock for posting + outbox enqueue
-- POSTING: resolve period for entry_date → FOR UPDATE period row → assert open
-- OUTBOX: resolve period for economicEventDate → SAME FOR UPDATE → assert open → insert
-- CLOSE/LOCK/REOPEN: FOR UPDATE same period row first (existing RPCs)
-- Lock order: period row lock is taken inside post_journal / enqueue AFTER caller
-- domain locks (job/AP/inventory). Close only locks the period row (no domain
-- locks), so it cannot deadlock with inventory/AP (those wait on period after
-- domains).
-- ---------------------------------------------------------------------------
create or replace function public.acct_lock_period_for_posting(p_entry_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_status text;
begin
  if p_entry_date is null then
    return jsonb_build_object('ok', false, 'error', 'Entry date required.', 'code', 'ACCT_PERIOD_DATE_REQUIRED');
  end if;

  v_period_id := public.accounting_period_for_date(p_entry_date);
  if v_period_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'No accounting period covers this entry date.',
      'code', 'ACCT_PERIOD_NONE'
    );
  end if;

  select status into v_status
  from public.accounting_periods
  where id = v_period_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'No accounting period covers this entry date.',
      'code', 'ACCT_PERIOD_NONE'
    );
  end if;
  if v_status = 'locked' then
    return jsonb_build_object('ok', false, 'error', 'Accounting period is locked.', 'code', 'ACCT_PERIOD_LOCKED');
  end if;
  if v_status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'Accounting period is closed.', 'code', 'ACCT_PERIOD_CLOSED');
  end if;
  if v_status is distinct from 'open' then
    return jsonb_build_object(
      'ok', false,
      'error', format('Accounting period is not open (%s).', v_status),
      'code', 'ACCT_PERIOD_NOT_OPEN'
    );
  end if;

  return jsonb_build_object('ok', true, 'period_id', v_period_id, 'status', v_status);
end;
$$;

comment on function public.acct_lock_period_for_posting(date) is
  'INTERNAL: resolve period for entry_date, FOR UPDATE lock, assert open. '
  'Used by post_journal_entry_safe and enqueue_accounting_outbox_safe so '
  'posting/outbox cannot race period close.';


-- ---------------------------------------------------------------------------
-- 17c) Outbox enqueue — same period-row lock as post/close (0174 kinds preserved)
-- Canonical INSERT path for accounting_posting_outbox (all domain callers).
-- When posting_enabled is false: early null (no lock; no event created).
-- When posting enabled: lock period → insert → commit (serialize with close).
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
  v_period_gate jsonb;
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

  -- Same canonical period lock as post_journal / period close.
  -- Prevents stranded same-period outbox rows after close commits.
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

  return v_id;
end;
$$;

revoke all on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) from public;
revoke all on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) from anon;
revoke all on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) from authenticated;
grant execute on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) to service_role;

comment on function public.enqueue_accounting_outbox_safe(text, uuid, text, jsonb, boolean) is
  'Canonical outbox writer. Locks accounting_periods FOR UPDATE for economicEventDate '
  'before insert when posting is enabled — serializes with period close.';


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
  v_period_gate jsonb;
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

  -- TOCTOU-safe period gate: resolve + FOR UPDATE + assert open (row lock held until TX end).
  -- Compatible with acct_period_close_safe / reopen / lock which also FOR UPDATE the same row.
  v_period_gate := public.acct_lock_period_for_posting(p_entry_date);
  if coalesce((v_period_gate->>'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_period_gate->>'error', 'Accounting period not open for posting.'),
      'code', v_period_gate->>'code'
    );
  end if;
  v_period_id := (v_period_gate->>'period_id')::uuid;
  v_period_status := v_period_gate->>'status';

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

revoke all on function public.acct_lock_period_for_posting(date) from public;
revoke all on function public.acct_lock_period_for_posting(date) from anon;
revoke all on function public.acct_lock_period_for_posting(date) from authenticated;
grant execute on function public.acct_lock_period_for_posting(date) to service_role;

revoke all on function public.acct_parse_outbox_economic_date(jsonb) from public;
revoke all on function public.acct_parse_outbox_economic_date(jsonb) from anon;
revoke all on function public.acct_parse_outbox_economic_date(jsonb) from authenticated;
grant execute on function public.acct_parse_outbox_economic_date(jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 18) Concurrency-safe accounting period overlap + date validity
-- Existing (0161): accounting_periods_dates_chk CHECK (end_date >= start_date)
--                  start_date/end_date NOT NULL
-- UNIQUE (start_date, end_date) alone does NOT prevent partial overlaps.
-- Concurrent-safe guarantee: GiST EXCLUDE on inclusive daterange.
-- Trigger retained for friendly ACCT_PERIOD_OVERLAP errors + advisory serialize.
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist;

-- Fail closed if existing periods already overlap (do not silently mutate).
do $$
declare
  v_conflict record;
begin
  select
    a.id as a_id,
    a.label as a_label,
    a.start_date as a_start,
    a.end_date as a_end,
    b.id as b_id,
    b.label as b_label,
    b.start_date as b_start,
    b.end_date as b_end
  into v_conflict
  from public.accounting_periods a
  join public.accounting_periods b
    on a.id < b.id
   and daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]')
  limit 1;

  if found then
    raise exception
      'ACCT_PERIOD_OVERLAP_EXISTING: periods % (% %–%) and % (% %–%) overlap. Correct explicitly before applying 0177.',
      v_conflict.a_id, v_conflict.a_label, v_conflict.a_start, v_conflict.a_end,
      v_conflict.b_id, v_conflict.b_label, v_conflict.b_start, v_conflict.b_end;
  end if;
end $$;

-- Date validity already enforced by accounting_periods_dates_chk (end_date >= start_date)
-- and NOT NULL columns from 0161. Re-assert if missing (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'accounting_periods_dates_chk'
      and conrelid = 'public.accounting_periods'::regclass
  ) then
    alter table public.accounting_periods
      add constraint accounting_periods_dates_chk check (end_date >= start_date);
  end if;
end $$;

-- Concurrent-safe overlap exclusion (inclusive bounds match BETWEEN semantics).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'accounting_periods_daterange_excl'
      and conrelid = 'public.accounting_periods'::regclass
  ) then
    alter table public.accounting_periods
      add constraint accounting_periods_daterange_excl
      exclude using gist (
        daterange(start_date, end_date, '[]') with &&
      );
  end if;
end $$;

create or replace function public.acct_periods_prevent_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.start_date is null or new.end_date is null then
    raise exception 'ACCT_PERIOD_DATES_REQUIRED: start_date and end_date are required.';
  end if;
  if new.start_date > new.end_date then
    raise exception 'ACCT_PERIOD_DATE_ORDER: start_date % must be <= end_date %.',
      new.start_date, new.end_date;
  end if;

  -- Serialize calendar mutations in this TX (defense in depth with EXCLUDE).
  perform pg_advisory_xact_lock(178, 1);

  if exists (
    select 1
    from public.accounting_periods p
    where p.id is distinct from new.id
      and daterange(p.start_date, p.end_date, '[]') &&
          daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'ACCT_PERIOD_OVERLAP: period %–% overlaps an existing period.',
      new.start_date, new.end_date
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists accounting_periods_no_overlap on public.accounting_periods;
create trigger accounting_periods_no_overlap
  before insert or update of start_date, end_date
  on public.accounting_periods
  for each row
  execute function public.acct_periods_prevent_overlap();

comment on constraint accounting_periods_daterange_excl on public.accounting_periods is
  'Concurrency-safe: overlapping inclusive dateranges cannot both commit.';

-- ---------------------------------------------------------------------------
-- 19) GL account deactivate / upsert (no hard delete; protect system + types)
-- Deactivation preserves the row and ALL journal history for historical reports.
-- Reports include inactive accounts with posted activity (is_active = presentation).
-- account_type / subtype remain locked after journal_lines exist.
-- ---------------------------------------------------------------------------
create or replace function public.gl_account_deactivate_safe(
  p_account_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_hash text;
  v_dup jsonb;
  v_acct public.gl_accounts%rowtype;
  v_result jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.acct_require_admin('deactivate GL accounts');
  v_actor := public.accounting_actor_id(p_created_by);

  if p_account_id is null then
    raise exception 'GL_ACCOUNT_ID_REQUIRED';
  end if;
  if v_reason is null then
    raise exception 'GL_ACCOUNT_DEACTIVATE_REASON_REQUIRED';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'ACCT_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  v_hash := public.acct_control_context_hash(
    'gl_deactivate',
    jsonb_build_object('account_id', p_account_id, 'reason', v_reason)
  );
  v_dup := public.acct_control_begin_action(p_idempotency_key, 'gl_deactivate', v_hash);
  if v_dup is not null then
    return v_dup;
  end if;

  select * into v_acct from public.gl_accounts where id = p_account_id for update;
  if not found then
    raise exception 'GL_ACCOUNT_NOT_FOUND';
  end if;
  if coalesce(v_acct.is_system, false) then
    raise exception 'GL_ACCOUNT_SYSTEM_PROTECTED: system accounts cannot be deactivated.';
  end if;
  if coalesce(v_acct.is_active, true) is false then
    v_result := jsonb_build_object(
      'ok', true,
      'account_id', p_account_id,
      'is_active', false,
      'already_inactive', true
    );
    return public.acct_control_complete_action(p_idempotency_key, 'gl_deactivate', v_hash, v_result);
  end if;

  update public.gl_accounts
  set is_active = false,
      updated_at = now()
  where id = p_account_id;

  if public.acct_function_exists('accounting_audit_from_definer_safe') then
    perform public.accounting_audit_from_definer_safe(
      'gl_account_deactivated',
      'gl_account',
      p_account_id,
      (timezone('utc', now()))::date,
      v_reason,
      jsonb_build_object('code', v_acct.code, 'name', v_acct.name),
      v_actor,
      'audit:gl_deactivate:' || p_account_id::text || ':' || p_idempotency_key
    );
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'is_active', false,
    'deleted', false
  );
  return public.acct_control_complete_action(p_idempotency_key, 'gl_deactivate', v_hash, v_result);
end;
$$;

create or replace function public.gl_account_upsert_safe(
  p_account_id uuid,
  p_code text,
  p_name text,
  p_account_type text,
  p_subtype text default null,
  p_is_active boolean default true,
  p_idempotency_key text default null,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_hash text;
  v_dup jsonb;
  v_acct public.gl_accounts%rowtype;
  v_id uuid;
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_type text := nullif(btrim(coalesce(p_account_type, '')), '');
  v_has_lines boolean := false;
  v_result jsonb;
  v_action text;
begin
  perform public.acct_require_admin('upsert GL accounts');
  v_actor := public.accounting_actor_id(p_created_by);

  if v_code is null or v_name is null or v_type is null then
    raise exception 'GL_ACCOUNT_FIELDS_REQUIRED: code, name, account_type required.';
  end if;
  if v_type not in ('asset', 'liability', 'equity', 'revenue', 'expense') then
    raise exception 'GL_ACCOUNT_TYPE_INVALID: %', v_type;
  end if;

  v_action := case when p_account_id is null then 'gl_create' else 'gl_update' end;
  v_hash := public.acct_control_context_hash(
    v_action,
    jsonb_build_object(
      'account_id', p_account_id,
      'code', v_code,
      'name', v_name,
      'account_type', v_type,
      'subtype', p_subtype,
      'is_active', coalesce(p_is_active, true)
    )
  );

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    v_dup := public.acct_control_begin_action(p_idempotency_key, v_action, v_hash);
    if v_dup is not null then
      return v_dup;
    end if;
  end if;

  if p_account_id is null then
    if exists (select 1 from public.gl_accounts where code = v_code) then
      raise exception 'GL_ACCOUNT_CODE_EXISTS: %', v_code;
    end if;
    insert into public.gl_accounts (code, name, account_type, subtype, is_active, is_system)
    values (v_code, v_name, v_type, nullif(btrim(coalesce(p_subtype, '')), ''), coalesce(p_is_active, true), false)
    returning id into v_id;

    v_result := jsonb_build_object(
      'ok', true,
      'account_id', v_id,
      'created', true,
      'code', v_code
    );
  else
    select * into v_acct from public.gl_accounts where id = p_account_id for update;
    if not found then
      raise exception 'GL_ACCOUNT_NOT_FOUND';
    end if;
    if coalesce(v_acct.is_system, false) and (
         v_acct.code is distinct from v_code
      or v_acct.account_type is distinct from v_type
    ) then
      raise exception 'GL_ACCOUNT_SYSTEM_PROTECTED: cannot change code/type on system accounts.';
    end if;

    if exists (
      select 1 from public.gl_accounts g
      where g.code = v_code and g.id is distinct from p_account_id
    ) then
      raise exception 'GL_ACCOUNT_CODE_EXISTS: %', v_code;
    end if;

    select exists (
      select 1 from public.journal_lines jl where jl.account_id = p_account_id
    ) into v_has_lines;

    if v_has_lines and v_acct.account_type is distinct from v_type then
      raise exception 'GL_ACCOUNT_TYPE_LOCKED: cannot change account_type when journal_lines exist.';
    end if;
    if v_has_lines and v_acct.subtype is distinct from nullif(btrim(coalesce(p_subtype, '')), '') then
      raise exception 'GL_ACCOUNT_SUBTYPE_LOCKED: cannot change subtype when journal_lines exist (reporting classification history).';
    end if;

    update public.gl_accounts
    set code = v_code,
        name = v_name,
        account_type = v_type,
        subtype = case
          when v_has_lines then v_acct.subtype
          else nullif(btrim(coalesce(p_subtype, '')), '')
        end,
        is_active = coalesce(p_is_active, true),
        updated_at = now()
    where id = p_account_id;

    v_id := p_account_id;
    v_result := jsonb_build_object(
      'ok', true,
      'account_id', v_id,
      'created', false,
      'code', v_code,
      'type_changed', v_acct.account_type is distinct from v_type,
      'subtype_changed', false
    );
  end if;

  if public.acct_function_exists('accounting_audit_from_definer_safe') then
    perform public.accounting_audit_from_definer_safe(
      case when p_account_id is null then 'gl_account_created' else 'gl_account_updated' end,
      'gl_account',
      v_id,
      (timezone('utc', now()))::date,
      coalesce(v_action, 'gl_upsert'),
      v_result,
      v_actor,
      coalesce(
        'audit:gl_upsert:' || coalesce(p_idempotency_key, v_id::text),
        'audit:gl_upsert:' || v_id::text
      )
    );
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    return public.acct_control_complete_action(p_idempotency_key, v_action, v_hash, v_result);
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 20) ACL — revoke public/anon; grant authenticated on user-facing RPCs only
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_staff text[] := array[
    'acct_books_status',
    'acct_report_trial_balance',
    'acct_report_trial_balance_as_of',
    'acct_report_pnl',
    'acct_report_balance_sheet',
    'acct_report_general_ledger',
    'acct_report_ar_aging',
    'acct_report_ap_aging',
    'acct_recon_ar_control',
    'acct_recon_ap_control',
    'acct_recon_inventory_control',
    'acct_recon_cash_book',
    'acct_journal_integrity_scan',
    'acct_exceptions_scan',
    'acct_cutover_readiness_snapshot',
    'acct_period_close_safe',
    'acct_period_reopen_safe',
    'acct_period_lock_safe',
    'gl_account_deactivate_safe',
    'gl_account_upsert_safe'
  ];
  v_internal text[] := array[
    'acct_report_require_finance',
    'acct_invoice_open_ar_as_of',
    'acct_bill_remaining_as_of',
    'acct_control_context_hash',
    'acct_control_lock_idempotency',
    'acct_control_begin_action',
    'acct_control_complete_action',
    'acct_round2',
    'acct_is_debit_normal',
    'acct_natural_balance',
    'acct_table_has_column',
    'acct_function_exists',
    'acct_mapped_account_id',
    'acct_gl_account_balance_as_of',
    'acct_require_admin',
    'acct_period_close_readiness',
    'acct_parse_outbox_economic_date',
    'acct_periods_prevent_overlap',
    'acct_lock_period_for_posting'
  ];
  v_all text[];
  v_name text;
begin
  foreach v_name in array v_staff loop
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    ) then
      raise exception 'ACCT_P5_ACL_MISSING_STAFF_RPC: %', v_name;
    end if;
  end loop;

  v_all := v_staff || v_internal;
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_all)
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    if r.proname = any (v_internal) then
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

comment on function public.acct_report_require_finance() is
  'Finance gate: admin/office only. Warehouse and crew fail role check on all report RPCs.';
comment on function public.acct_books_status() is
  'Read-only books flags. official_books=false while posting/books_of_record off.';
comment on function public.acct_cutover_readiness_snapshot() is
  'Evaluates cutover readiness without mutating accounting_settings. PITR expected NOT CONFIRMED → NOT_READY.';

-- Explicit non-goals (documentation only — no DML against accounting_settings):
-- * Do NOT update posting_enabled / books_of_record / inventory_posting_enabled
-- * Do NOT invent fake journal / aging data
-- * External books remain official until owner cutover
