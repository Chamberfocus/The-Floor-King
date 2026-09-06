-- F6-P2C — Bank Reconciliation hardening (CSV import + matching + finalization)
-- Extends 0164 / 0167 / 0170 / 0171 / 0172. Does NOT enable accounting flags.
-- Does NOT post journals or change posting/books flags. Does NOT create 0174.
-- DO NOT APPLY without owner review.
--
-- ===========================================================================
-- STATUS POLICY
-- ===========================================================================
-- Canonical statuses:
--   draft        — created, not yet worked
--   in_progress  — import attached and/or matches exist
--   reconciled   — successfully finalized (BLOCKS overlapping replacement)
--   void         — admin void of a successfully finalized session (does NOT
--                  block a replacement session for the same account/period)
--
-- Legacy statuses (0164), still accepted:
--   open       — editable, same as in_progress
--   completed  — successfully finalized, same as reconciled (BLOCKS overlap)
--   cancelled  — terminal like void (does NOT block replacement)
--
-- Helpers (do NOT conflate terminal with successfully finalized):
--   bank_recon_session_is_editable(status)
--     → draft | in_progress | open
--   bank_recon_session_is_successfully_finalized(status)
--     → reconciled | completed
--     → THIS is the only status class that blocks overlapping sessions.
--   bank_recon_session_is_terminal(status)
--     → void | cancelled
--     → history preserved; a new session MAY cover the same period.
--
-- ===========================================================================
-- FINGERPRINT ALGORITHM
-- ===========================================================================
-- FILE fingerprint (order-independent; filename is metadata only):
--   md5( account_id || '|' || sorted_normalized_lines joined by newline )
--   Each normalized line:
--     date | abs_amount(2dp) | direction | lower(trim(description)) | sourceRef
--   Lines are SORTED lexicographically so CSV row order does not change the
--   file identity. Duplicate identical lines are preserved (not DISTINCT).
--
-- TRANSACTION content key (NO source_row_no):
--   account_id | date | abs_amount(2dp) | direction | lower(trim(desc)) | sourceRef
--   Stored on the line as transaction_fingerprint (the content key text).
--
-- occurrence_index (1-based, THIS batch only, array order):
--   Count of how many times this content key has already appeared earlier in
--   the same import payload, plus one. Two identical transactions in one file
--   receive indexes 1 and 2.
--
-- source_row_fingerprint (canonical unmatched / possible_duplicate only):
--   md5( content_key || '|' || occurrence_index )
--   Exact-reimport rows do NOT take this unique slot; they store the key on
--   canonical_source_row_fingerprint and point at exact_reimport_of_line_id.
--
-- exact_reimport:
--   The computed source_row_fingerprint already exists on a prior row for the
--   SAME account with duplicate_status in (unmatched, possible_duplicate).
--   Exact reimports are NEVER included in statement totals and are NEVER
--   matchable.
--
-- possible_duplicate (heuristic; not proof):
--   date | abs_amount | lower(desc) | direction
--   Direction is REQUIRED (deposit vs withdrawal are never conflated).
--   Flagged when the heuristic was seen on a prior canonical row for the
--   same account OR earlier in this batch. Review: accept or exclude.
--
-- Rejected rows: per-row parse failures. raw_row is always preserved.
-- Rejected rows are NEVER in bank totals. Unresolved rejected (rejected and
-- not excluded) blocks finalization.
--
-- Max 5000 source rows per import. Advisory xact lock on the cash account
-- for import, create-session, and finalize.
--
-- Audit: accounting_audit_from_definer_safe only (no manual GUC).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Reconciliation session extensions
-- ---------------------------------------------------------------------------
alter table public.bank_reconciliation_sessions
  add column if not exists import_batch_id uuid
    references public.bank_statement_import_batches (id) on delete set null,
  add column if not exists voided_by uuid references auth.users (id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists cancelled_by uuid references auth.users (id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists final_snapshot jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists prior_status text;

create unique index if not exists bank_recon_sessions_idempotency_uidx
  on public.bank_reconciliation_sessions (idempotency_key)
  where idempotency_key is not null;

create index if not exists bank_recon_sessions_account_dates_status_idx
  on public.bank_reconciliation_sessions (
    account_id, statement_start, statement_end, status
  );

create index if not exists bank_recon_sessions_import_batch_idx
  on public.bank_reconciliation_sessions (import_batch_id)
  where import_batch_id is not null;

alter table public.bank_reconciliation_sessions
  drop constraint if exists bank_reconciliation_sessions_status_check;

alter table public.bank_reconciliation_sessions
  add constraint bank_reconciliation_sessions_status_check
  check (
    status in (
      'draft', 'in_progress', 'reconciled', 'void',
      'open', 'completed', 'cancelled'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Import line review / exclusion / transaction identity
-- ---------------------------------------------------------------------------
alter table public.bank_statement_import_lines
  add column if not exists review_status text not null default 'pending',
  add column if not exists exclusion_reason text,
  add column if not exists transaction_fingerprint text,
  add column if not exists occurrence_index int;

alter table public.bank_statement_import_lines
  drop constraint if exists bank_import_lines_review_status_check;

alter table public.bank_statement_import_lines
  add constraint bank_import_lines_review_status_check
  check (review_status in ('pending', 'accepted', 'excluded'));

alter table public.bank_statement_import_lines
  drop constraint if exists bank_import_lines_occurrence_check;

alter table public.bank_statement_import_lines
  add constraint bank_import_lines_occurrence_check
  check (occurrence_index is null or occurrence_index >= 1);

create index if not exists bank_import_lines_txn_fp_idx
  on public.bank_statement_import_lines (transaction_fingerprint);

create index if not exists bank_import_lines_batch_txn_occ_idx
  on public.bank_statement_import_lines (
    batch_id, transaction_fingerprint, occurrence_index
  );

create index if not exists bank_import_lines_source_fp_idx
  on public.bank_statement_import_lines (source_row_fingerprint)
  where source_row_fingerprint is not null;

-- ---------------------------------------------------------------------------
-- 3. Bank ↔ journal match allocations (evidence only — no economic mutation)
-- ---------------------------------------------------------------------------
create table if not exists public.bank_reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.bank_reconciliation_sessions (id) on delete restrict,
  import_line_id uuid not null
    references public.bank_statement_import_lines (id) on delete restrict,
  journal_line_id uuid not null
    references public.journal_lines (id) on delete restrict,
  allocated_amount numeric(12, 2) not null
    check (allocated_amount > 0),
  status text not null default 'active'
    check (status in ('active', 'removed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz,
  removal_reason text,
  idempotency_key text,
  constraint bank_recon_match_idempotency unique (idempotency_key)
);

create index if not exists bank_recon_matches_session_idx
  on public.bank_reconciliation_matches (session_id, status);

create index if not exists bank_recon_matches_import_idx
  on public.bank_reconciliation_matches (import_line_id, status);

create index if not exists bank_recon_matches_journal_idx
  on public.bank_reconciliation_matches (journal_line_id, status);

create unique index if not exists bank_recon_matches_active_pair_uidx
  on public.bank_reconciliation_matches (session_id, import_line_id, journal_line_id)
  where status = 'active';

create index if not exists bank_recon_matches_idempotency_idx
  on public.bank_reconciliation_matches (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 4. RLS — admin/office SELECT only; DML via SECURITY DEFINER RPCs
-- ---------------------------------------------------------------------------
alter table public.bank_reconciliation_sessions enable row level security;
alter table public.bank_reconciliation_cleared_lines enable row level security;
alter table public.bank_reconciliation_matches enable row level security;
alter table public.bank_statement_import_batches enable row level security;
alter table public.bank_statement_import_lines enable row level security;

drop policy if exists bank_recon_sessions_staff on public.bank_reconciliation_sessions;
drop policy if exists bank_recon_sessions_staff_select on public.bank_reconciliation_sessions;
create policy bank_recon_sessions_staff_select on public.bank_reconciliation_sessions
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

drop policy if exists bank_recon_cleared_staff on public.bank_reconciliation_cleared_lines;
drop policy if exists bank_recon_cleared_staff_select on public.bank_reconciliation_cleared_lines;
create policy bank_recon_cleared_staff_select on public.bank_reconciliation_cleared_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

drop policy if exists bank_recon_matches_staff_select on public.bank_reconciliation_matches;
create policy bank_recon_matches_staff_select on public.bank_reconciliation_matches
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

drop policy if exists bank_import_batches_staff on public.bank_statement_import_batches;
drop policy if exists bank_import_batches_staff_select on public.bank_statement_import_batches;
create policy bank_import_batches_staff_select on public.bank_statement_import_batches
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

drop policy if exists bank_import_lines_staff on public.bank_statement_import_lines;
drop policy if exists bank_import_lines_staff_select on public.bank_statement_import_lines;
create policy bank_import_lines_staff_select on public.bank_statement_import_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

revoke all on public.bank_reconciliation_sessions from public;
revoke insert, update on public.bank_reconciliation_sessions from authenticated;
revoke delete on public.bank_reconciliation_sessions from authenticated;
grant select on public.bank_reconciliation_sessions to authenticated;
grant select, insert, update on public.bank_reconciliation_sessions to service_role;

revoke all on public.bank_reconciliation_cleared_lines from public;
revoke insert, update, delete on public.bank_reconciliation_cleared_lines from authenticated;
grant select on public.bank_reconciliation_cleared_lines to authenticated;
grant select, insert, update, delete on public.bank_reconciliation_cleared_lines to service_role;

revoke all on public.bank_reconciliation_matches from public;
revoke insert, update, delete on public.bank_reconciliation_matches from authenticated;
grant select on public.bank_reconciliation_matches to authenticated;
grant select, insert, update on public.bank_reconciliation_matches to service_role;

revoke all on public.bank_statement_import_batches from public;
revoke insert, update, delete on public.bank_statement_import_batches from authenticated;
grant select on public.bank_statement_import_batches to authenticated;
grant select, insert, update on public.bank_statement_import_batches to service_role;

revoke all on public.bank_statement_import_lines from public;
revoke insert, update, delete on public.bank_statement_import_lines from authenticated;
grant select on public.bank_statement_import_lines to authenticated;
grant select, insert, update on public.bank_statement_import_lines to service_role;

-- ---------------------------------------------------------------------------
-- 5. Status helpers
-- ---------------------------------------------------------------------------
drop function if exists public.bank_recon_session_is_final(text);

create or replace function public.bank_recon_session_is_editable(p_status text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_status, '') in ('draft', 'in_progress', 'open');
$$;

create or replace function public.bank_recon_session_is_successfully_finalized(p_status text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_status, '') in ('reconciled', 'completed');
$$;

create or replace function public.bank_recon_session_is_terminal(p_status text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_status, '') in ('void', 'cancelled');
$$;

-- Included in statement totals / matchable universe:
--   duplicate_status in (unmatched, possible_duplicate)
--   AND review_status <> excluded
--   AND NOT exact_reimport AND NOT rejected
create or replace function public.bank_import_line_included_in_statement(
  p_duplicate_status text,
  p_review_status text
)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_duplicate_status, '') in ('unmatched', 'possible_duplicate')
     and coalesce(p_review_status, 'pending') is distinct from 'excluded';
$$;

-- Per-row parse helpers (never raise; used by fingerprint + staging).
-- Rejects NaN/Infinity and amounts outside numeric(12,2) or with >2 decimal places.
create or replace function public.bank_import_try_numeric(p_text text)
returns numeric
language plpgsql
immutable
as $$
declare
  v_raw text;
  v_lower text;
  v_num numeric;
begin
  if p_text is null then
    return null;
  end if;
  v_raw := btrim(p_text);
  if v_raw = '' then
    return null;
  end if;
  v_lower := lower(v_raw);
  if v_lower in (
    'nan', 'infinity', '+infinity', '-infinity',
    'inf', '+inf', '-inf'
  ) then
    return null;
  end if;
  begin
    v_num := v_raw::numeric;
  exception
    when invalid_text_representation then
      return null;
    when numeric_value_out_of_range then
      return null;
    when others then
      return null;
  end;
  if v_num is null or v_num <> v_num then
    return null;
  end if;
  if v_num in ('Infinity'::numeric, '-Infinity'::numeric) then
    return null;
  end if;
  if v_num <> round(v_num, 2) then
    return null;
  end if;
  if abs(v_num) > 9999999999.99 then
    return null;
  end if;
  return v_num;
end;
$$;

create or replace function public.bank_import_try_date(p_text text)
returns date
language plpgsql
immutable
as $$
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  return btrim(p_text)::date;
exception
  when invalid_text_representation then
    return null;
  when datetime_field_overflow then
    return null;
  when invalid_datetime_format then
    return null;
  when others then
    return null;
end;
$$;

-- Advisory xact lock for a cash account (import / create / finalize).
create or replace function public.bank_recon_lock_account(p_account_id uuid)
returns void
language plpgsql
as $$
begin
  if p_account_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(
    173,
    ('x' || substr(md5(p_account_id::text), 1, 8))::bit(32)::int
  );
end;
$$;

-- Durable finalized-history marker (survives reconciled → void).
create or replace function public.bank_recon_session_was_finalized(
  p_completed_at timestamptz,
  p_final_snapshot jsonb
)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_completed_at is not null or p_final_snapshot is not null;
$$;

-- void/cancelled parent sessions preserve match rows but do not reserve capacity.
create or replace function public.bank_recon_match_parent_effective(p_status text)
returns boolean
language sql
immutable
parallel safe
as $$
  select not public.bank_recon_session_is_terminal(coalesce(p_status, ''));
$$;

-- Effective journal allocations: prior reconciled/completed + current editable session.
create or replace function public.bank_recon_effective_journal_allocated(
  p_journal_line_id uuid,
  p_current_session_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(m.allocated_amount), 0)::numeric
  from public.bank_reconciliation_matches m
  join public.bank_reconciliation_sessions s on s.id = m.session_id
  where m.journal_line_id = p_journal_line_id
    and m.status = 'active'
    and public.bank_recon_match_parent_effective(s.status)
    and (
      public.bank_recon_session_is_successfully_finalized(s.status)
      or (
        p_current_session_id is not null
        and s.id = p_current_session_id
        and public.bank_recon_session_is_editable(s.status)
      )
    );
$$;

-- Effective bank import allocations (same parent-session rule).
create or replace function public.bank_recon_effective_import_allocated(
  p_import_line_id uuid,
  p_current_session_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(m.allocated_amount), 0)::numeric
  from public.bank_reconciliation_matches m
  join public.bank_reconciliation_sessions s on s.id = m.session_id
  where m.import_line_id = p_import_line_id
    and m.status = 'active'
    and public.bank_recon_match_parent_effective(s.status)
    and (
      public.bank_recon_session_is_successfully_finalized(s.status)
      or (
        p_current_session_id is not null
        and s.id = p_current_session_id
        and public.bank_recon_session_is_editable(s.status)
      )
    );
$$;

-- Any session linked to this batch has durable finalized history.
create or replace function public.bank_recon_batch_has_protected_session(
  p_batch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bank_reconciliation_sessions s
    where s.import_batch_id = p_batch_id
      and public.bank_recon_session_was_finalized(s.completed_at, s.final_snapshot)
  );
$$;

-- Normalize one JSON element for order-independent file fingerprinting.
create or replace function public.bank_import_fingerprint_line(p_elem jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_amount numeric;
  v_dir text;
begin
  if p_elem is null or jsonb_typeof(p_elem) is distinct from 'object' then
    return '__invalid__:' || coalesce(jsonb_typeof(p_elem), 'null') || ':' || coalesce(p_elem::text, '');
  end if;

  v_amount := public.bank_import_try_numeric(p_elem->>'amount');
  v_dir := lower(nullif(btrim(coalesce(p_elem->>'direction', '')), ''));
  if v_dir is null or v_dir not in ('deposit', 'withdrawal') then
    v_dir := case
      when v_amount is null then ''
      when v_amount >= 0 then 'deposit'
      else 'withdrawal'
    end;
  end if;

  return
    coalesce(nullif(btrim(p_elem->>'date'), ''), '') || '|' ||
    coalesce(
      case when v_amount is not null then round(abs(v_amount), 2)::text end,
      btrim(coalesce(p_elem->>'amount', ''))
    ) || '|' ||
    v_dir || '|' ||
    lower(coalesce(nullif(btrim(coalesce(p_elem->>'description', '')), ''), '')) || '|' ||
    coalesce(
      nullif(btrim(coalesce(p_elem->>'sourceRef', '')), ''),
      nullif(btrim(coalesce(p_elem->>'source_ref', '')), ''),
      ''
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Immutable trigger — reconciled/completed sessions
--    Allowed: void transition (status → void + void metadata + prior_status +
--    updated_at). DELETE is always blocked once finalized.
--    After void, all historical evidence remains immutable forever.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_finalized_bank_recon_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if public.bank_recon_session_was_finalized(old.completed_at, old.final_snapshot) then
      raise exception
        'Successfully finalized bank reconciliations cannot be deleted. Void them instead.';
    end if;
    return old;
  end if;

  if not public.bank_recon_session_was_finalized(old.completed_at, old.final_snapshot) then
    return new;
  end if;

  -- Allowed void transition only (reconciled/completed → void).
  -- prior_status MUST record the finalized status being vacated (old.status).
  -- After status becomes void, this branch never matches again — history stays frozen.
  if old.status in ('reconciled', 'completed')
     and new.status = 'void'
     and new.prior_status is not distinct from old.status
     and new.account_id is not distinct from old.account_id
     and new.statement_start is not distinct from old.statement_start
     and new.statement_end is not distinct from old.statement_end
     and new.opening_balance is not distinct from old.opening_balance
     and new.ending_balance is not distinct from old.ending_balance
     and new.import_batch_id is not distinct from old.import_batch_id
     and new.final_snapshot is not distinct from old.final_snapshot
     and new.calculated_ending_balance is not distinct from old.calculated_ending_balance
     and new.difference is not distinct from old.difference
     and new.idempotency_key is not distinct from old.idempotency_key
     and new.created_by is not distinct from old.created_by
     and new.completed_by is not distinct from old.completed_by
     and new.completed_at is not distinct from old.completed_at
     and new.notes is not distinct from old.notes
     and nullif(btrim(coalesce(new.void_reason, '')), '') is not null
     and new.voided_by is not null
     and new.voided_at is not null
  then
    return new;
  end if;

  raise exception
    'Finalized bank reconciliation history is immutable except for a controlled void.';
end;
$$;

drop trigger if exists bank_recon_sessions_finalized_immutable
  on public.bank_reconciliation_sessions;
create trigger bank_recon_sessions_finalized_immutable
  before update or delete on public.bank_reconciliation_sessions
  for each row execute function public.prevent_finalized_bank_recon_mutation();

-- Child evidence immutability once parent session was finalized (including after void).
create or replace function public.prevent_protected_bank_recon_match_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess public.bank_reconciliation_sessions%rowtype;
begin
  select * into v_sess
  from public.bank_reconciliation_sessions
  where id = coalesce(old.session_id, new.session_id);
  if public.bank_recon_session_was_finalized(v_sess.completed_at, v_sess.final_snapshot) then
    raise exception
      'Cannot modify match rows on finalized bank reconciliation history.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists bank_recon_matches_protected_immutable
  on public.bank_reconciliation_matches;
create trigger bank_recon_matches_protected_immutable
  before update or delete on public.bank_reconciliation_matches
  for each row execute function public.prevent_protected_bank_recon_match_mutation();

create or replace function public.prevent_protected_bank_recon_cleared_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess public.bank_reconciliation_sessions%rowtype;
begin
  select * into v_sess
  from public.bank_reconciliation_sessions
  where id = coalesce(old.session_id, new.session_id);
  if public.bank_recon_session_was_finalized(v_sess.completed_at, v_sess.final_snapshot) then
    raise exception
      'Cannot modify cleared-line rows on finalized bank reconciliation history.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists bank_recon_cleared_protected_immutable
  on public.bank_reconciliation_cleared_lines;
create trigger bank_recon_cleared_protected_immutable
  before update or delete on public.bank_reconciliation_cleared_lines
  for each row execute function public.prevent_protected_bank_recon_cleared_mutation();

create or replace function public.prevent_protected_bank_import_line_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.bank_recon_batch_has_protected_session(coalesce(old.batch_id, new.batch_id)) then
    raise exception
      'Cannot modify import lines used by finalized bank reconciliation history.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists bank_import_lines_protected_immutable
  on public.bank_statement_import_lines;
create trigger bank_import_lines_protected_immutable
  before update or delete on public.bank_statement_import_lines
  for each row execute function public.prevent_protected_bank_import_line_mutation();

-- Sync cleared_lines from active match allocations (fully allocated only).
create or replace function public.bank_recon_sync_journal_cleared(
  p_session_id uuid,
  p_journal_line_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
  v_allocated numeric;
  v_entry_date date;
begin
  select
    round(greatest(coalesce(jl.debit, 0), coalesce(jl.credit, 0))::numeric, 2),
    je.entry_date
  into v_available, v_entry_date
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  where jl.id = p_journal_line_id;

  if v_available is null then
    delete from public.bank_reconciliation_cleared_lines
    where session_id = p_session_id
      and journal_line_id = p_journal_line_id;
    return;
  end if;

  select round(coalesce(sum(m.allocated_amount), 0)::numeric, 2)
    into v_allocated
  from public.bank_reconciliation_matches m
  where m.session_id = p_session_id
    and m.journal_line_id = p_journal_line_id
    and m.status = 'active';

  if round((v_available - coalesce(v_allocated, 0))::numeric, 2) <= 0.005 then
    insert into public.bank_reconciliation_cleared_lines (
      session_id, journal_line_id, cleared, cleared_on
    ) values (
      p_session_id, p_journal_line_id, true, v_entry_date
    )
    on conflict (session_id, journal_line_id) do update
      set cleared = true,
          cleared_on = excluded.cleared_on;
  else
    delete from public.bank_reconciliation_cleared_lines
    where session_id = p_session_id
      and journal_line_id = p_journal_line_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. bank_reconciliation_compute_package — server-side reconciliation math
--    Internal. service_role execute only. Called from finalize (definer owner).
-- ---------------------------------------------------------------------------
create or replace function public.bank_reconciliation_compute_package(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sess public.bank_reconciliation_sessions%rowtype;
  v_batch public.bank_statement_import_batches%rowtype;
  v_bank_deposits numeric := 0;
  v_bank_withdrawals numeric := 0;
  v_matched_debit numeric := 0;
  v_matched_credit numeric := 0;
  v_remaining_bank_deposits numeric := 0;
  v_remaining_bank_withdrawals numeric := 0;
  v_remaining_book_debit numeric := 0;
  v_remaining_book_credit numeric := 0;
  v_outstanding_book_debit numeric := 0;
  v_outstanding_book_credit numeric := 0;
  v_unresolved_dupes int := 0;
  v_rejected_count int := 0;
  v_unresolved_rejected int := 0;
  v_calc_ending numeric := 0;
  v_statement_eq numeric := 0;
  v_legacy_matched_diff numeric := 0;
  v_gl_balance numeric := 0;
  v_adjusted_bank numeric := 0;
  v_book_vs_adjusted numeric := 0;
  v_recon_difference numeric := 0;
  v_match_invalid_account int := 0;
  v_match_unposted int := 0;
  v_match_direction int := 0;
  v_match_two_sided int := 0;
  v_match_over_bank int := 0;
  v_match_over_journal int := 0;
  v_match_excluded int := 0;
  v_match_reimport int := 0;
  v_match_future_journal int := 0;
  v_match_ok boolean := true;
  v_import_ok boolean := false;
  v_can_finalize boolean := false;
begin
  select * into v_sess
  from public.bank_reconciliation_sessions
  where id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation session not found.');
  end if;

  if v_sess.import_batch_id is not null then
    select * into v_batch
    from public.bank_statement_import_batches
    where id = v_sess.import_batch_id;
    v_import_ok :=
      found
      and v_batch.account_id is not distinct from v_sess.account_id;
  end if;

  if v_sess.import_batch_id is not null then
    select
      coalesce(sum(case
        when public.bank_import_line_included_in_statement(l.duplicate_status, l.review_status)
         and l.direction = 'deposit'
        then round(l.amount, 2) else 0 end), 0),
      coalesce(sum(case
        when public.bank_import_line_included_in_statement(l.duplicate_status, l.review_status)
         and l.direction = 'withdrawal'
        then round(l.amount, 2) else 0 end), 0),
      coalesce(sum(case
        when l.duplicate_status = 'possible_duplicate'
         and coalesce(l.review_status, 'pending') = 'pending'
        then 1 else 0 end), 0)::int,
      coalesce(sum(case when l.duplicate_status = 'rejected' then 1 else 0 end), 0)::int,
      coalesce(sum(case
        when l.duplicate_status = 'rejected'
         and coalesce(l.review_status, 'pending') is distinct from 'excluded'
        then 1 else 0 end), 0)::int
    into
      v_bank_deposits,
      v_bank_withdrawals,
      v_unresolved_dupes,
      v_rejected_count,
      v_unresolved_rejected
    from public.bank_statement_import_lines l
    where l.batch_id = v_sess.import_batch_id;
  end if;

  -- Matched debit/credit from SUM(allocated_amount) using IMPORT LINE direction
  -- (deposit → debit side / inflow; withdrawal → credit side / outflow).
  select
    coalesce(sum(case
      when l.direction = 'deposit' then round(m.allocated_amount, 2) else 0 end), 0),
    coalesce(sum(case
      when l.direction = 'withdrawal' then round(m.allocated_amount, 2) else 0 end), 0)
  into v_matched_debit, v_matched_credit
  from public.bank_reconciliation_matches m
  join public.bank_statement_import_lines l on l.id = m.import_line_id
  where m.session_id = p_session_id
    and m.status = 'active';

  -- Remaining (partial) included bank amounts.
  if v_sess.import_batch_id is not null then
    select
      coalesce(sum(case
        when l.direction = 'deposit'
         and rem > 0.005
        then rem else 0 end), 0),
      coalesce(sum(case
        when l.direction = 'withdrawal'
         and rem > 0.005
        then rem else 0 end), 0)
    into v_remaining_bank_deposits, v_remaining_bank_withdrawals
    from (
      select
        l.direction,
        round((
          coalesce(l.amount, 0)
          - public.bank_recon_effective_import_allocated(l.id, p_session_id)
        )::numeric, 2) as rem
      from public.bank_statement_import_lines l
      where l.batch_id = v_sess.import_batch_id
        and public.bank_import_line_included_in_statement(
          l.duplicate_status, l.review_status
        )
    ) x;
  end if;

  -- Remaining / outstanding book amounts: posted journal lines through statement
  -- end minus effective prior + current-session clearing allocations.
  select
    coalesce(sum(case when x.debit > 0 and x.rem > 0.005 then x.rem else 0 end), 0),
    coalesce(sum(case when x.credit > 0 and x.rem > 0.005 then x.rem else 0 end), 0)
  into v_outstanding_book_debit, v_outstanding_book_credit
  from (
    select
      jl.debit,
      jl.credit,
      round((
        greatest(coalesce(jl.debit, 0), coalesce(jl.credit, 0))
        - public.bank_recon_effective_journal_allocated(jl.id, p_session_id)
      )::numeric, 2) as rem
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where jl.account_id = v_sess.account_id
      and je.status = 'posted'
      -- Outstanding items may predate the statement period (uncleared checks).
      and je.entry_date <= v_sess.statement_end
  ) x;

  v_remaining_book_debit := v_outstanding_book_debit;
  v_remaining_book_credit := v_outstanding_book_credit;

  select round(coalesce(sum(jl.debit - jl.credit), 0)::numeric, 2)
    into v_gl_balance
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  where jl.account_id = v_sess.account_id
    and je.status = 'posted'
    and je.entry_date <= v_sess.statement_end;

  v_calc_ending := round(
    (v_sess.opening_balance + v_matched_debit - v_matched_credit)::numeric,
    2
  );
  v_statement_eq := round(
    (v_sess.opening_balance + v_bank_deposits - v_bank_withdrawals - v_sess.ending_balance)::numeric,
    2
  );
  v_legacy_matched_diff := round(
    (v_sess.ending_balance - v_calc_ending)::numeric,
    2
  );
  v_adjusted_bank := round(
    (v_sess.ending_balance + v_outstanding_book_debit - v_outstanding_book_credit)::numeric,
    2
  );
  v_book_vs_adjusted := round((v_gl_balance - v_adjusted_bank)::numeric, 2);
  -- Preferred legacy name: book vs adjusted bank. Both formula gates still apply.
  v_recon_difference := v_book_vs_adjusted;

  -- Match integrity flags
  select
    coalesce(sum(case when jl.account_id is distinct from v_sess.account_id then 1 else 0 end), 0),
    coalesce(sum(case when je.status is distinct from 'posted' then 1 else 0 end), 0),
    coalesce(sum(case
      when (l.direction = 'deposit' and coalesce(jl.debit, 0) <= 0)
        or (l.direction = 'withdrawal' and coalesce(jl.credit, 0) <= 0)
      then 1 else 0 end), 0),
    coalesce(sum(case
      when (coalesce(jl.debit, 0) > 0 and coalesce(jl.credit, 0) > 0)
        or (coalesce(jl.debit, 0) = 0 and coalesce(jl.credit, 0) = 0)
      then 1 else 0 end), 0),
    coalesce(sum(case
      when l.review_status = 'excluded' or l.duplicate_status = 'rejected' then 1 else 0 end), 0),
    coalesce(sum(case when l.duplicate_status = 'exact_reimport' then 1 else 0 end), 0),
    coalesce(sum(case when je.entry_date > v_sess.statement_end then 1 else 0 end), 0)
  into
    v_match_invalid_account,
    v_match_unposted,
    v_match_direction,
    v_match_two_sided,
    v_match_excluded,
    v_match_reimport,
    v_match_future_journal
  from public.bank_reconciliation_matches m
  join public.bank_statement_import_lines l on l.id = m.import_line_id
  join public.journal_lines jl on jl.id = m.journal_line_id
  join public.journal_entries je on je.id = jl.journal_entry_id
  where m.session_id = p_session_id
    and m.status = 'active';

  select coalesce(sum(case when bank_sum > round(amount, 2) + 0.0001 then 1 else 0 end), 0)
    into v_match_over_bank
  from (
    select
      l.amount,
      public.bank_recon_effective_import_allocated(l.id, p_session_id) as bank_sum
    from public.bank_statement_import_lines l
    where v_sess.import_batch_id is not null
      and l.batch_id = v_sess.import_batch_id
  ) x
  where amount is not null;

  select coalesce(sum(case
      when alloc_sum > round(greatest(debit, credit), 2) + 0.0001 then 1 else 0 end), 0)
    into v_match_over_journal
  from (
    select
      jl.debit,
      jl.credit,
      public.bank_recon_effective_journal_allocated(jl.id, p_session_id) as alloc_sum
    from public.journal_lines jl
    where exists (
      select 1
      from public.bank_reconciliation_matches m
      join public.bank_reconciliation_sessions s on s.id = m.session_id
      where m.journal_line_id = jl.id
        and m.status = 'active'
        and public.bank_recon_match_parent_effective(s.status)
        and (
          public.bank_recon_session_is_successfully_finalized(s.status)
          or (
            s.id = p_session_id
            and public.bank_recon_session_is_editable(s.status)
          )
        )
    )
  ) x;

  v_match_ok :=
    v_match_invalid_account = 0
    and v_match_unposted = 0
    and v_match_direction = 0
    and v_match_two_sided = 0
    and v_match_over_bank = 0
    and v_match_over_journal = 0
    and v_match_excluded = 0
    and v_match_reimport = 0
    and v_match_future_journal = 0;

  v_can_finalize :=
    public.bank_recon_session_is_editable(v_sess.status)
    and public.accounting_is_eligible_cash_account(v_sess.account_id)
    and v_sess.statement_start is not null
    and v_sess.statement_end is not null
    and v_sess.statement_end >= v_sess.statement_start
    and v_import_ok
    and abs(v_statement_eq) <= 0.005
    and abs(v_book_vs_adjusted) <= 0.005
    and abs(v_remaining_bank_deposits) <= 0.005
    and abs(v_remaining_bank_withdrawals) <= 0.005
    and v_unresolved_dupes = 0
    and v_unresolved_rejected = 0
    and v_match_ok;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'account_id', v_sess.account_id,
    'status', v_sess.status,
    'import_batch_id', v_sess.import_batch_id,
    'import_attached_same_account', v_import_ok,
    'statement_start', v_sess.statement_start,
    'statement_end', v_sess.statement_end,
    'opening_balance', v_sess.opening_balance,
    'ending_balance', v_sess.ending_balance,
    'statement_beginning_balance', v_sess.opening_balance,
    'statement_ending_balance', v_sess.ending_balance,
    'bank_deposits', v_bank_deposits,
    'bank_withdrawals', v_bank_withdrawals,
    'statement_equation_difference', v_statement_eq,
    'bank_equation_difference', v_statement_eq,
    'calculated_ending', v_calc_ending,
    'calculated_ending_balance', v_calc_ending,
    'matched_debit', v_matched_debit,
    'matched_credit', v_matched_credit,
    'statement_ending_vs_matched_difference', v_legacy_matched_diff,
    'remaining_bank_deposits', v_remaining_bank_deposits,
    'remaining_bank_withdrawals', v_remaining_bank_withdrawals,
    'unmatched_bank_deposits', v_remaining_bank_deposits,
    'unmatched_bank_withdrawals', v_remaining_bank_withdrawals,
    'remaining_book_debit', v_remaining_book_debit,
    'remaining_book_credit', v_remaining_book_credit,
    'outstanding_book_debit', v_outstanding_book_debit,
    'outstanding_book_credit', v_outstanding_book_credit,
    'gl_balance_through_end', v_gl_balance,
    'adjusted_bank_balance', v_adjusted_bank,
    'book_vs_adjusted_difference', v_book_vs_adjusted,
    'rejected_count', v_rejected_count,
    'rejected_rows_in_batch', v_rejected_count,
    'unresolved_rejected', v_unresolved_rejected,
    'unresolved_possible_duplicates', v_unresolved_dupes,
    'match_integrity_ok', v_match_ok,
    'match_invalid_account_count', v_match_invalid_account,
    'match_unposted_count', v_match_unposted,
    'match_direction_mismatch_count', v_match_direction,
    'match_two_sided_journal_count', v_match_two_sided,
    'match_bank_overallocation_count', v_match_over_bank,
    'match_journal_overallocation_count', v_match_over_journal,
    'match_excluded_or_rejected_count', v_match_excluded,
    'match_exact_reimport_count', v_match_reimport,
    'match_future_journal_count', v_match_future_journal,
    'reconciliation_difference', v_recon_difference,
    'can_finalize', v_can_finalize
  );
end;
$$;

revoke all on function public.bank_reconciliation_compute_package(uuid) from public;
revoke all on function public.bank_reconciliation_compute_package(uuid) from anon;
revoke all on function public.bank_reconciliation_compute_package(uuid) from authenticated;
grant execute on function public.bank_reconciliation_compute_package(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. stage_bank_statement_import_safe
-- ---------------------------------------------------------------------------
create or replace function public.stage_bank_statement_import_safe(
  p_account_id uuid,
  p_file_name text,
  p_rows jsonb,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_batch_id uuid;
  v_row jsonb;
  v_source_row_no int := 0;
  v_source_count int := 0;
  v_staged_count int := 0;
  v_rejected_count int := 0;
  v_exact_reimport_count int := 0;
  v_possible_dup_count int := 0;
  v_amount numeric;
  v_dir text;
  v_date date;
  v_desc text;
  v_source_ref text;
  v_content_key text;
  v_source_fp text;
  v_heuristic_key text;
  v_existing_fp uuid;
  v_possible_of uuid;
  v_line_id uuid;
  v_import_fp text;
  v_occ int;
  v_occ_map jsonb := '{}'::jsonb;
  v_parse_error text;
  v_explicit_dir text;
begin
  perform public.accounting_require_roles(
    ARRAY['admin', 'office'],
    'stage bank statement imports'
  );
  v_actor := public.accounting_actor_id(p_created_by);

  if p_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'Bank/cash account is required.');
  end if;
  if not public.accounting_is_eligible_cash_account(p_account_id) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Import must target an active bank/cash GL account (cash, cash_clearing, bank, or mapped operating cash).'
    );
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Import requires at least one row.');
  end if;

  v_source_count := jsonb_array_length(p_rows);
  if v_source_count > 5000 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Import exceeds the 5000-row limit.'
    );
  end if;

  perform public.bank_recon_lock_account(p_account_id);

  -- Order-independent FILE fingerprint (safe for non-object JSON elements).
  select md5(
      p_account_id::text || '|' || coalesce(string_agg(norm_line, E'\n' order by norm_line), '')
    )
    into v_import_fp
  from (
    select public.bank_import_fingerprint_line(elem) as norm_line
    from jsonb_array_elements(p_rows) as t(elem)
  ) normalized;

  insert into public.bank_statement_import_batches (
    account_id, file_name, import_fingerprint, status, created_by
  ) values (
    p_account_id, nullif(p_file_name, ''), v_import_fp, 'staged', v_actor
  )
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_source_row_no := v_source_row_no + 1;
    v_date := null;
    v_amount := null;
    v_dir := null;
    v_desc := null;
    v_source_ref := null;
    v_parse_error := null;
    v_explicit_dir := null;

    begin
      if jsonb_typeof(v_row) is distinct from 'object' then
        insert into public.bank_statement_import_lines (
          batch_id, source_row_no, duplicate_status, rejection_reason, raw_row
        ) values (
          v_batch_id, v_source_row_no, 'rejected',
          'Row must be a JSON object.',
          v_row
        );
        v_rejected_count := v_rejected_count + 1;
        continue;
      end if;

      if nullif(btrim(coalesce(v_row->>'date', '')), '') is null then
        v_parse_error := 'Missing transaction date.';
      else
        begin
          v_date := (v_row->>'date')::date;
        exception
          when invalid_text_representation then
            v_parse_error := 'Invalid transaction date.';
          when datetime_field_overflow then
            v_parse_error := 'Invalid transaction date.';
          when invalid_datetime_format then
            v_parse_error := 'Invalid transaction date.';
        end;
      end if;

      if v_parse_error is null then
        if v_row->>'amount' is null or btrim(v_row->>'amount') = '' then
          v_parse_error := 'Missing amount.';
        else
          v_amount := public.bank_import_try_numeric(v_row->>'amount');
          if v_amount is null then
            v_parse_error := 'Invalid amount.';
          end if;
        end if;
      end if;

      v_desc := nullif(btrim(coalesce(v_row->>'description', '')), '');
      v_source_ref := coalesce(
        nullif(btrim(coalesce(v_row->>'sourceRef', '')), ''),
        nullif(btrim(coalesce(v_row->>'source_ref', '')), ''),
        ''
      );
      v_explicit_dir := lower(nullif(btrim(coalesce(v_row->>'direction', '')), ''));

      if v_parse_error is not null then
        insert into public.bank_statement_import_lines (
          batch_id, source_row_no, duplicate_status, rejection_reason, raw_row
        ) values (
          v_batch_id, v_source_row_no, 'rejected', v_parse_error, v_row
        );
        v_rejected_count := v_rejected_count + 1;
        continue;
      end if;

      if v_explicit_dir is not null and v_explicit_dir not in ('deposit', 'withdrawal') then
        insert into public.bank_statement_import_lines (
          batch_id, source_row_no, duplicate_status, rejection_reason, raw_row
        ) values (
          v_batch_id, v_source_row_no, 'rejected', 'Invalid direction.', v_row
        );
        v_rejected_count := v_rejected_count + 1;
        continue;
      end if;

      if v_explicit_dir is not null then
        if v_amount < 0 then
          insert into public.bank_statement_import_lines (
            batch_id, source_row_no, duplicate_status, rejection_reason, raw_row
          ) values (
            v_batch_id, v_source_row_no, 'rejected',
            'Amount sign conflicts with explicit direction.',
            v_row
          );
          v_rejected_count := v_rejected_count + 1;
          continue;
        end if;
        v_dir := v_explicit_dir;
        v_amount := abs(v_amount);
      else
        v_dir := case when v_amount >= 0 then 'deposit' else 'withdrawal' end;
        v_amount := abs(v_amount);
      end if;

      if v_amount <= 0 then
        insert into public.bank_statement_import_lines (
          batch_id, source_row_no, duplicate_status, rejection_reason, raw_row
        ) values (
          v_batch_id, v_source_row_no, 'rejected', 'Amount must be greater than zero.', v_row
        );
        v_rejected_count := v_rejected_count + 1;
        continue;
      end if;

      v_amount := round(v_amount::numeric, 2);

      -- TRANSACTION content key: account|date|abs_amount|direction|lower(desc)|sourceRef
      -- (NO source_row_no)
      v_content_key :=
        p_account_id::text || '|' ||
        v_date::text || '|' ||
        v_amount::text || '|' ||
        v_dir || '|' ||
        lower(coalesce(v_desc, '')) || '|' ||
        coalesce(v_source_ref, '');

      v_occ := coalesce((v_occ_map->>v_content_key)::int, 0) + 1;
      v_occ_map := v_occ_map || jsonb_build_object(v_content_key, v_occ);

      v_source_fp := md5(v_content_key || '|' || v_occ::text);

      -- Direction-aware heuristic (deposit vs withdrawal not conflated).
      v_heuristic_key :=
        v_date::text || '|' ||
        v_amount::text || '|' ||
        lower(coalesce(v_desc, '')) || '|' ||
        v_dir;

      v_existing_fp := null;
      v_possible_of := null;

      select l.id into v_existing_fp
      from public.bank_statement_import_lines l
      join public.bank_statement_import_batches b on b.id = l.batch_id
      where l.source_row_fingerprint = v_source_fp
        and l.duplicate_status in ('unmatched', 'possible_duplicate')
        and b.account_id = p_account_id
      limit 1;

      if v_existing_fp is not null then
        insert into public.bank_statement_import_lines (
          batch_id, source_row_no, transaction_date, description, amount, direction,
          duplicate_status, duplicate_reason, canonical_source_row_fingerprint,
          exact_reimport_of_line_id, raw_row,
          transaction_fingerprint, occurrence_index
        ) values (
          v_batch_id, v_source_row_no, v_date, v_desc, v_amount, v_dir,
          'exact_reimport',
          'Exact source row fingerprint already staged.',
          v_source_fp,
          v_existing_fp,
          v_row,
          v_content_key,
          v_occ
        );
        v_exact_reimport_count := v_exact_reimport_count + 1;
        v_staged_count := v_staged_count + 1;
        continue;
      end if;

      -- Cross-batch OR earlier-in-batch heuristic (direction required).
      select l.id into v_possible_of
      from public.bank_statement_import_lines l
      join public.bank_statement_import_batches b on b.id = l.batch_id
      where l.duplicate_status in ('unmatched', 'possible_duplicate')
        and b.account_id = p_account_id
        and l.transaction_date = v_date
        and round(l.amount, 2) = v_amount
        and lower(coalesce(l.description, '')) = lower(coalesce(v_desc, ''))
        and l.direction = v_dir
      order by l.created_at, l.source_row_no
      limit 1;

      if v_possible_of is not null then
        insert into public.bank_statement_import_lines (
          batch_id, source_row_no, transaction_date, description, amount, direction,
          duplicate_status, duplicate_reason, source_row_fingerprint,
          possible_duplicate_of_line_id, raw_row,
          transaction_fingerprint, occurrence_index
        ) values (
          v_batch_id, v_source_row_no, v_date, v_desc, v_amount, v_dir,
          'possible_duplicate',
          'Another transaction shares date, amount, direction, and description; review required.',
          v_source_fp,
          v_possible_of,
          v_row,
          v_content_key,
          v_occ
        );
        v_possible_dup_count := v_possible_dup_count + 1;
        v_staged_count := v_staged_count + 1;
        continue;
      end if;

      insert into public.bank_statement_import_lines (
        batch_id, source_row_no, transaction_date, description, amount, direction,
        duplicate_status, source_row_fingerprint, raw_row,
        transaction_fingerprint, occurrence_index
      ) values (
        v_batch_id, v_source_row_no, v_date, v_desc, v_amount, v_dir,
        'unmatched',
        v_source_fp,
        v_row,
        v_content_key,
        v_occ
      )
      returning id into v_line_id;

      v_staged_count := v_staged_count + 1;
    exception
      when unique_violation then
        v_existing_fp := null;
        select l.id into v_existing_fp
        from public.bank_statement_import_lines l
        join public.bank_statement_import_batches b on b.id = l.batch_id
        where l.source_row_fingerprint = v_source_fp
          and l.duplicate_status in ('unmatched', 'possible_duplicate')
          and b.account_id = p_account_id
        limit 1;
        if v_existing_fp is null then
          raise;
        end if;
        insert into public.bank_statement_import_lines (
          batch_id, source_row_no, transaction_date, description, amount, direction,
          duplicate_status, duplicate_reason, canonical_source_row_fingerprint,
          exact_reimport_of_line_id, raw_row, transaction_fingerprint, occurrence_index
        ) values (
          v_batch_id, v_source_row_no, v_date, v_desc, v_amount, v_dir,
          'exact_reimport',
          'Exact source row fingerprint already staged.',
          v_source_fp,
          v_existing_fp,
          v_row,
          v_content_key,
          v_occ
        );
        v_exact_reimport_count := v_exact_reimport_count + 1;
        v_staged_count := v_staged_count + 1;
      when others then
        insert into public.bank_statement_import_lines (
          batch_id, source_row_no, duplicate_status, rejection_reason, raw_row
        ) values (
          v_batch_id, v_source_row_no, 'rejected',
          left('Malformed row: ' || SQLERRM, 500),
          v_row
        );
        v_rejected_count := v_rejected_count + 1;
    end;
  end loop;

  update public.bank_statement_import_batches
  set source_row_count = v_source_count,
      staged_row_count = v_staged_count,
      rejected_row_count = v_rejected_count,
      exact_reimport_count = v_exact_reimport_count,
      possible_duplicate_count = v_possible_dup_count
  where id = v_batch_id;

  perform public.accounting_audit_from_definer_safe(
    'bank_statement_imported',
    'bank_statement_import_batch',
    v_batch_id,
    current_date,
    null,
    jsonb_build_object(
      'fileName', p_file_name,
      'importFingerprint', v_import_fp,
      'sourceRowCount', v_source_count,
      'stagedRowCount', v_staged_count,
      'rejectedRowCount', v_rejected_count,
      'exactReimportCount', v_exact_reimport_count,
      'possibleDuplicateCount', v_possible_dup_count
    ),
    v_actor,
    'audit:bank_import:' || v_batch_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'import_fingerprint', v_import_fp,
    'source_row_count', v_source_count,
    'staged_row_count', v_staged_count,
    'rejected_row_count', v_rejected_count,
    'exact_reimport_count', v_exact_reimport_count,
    'possible_duplicate_count', v_possible_dup_count
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. create_bank_reconciliation_safe
-- ---------------------------------------------------------------------------
create or replace function public.create_bank_reconciliation_safe(
  p_account_id uuid,
  p_statement_start date,
  p_statement_end date,
  p_opening_balance numeric,
  p_ending_balance numeric,
  p_notes text default null,
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
  v_existing_account uuid;
  v_existing_start date;
  v_existing_end date;
  v_existing_open numeric;
  v_existing_end_bal numeric;
  v_overlap uuid;
  v_id uuid;
  v_key text;
  v_open numeric;
  v_end numeric;
  v_prior_id uuid;
  v_prior_end numeric;
  v_prior_date date;
  v_continuity_warning text := null;
  v_continuity_diff numeric := 0;
begin
  perform public.accounting_require_roles(ARRAY['admin', 'office'], 'create bank reconciliation');
  v_actor := public.accounting_actor_id(p_actor);

  if p_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'Bank/cash account is required.');
  end if;
  if not public.accounting_is_eligible_cash_account(p_account_id) then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation requires an active bank/cash GL account.');
  end if;
  if p_statement_start is null or p_statement_end is null or p_statement_end < p_statement_start then
    return jsonb_build_object('ok', false, 'error', 'Invalid statement period.');
  end if;

  v_open := round(coalesce(p_opening_balance, 0)::numeric, 2);
  v_end := round(coalesce(p_ending_balance, 0)::numeric, 2);
  if abs(v_open) > 9999999999.99 or abs(v_end) > 9999999999.99 then
    return jsonb_build_object('ok', false, 'error', 'Opening or ending balance is outside the allowed numeric range.');
  end if;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');

  perform public.bank_recon_lock_account(p_account_id);

  if v_key is not null then
    select
      id, account_id, statement_start, statement_end, opening_balance, ending_balance
    into
      v_existing, v_existing_account, v_existing_start, v_existing_end,
      v_existing_open, v_existing_end_bal
    from public.bank_reconciliation_sessions
    where idempotency_key = v_key
    limit 1;
    if v_existing is not null then
      if v_existing_account is not distinct from p_account_id
         and v_existing_start is not distinct from p_statement_start
         and v_existing_end is not distinct from p_statement_end
         and round(coalesce(v_existing_open, 0), 2) = v_open
         and round(coalesce(v_existing_end_bal, 0), 2) = v_end
      then
        return jsonb_build_object('ok', true, 'session_id', v_existing, 'duplicate', true);
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used with a different reconciliation context.',
        'session_id', v_existing
      );
    end if;
  end if;

  -- Overlap vs successfully finalized (reconciled/completed) BLOCKS.
  -- void/cancelled do NOT block replacement.
  select s.id into v_overlap
  from public.bank_reconciliation_sessions s
  where s.account_id = p_account_id
    and public.bank_recon_session_is_successfully_finalized(s.status)
    and s.statement_start <= p_statement_end
    and s.statement_end >= p_statement_start
  limit 1;
  if v_overlap is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'A finalized reconciliation already overlaps this account and period.',
      'overlapping_session_id', v_overlap
    );
  end if;

  -- Second editable session on the same account overlapping this period is blocked.
  select s.id into v_overlap
  from public.bank_reconciliation_sessions s
  where s.account_id = p_account_id
    and public.bank_recon_session_is_editable(s.status)
    and s.statement_start <= p_statement_end
    and s.statement_end >= p_statement_start
  limit 1;
  if v_overlap is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'An in-progress reconciliation already overlaps this account and period.',
      'overlapping_session_id', v_overlap
    );
  end if;

  -- Continuity vs prior successfully finalized ending. Warn on mismatch;
  -- block only when the gap is absurd (fat-finger / overflow-scale).
  select s.id, s.ending_balance, s.statement_end
    into v_prior_id, v_prior_end, v_prior_date
  from public.bank_reconciliation_sessions s
  where s.account_id = p_account_id
    and public.bank_recon_session_is_successfully_finalized(s.status)
    and s.statement_end < p_statement_start
  order by s.statement_end desc, s.completed_at desc nulls last
  limit 1;

  if v_prior_id is not null then
    v_continuity_diff := round((v_open - coalesce(v_prior_end, 0))::numeric, 2);
    if abs(v_continuity_diff) > 0.005 then
      if abs(v_continuity_diff) > 1000000 then
        return jsonb_build_object(
          'ok', false,
          'error', format(
            'Opening balance ($%s) is absurdly far from prior reconciled ending ($%s).',
            to_char(v_open, 'FM9999999990.00'),
            to_char(v_prior_end, 'FM9999999990.00')
          ),
          'prior_session_id', v_prior_id
        );
      end if;
      v_continuity_warning := format(
        'Opening balance ($%s) does not match prior reconciled ending ($%s) from session ending %s.',
        to_char(v_open, 'FM9999999990.00'),
        to_char(v_prior_end, 'FM9999999990.00'),
        v_prior_date::text
      );
    end if;
  end if;

  insert into public.bank_reconciliation_sessions (
    account_id, statement_start, statement_end,
    opening_balance, ending_balance, status, notes,
    created_by, idempotency_key, updated_at
  ) values (
    p_account_id, p_statement_start, p_statement_end,
    v_open, v_end,
    'draft', nullif(btrim(coalesce(p_notes, '')), ''), v_actor, v_key, now()
  )
  returning id into v_id;

  perform public.accounting_audit_from_definer_safe(
    'bank_reconciliation_created',
    'bank_reconciliation_session',
    v_id,
    p_statement_end,
    null,
    jsonb_build_object(
      'sessionId', v_id,
      'accountId', p_account_id,
      'statementStart', p_statement_start,
      'statementEnd', p_statement_end,
      'openingBalance', v_open,
      'endingBalance', v_end,
      'continuityWarning', v_continuity_warning,
      'priorSessionId', v_prior_id
    ),
    v_actor,
    'audit:bank_recon_create:' || v_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'session_id', v_id,
    'status', 'draft',
    'duplicate', false,
    'warning', v_continuity_warning,
    'continuity_warning', v_continuity_warning,
    'prior_session_id', v_prior_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. attach_bank_import_to_reconciliation_safe
-- ---------------------------------------------------------------------------
create or replace function public.attach_bank_import_to_reconciliation_safe(
  p_session_id uuid,
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
  v_sess public.bank_reconciliation_sessions%rowtype;
  v_batch public.bank_statement_import_batches%rowtype;
  v_oop int := 0;
  v_match_count int := 0;
  v_account uuid;
  v_conflicting uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin', 'office'], 'attach bank import');
  v_actor := public.accounting_actor_id(p_actor);

  select account_id into v_account
  from public.bank_reconciliation_sessions
  where id = p_session_id;
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation session not found.');
  end if;

  perform public.bank_recon_lock_account(v_account);

  select * into v_sess
  from public.bank_reconciliation_sessions
  where id = p_session_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation session not found.');
  end if;
  if not public.bank_recon_session_is_editable(v_sess.status) then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation is not editable.');
  end if;

  select * into v_batch from public.bank_statement_import_batches where id = p_batch_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Import batch not found.');
  end if;
  if v_batch.account_id is distinct from v_sess.account_id then
    return jsonb_build_object('ok', false, 'error', 'Import batch account does not match reconciliation account.');
  end if;

  if coalesce(v_batch.status, '') = 'cancelled' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Cannot attach a cancelled import batch.'
    );
  end if;
  if coalesce(v_batch.status, '') not in ('staged', 'reviewed', 'matched') then
    return jsonb_build_object(
      'ok', false,
      'error', format('Import batch status %s cannot be attached.', coalesce(v_batch.status, 'unknown'))
    );
  end if;

  select s.id into v_conflicting
  from public.bank_reconciliation_sessions s
  where s.import_batch_id = p_batch_id
    and s.id <> p_session_id
    and (
      public.bank_recon_session_is_editable(s.status)
      or public.bank_recon_session_is_successfully_finalized(s.status)
    )
  limit 1;
  if v_conflicting is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Import batch is already attached to another active or finalized reconciliation.',
      'conflicting_session_id', v_conflicting
    );
  end if;

  if v_sess.import_batch_id is not null
     and v_sess.import_batch_id is not distinct from p_batch_id then
    return jsonb_build_object(
      'ok', true,
      'session_id', p_session_id,
      'batch_id', p_batch_id,
      'duplicate', true
    );
  end if;

  select count(*) into v_match_count
  from public.bank_reconciliation_matches m
  where m.session_id = p_session_id
    and m.status = 'active';

  if v_sess.import_batch_id is not null
     and v_sess.import_batch_id is distinct from p_batch_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'An import batch is already attached. Replace is not allowed once a batch is set.'
    );
  end if;

  if v_match_count > 0
     and v_sess.import_batch_id is distinct from p_batch_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'Cannot replace the import batch while matches exist.'
    );
  end if;

  -- Canonical (included) lines must fall in the statement period, or be excluded.
  select count(*) into v_oop
  from public.bank_statement_import_lines l
  where l.batch_id = p_batch_id
    and public.bank_import_line_included_in_statement(l.duplicate_status, l.review_status)
    and (
      l.transaction_date is null
      or l.transaction_date < v_sess.statement_start
      or l.transaction_date > v_sess.statement_end
    );
  if v_oop > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        '%s canonical import line(s) fall outside the statement period. Exclude them before attaching.',
        v_oop
      )
    );
  end if;

  update public.bank_reconciliation_sessions
  set import_batch_id = p_batch_id,
      status = case when status = 'draft' then 'in_progress' else status end,
      updated_at = now()
  where id = p_session_id;

  perform public.accounting_audit_from_definer_safe(
    'bank_import_attached',
    'bank_reconciliation_session',
    p_session_id,
    v_sess.statement_end,
    null,
    jsonb_build_object(
      'sessionId', p_session_id,
      'batchId', p_batch_id
    ),
    v_actor,
    'audit:bank_recon_attach:' || p_session_id::text || ':' || p_batch_id::text
  );

  return jsonb_build_object('ok', true, 'session_id', p_session_id, 'batch_id', p_batch_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. create_bank_match_safe
-- ---------------------------------------------------------------------------
create or replace function public.create_bank_match_safe(
  p_session_id uuid,
  p_import_line_id uuid,
  p_journal_line_id uuid,
  p_allocated_amount numeric,
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
  v_sess public.bank_reconciliation_sessions%rowtype;
  v_import public.bank_statement_import_lines%rowtype;
  v_jl public.journal_lines%rowtype;
  v_je public.journal_entries%rowtype;
  v_existing public.bank_reconciliation_matches%rowtype;
  v_bank_allocated numeric := 0;
  v_journal_allocated numeric := 0;
  v_journal_available numeric := 0;
  v_match_id uuid;
  v_alloc numeric;
  v_key text;
  v_account uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin', 'office'], 'create bank match');
  v_actor := public.accounting_actor_id(p_actor);
  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');

  if p_session_id is null or p_import_line_id is null or p_journal_line_id is null then
    return jsonb_build_object('ok', false, 'error', 'Session, import line, and journal line are required.');
  end if;

  select account_id into v_account
  from public.bank_reconciliation_sessions
  where id = p_session_id;
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation session not found.');
  end if;

  perform public.bank_recon_lock_account(v_account);

  -- Lock order: account advisory → session → import line → journal line.
  select * into v_sess
  from public.bank_reconciliation_sessions
  where id = p_session_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation session not found.');
  end if;
  if not public.bank_recon_session_is_editable(v_sess.status) then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation is not editable.');
  end if;

  select * into v_import
  from public.bank_statement_import_lines
  where id = p_import_line_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Bank import line not found.');
  end if;

  select * into v_jl
  from public.journal_lines
  where id = p_journal_line_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Journal line not found.');
  end if;

  if v_sess.import_batch_id is distinct from v_import.batch_id then
    return jsonb_build_object('ok', false, 'error', 'Import line does not belong to this reconciliation batch.');
  end if;
  if v_import.duplicate_status = 'exact_reimport' then
    return jsonb_build_object('ok', false, 'error', 'Exact reimport rows are not matchable.');
  end if;
  if v_import.duplicate_status = 'rejected' or v_import.review_status = 'excluded' then
    return jsonb_build_object('ok', false, 'error', 'Cannot match rejected or excluded bank lines.');
  end if;
  if v_import.duplicate_status = 'possible_duplicate' and v_import.review_status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'Resolve possible duplicate before matching.');
  end if;
  if not public.bank_import_line_included_in_statement(
       v_import.duplicate_status, v_import.review_status
     )
  then
    return jsonb_build_object('ok', false, 'error', 'Import line is not included in statement totals.');
  end if;

  if v_jl.account_id is distinct from v_sess.account_id then
    return jsonb_build_object('ok', false, 'error', 'Journal line is not on the reconciliation bank account.');
  end if;

  select * into v_je from public.journal_entries where id = v_jl.journal_entry_id;
  if v_je.status is distinct from 'posted' then
    return jsonb_build_object('ok', false, 'error', 'Only posted journal lines can be matched.');
  end if;
  if v_je.entry_date > v_sess.statement_end then
    return jsonb_build_object(
      'ok', false,
      'error', 'Journal entry date cannot be after the statement end date.'
    );
  end if;

  -- One-sided journal: reject both debit and credit > 0, or both 0.
  if (coalesce(v_jl.debit, 0) > 0 and coalesce(v_jl.credit, 0) > 0)
     or (coalesce(v_jl.debit, 0) = 0 and coalesce(v_jl.credit, 0) = 0) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Journal line must be one-sided (debit or credit, not both or neither).'
    );
  end if;

  -- Direction integrity: deposit ↔ debit; withdrawal ↔ credit on bank asset.
  if v_import.direction = 'deposit' and coalesce(v_jl.debit, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Bank deposit must match a bank-account debit (inflow).');
  end if;
  if v_import.direction = 'withdrawal' and coalesce(v_jl.credit, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Bank withdrawal must match a bank-account credit (outflow).');
  end if;

  v_alloc := round(coalesce(p_allocated_amount, 0)::numeric, 2);
  if v_alloc <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Allocation must be positive.');
  end if;
  if p_allocated_amount is distinct from v_alloc then
    return jsonb_build_object(
      'ok', false,
      'error', 'Allocation must be exact cents (at most 2 decimal places).'
    );
  end if;

  if v_key is not null then
    select * into v_existing
    from public.bank_reconciliation_matches
    where idempotency_key = v_key
    limit 1;
    if found then
      if v_existing.session_id = p_session_id
         and v_existing.import_line_id = p_import_line_id
         and v_existing.journal_line_id = p_journal_line_id
         and round(v_existing.allocated_amount, 2) = v_alloc then
        return jsonb_build_object('ok', true, 'match_id', v_existing.id, 'duplicate', true);
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used with a different match context.',
        'match_id', v_existing.id
      );
    end if;
  end if;

  v_bank_allocated := public.bank_recon_effective_import_allocated(
    p_import_line_id, p_session_id
  );

  if round((v_bank_allocated + v_alloc)::numeric, 2) > round(v_import.amount::numeric, 2) + 0.0001 then
    return jsonb_build_object('ok', false, 'error', 'Bank line overallocation.');
  end if;

  v_journal_available := round(
    greatest(coalesce(v_jl.debit, 0), coalesce(v_jl.credit, 0))::numeric,
    2
  );
  v_journal_allocated := public.bank_recon_effective_journal_allocated(
    p_journal_line_id, p_session_id
  );

  if round((v_journal_allocated + v_alloc)::numeric, 2) > v_journal_available + 0.0001 then
    return jsonb_build_object('ok', false, 'error', 'Journal line overallocation.');
  end if;

  insert into public.bank_reconciliation_matches (
    session_id, import_line_id, journal_line_id, allocated_amount,
    created_by, idempotency_key
  ) values (
    p_session_id, p_import_line_id, p_journal_line_id, v_alloc,
    v_actor, v_key
  )
  returning id into v_match_id;

  -- Cleared_lines only when the journal line is fully allocated.
  perform public.bank_recon_sync_journal_cleared(p_session_id, p_journal_line_id);

  update public.bank_reconciliation_sessions
  set status = case when status in ('draft', 'open') then 'in_progress' else status end,
      updated_at = now()
  where id = p_session_id;

  perform public.accounting_audit_from_definer_safe(
    'bank_match_created',
    'bank_reconciliation_match',
    v_match_id,
    v_je.entry_date,
    null,
    jsonb_build_object(
      'sessionId', p_session_id,
      'importLineId', p_import_line_id,
      'journalLineId', p_journal_line_id,
      'allocatedAmount', v_alloc
    ),
    v_actor,
    'audit:bank_match:' || v_match_id::text
  );

  return jsonb_build_object('ok', true, 'match_id', v_match_id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. remove_bank_match_safe
-- ---------------------------------------------------------------------------
create or replace function public.remove_bank_match_safe(
  p_match_id uuid,
  p_reason text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_match public.bank_reconciliation_matches%rowtype;
  v_sess public.bank_reconciliation_sessions%rowtype;
  v_reason text;
  v_account uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin', 'office'], 'remove bank match');
  v_actor := public.accounting_actor_id(p_actor);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'A reason is required to remove a match.');
  end if;

  select m.* into v_match
  from public.bank_reconciliation_matches m
  where m.id = p_match_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Match not found.');
  end if;
  if v_match.status = 'removed' then
    return jsonb_build_object('ok', true, 'match_id', p_match_id, 'duplicate', true);
  end if;

  select account_id into v_account
  from public.bank_reconciliation_sessions
  where id = v_match.session_id;
  perform public.bank_recon_lock_account(v_account);

  select * into v_sess
  from public.bank_reconciliation_sessions
  where id = v_match.session_id
  for update;
  if not public.bank_recon_session_is_editable(v_sess.status) then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation is not editable.');
  end if;

  select * into v_match
  from public.bank_reconciliation_matches
  where id = p_match_id
  for update;

  update public.bank_reconciliation_matches
  set status = 'removed',
      removed_by = v_actor,
      removed_at = now(),
      removal_reason = v_reason
  where id = p_match_id;

  perform public.bank_recon_sync_journal_cleared(v_match.session_id, v_match.journal_line_id);

  update public.bank_reconciliation_sessions
  set updated_at = now()
  where id = v_match.session_id;

  perform public.accounting_audit_from_definer_safe(
    'bank_match_removed',
    'bank_reconciliation_match',
    p_match_id,
    v_sess.statement_end,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object('sessionId', v_match.session_id, 'matchId', p_match_id),
    v_actor,
    'audit:bank_match_remove:' || p_match_id::text
  );

  return jsonb_build_object('ok', true, 'match_id', p_match_id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. resolve_bank_import_duplicate_safe
-- ---------------------------------------------------------------------------
create or replace function public.resolve_bank_import_duplicate_safe(
  p_import_line_id uuid,
  p_resolution text,
  p_reason text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_line public.bank_statement_import_lines%rowtype;
  v_sess public.bank_reconciliation_sessions%rowtype;
  v_reason text;
  v_account uuid;
  v_batch_id uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin', 'office'], 'resolve bank import duplicate');
  v_actor := public.accounting_actor_id(p_actor);

  select batch_id into v_batch_id
  from public.bank_statement_import_lines
  where id = p_import_line_id;
  if v_batch_id is null then
    return jsonb_build_object('ok', false, 'error', 'Import line not found.');
  end if;

  if public.bank_recon_batch_has_protected_session(v_batch_id) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Cannot resolve duplicates on import lines used by finalized reconciliation history.'
    );
  end if;

  select s.account_id into v_account
  from public.bank_reconciliation_sessions s
  where s.import_batch_id = v_batch_id
    and public.bank_recon_session_is_editable(s.status)
  order by s.created_at desc
  limit 1;

  if v_account is not null then
    perform public.bank_recon_lock_account(v_account);
  end if;

  select s.* into v_sess
  from public.bank_reconciliation_sessions s
  where s.import_batch_id = v_batch_id
    and public.bank_recon_session_is_editable(s.status)
  order by s.created_at desc
  limit 1
  for update of s;

  select * into v_line
  from public.bank_statement_import_lines
  where id = p_import_line_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Import line not found.');
  end if;
  if v_line.duplicate_status <> 'possible_duplicate' then
    return jsonb_build_object('ok', false, 'error', 'Line is not a possible duplicate.');
  end if;
  if p_resolution not in ('accepted', 'excluded') then
    return jsonb_build_object('ok', false, 'error', 'Resolution must be accepted or excluded.');
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_resolution = 'excluded' and v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'A reason is required to exclude a possible duplicate.');
  end if;

  if v_line.review_status = p_resolution then
    return jsonb_build_object(
      'ok', true,
      'import_line_id', p_import_line_id,
      'resolution', p_resolution,
      'duplicate', true
    );
  end if;

  if p_resolution = 'excluded' and exists (
    select 1
    from public.bank_reconciliation_matches m
    where m.import_line_id = p_import_line_id
      and m.status = 'active'
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Cannot exclude a line that still has active matches.'
    );
  end if;

  if p_resolution = 'accepted'
     and v_sess.id is not null
     and (
       v_line.transaction_date is null
       or v_line.transaction_date < v_sess.statement_start
       or v_line.transaction_date > v_sess.statement_end
     )
  then
    return jsonb_build_object(
      'ok', false,
      'error', 'Accepted duplicate line must fall within the attached reconciliation statement period.'
    );
  end if;

  update public.bank_statement_import_lines
  set review_status = p_resolution,
      exclusion_reason = case
        when p_resolution = 'excluded' then v_reason
        when p_resolution = 'accepted' then null
        else exclusion_reason
      end
  where id = p_import_line_id;

  perform public.accounting_audit_from_definer_safe(
    'bank_duplicate_resolved',
    'bank_statement_import_line',
    p_import_line_id,
    v_line.transaction_date,
    v_reason,
    jsonb_build_object('resolution', p_resolution, 'importLineId', p_import_line_id),
    v_actor,
    'audit:bank_dup_resolve:' || p_import_line_id::text || ':' || p_resolution
  );

  return jsonb_build_object(
    'ok', true,
    'import_line_id', p_import_line_id,
    'resolution', p_resolution,
    'duplicate', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. exclude_bank_import_line_safe
-- ---------------------------------------------------------------------------
create or replace function public.exclude_bank_import_line_safe(
  p_import_line_id uuid,
  p_reason text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_line public.bank_statement_import_lines%rowtype;
  v_sess public.bank_reconciliation_sessions%rowtype;
  v_reason text;
  v_account uuid;
  v_batch_id uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin', 'office'], 'exclude bank import line');
  v_actor := public.accounting_actor_id(p_actor);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'Exclusion reason is required.');
  end if;

  select batch_id into v_batch_id
  from public.bank_statement_import_lines
  where id = p_import_line_id;
  if v_batch_id is null then
    return jsonb_build_object('ok', false, 'error', 'Import line not found.');
  end if;

  if public.bank_recon_batch_has_protected_session(v_batch_id) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Cannot exclude import lines used by finalized reconciliation history.'
    );
  end if;

  select s.account_id into v_account
  from public.bank_reconciliation_sessions s
  where s.import_batch_id = v_batch_id
    and public.bank_recon_session_is_editable(s.status)
  order by s.created_at desc
  limit 1;

  if v_account is not null then
    perform public.bank_recon_lock_account(v_account);
  end if;

  select s.* into v_sess
  from public.bank_reconciliation_sessions s
  where s.import_batch_id = v_batch_id
    and public.bank_recon_session_is_editable(s.status)
  order by s.created_at desc
  limit 1
  for update of s;

  select * into v_line
  from public.bank_statement_import_lines
  where id = p_import_line_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Import line not found.');
  end if;

  if v_sess.id is not null then
    if not public.bank_recon_session_is_editable(v_sess.status) then
      return jsonb_build_object(
        'ok', false,
        'error', 'Reconciliation is not editable; cannot exclude import lines.'
      );
    end if;
  end if;

  if v_line.review_status = 'excluded' then
    return jsonb_build_object(
      'ok', true,
      'import_line_id', p_import_line_id,
      'duplicate', true
    );
  end if;

  if exists (
    select 1
    from public.bank_reconciliation_matches m
    where m.import_line_id = p_import_line_id
      and m.status = 'active'
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Cannot exclude a line that still has active matches.'
    );
  end if;

  update public.bank_statement_import_lines
  set review_status = 'excluded',
      exclusion_reason = v_reason
  where id = p_import_line_id;

  -- Audit exactly once via idempotency key (replay is a no-op in the audit log).
  perform public.accounting_audit_from_definer_safe(
    'bank_import_line_excluded',
    'bank_statement_import_line',
    p_import_line_id,
    v_line.transaction_date,
    v_reason,
    jsonb_build_object('importLineId', p_import_line_id),
    v_actor,
    'audit:bank_import_line_excluded:' || p_import_line_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'import_line_id', p_import_line_id,
    'duplicate', false
  );
end;
$$;

-- Drop pre-hardening finalize/complete overloads that bypass explicit confirmation.
drop function if exists public.finalize_bank_reconciliation_safe(uuid, uuid);
drop function if exists public.complete_bank_reconciliation_safe(uuid, uuid);

-- ---------------------------------------------------------------------------
-- 15. finalize_bank_reconciliation_safe
-- ---------------------------------------------------------------------------
create or replace function public.finalize_bank_reconciliation_safe(
  p_session_id uuid,
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
  v_sess public.bank_reconciliation_sessions%rowtype;
  v_pkg jsonb;
  v_overlap uuid;
  v_snapshot jsonb;
  v_account uuid;
  v_match_summary jsonb;
  v_match_digest text;
  v_import_evidence jsonb;
begin
  perform public.accounting_require_roles(ARRAY['admin', 'office'], 'finalize bank reconciliation');
  v_actor := public.accounting_actor_id(p_actor);

  select account_id into v_account
  from public.bank_reconciliation_sessions
  where id = p_session_id;
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation session not found.');
  end if;

  perform public.bank_recon_lock_account(v_account);

  select * into v_sess
  from public.bank_reconciliation_sessions
  where id = p_session_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation session not found.');
  end if;

  if public.bank_recon_session_is_successfully_finalized(v_sess.status) then
    return jsonb_build_object('ok', true, 'session_id', p_session_id, 'duplicate', true);
  end if;

  if not coalesce(p_confirm, false) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Finalization requires explicit confirmation (p_confirm = true).'
    );
  end if;

  if not public.bank_recon_session_is_editable(v_sess.status) then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation cannot be finalized in current status.');
  end if;

  if not public.accounting_is_eligible_cash_account(v_sess.account_id) then
    return jsonb_build_object('ok', false, 'error', 'Session account is not a valid bank/cash GL account.');
  end if;

  if v_sess.statement_start is null
     or v_sess.statement_end is null
     or v_sess.statement_end < v_sess.statement_start then
    return jsonb_build_object('ok', false, 'error', 'Invalid statement period.');
  end if;

  if v_sess.import_batch_id is null then
    return jsonb_build_object('ok', false, 'error', 'Attach a bank statement import before finalizing.');
  end if;

  if not exists (
    select 1
    from public.bank_statement_import_batches b
    where b.id = v_sess.import_batch_id
      and b.account_id = v_sess.account_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'Import batch account does not match reconciliation account.');
  end if;

  v_pkg := public.bank_reconciliation_compute_package(p_session_id);
  if coalesce((v_pkg->>'ok')::boolean, false) is not true then
    return v_pkg;
  end if;

  if coalesce((v_pkg->>'unresolved_possible_duplicates')::int, 0) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Resolve possible duplicate rows before finalizing.',
      'package', v_pkg
    );
  end if;

  if coalesce((v_pkg->>'unresolved_rejected')::int, 0) > 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Exclude or correct rejected import rows before finalizing.',
      'package', v_pkg
    );
  end if;

  if abs(coalesce((v_pkg->>'statement_equation_difference')::numeric, 0)) > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Statement equation does not balance (opening + deposits − withdrawals ≠ ending).',
      'package', v_pkg
    );
  end if;

  if abs(coalesce((v_pkg->>'remaining_bank_deposits')::numeric, 0)) > 0.005
     or abs(coalesce((v_pkg->>'remaining_bank_withdrawals')::numeric, 0)) > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Included bank lines still have unmatched remaining amounts.',
      'package', v_pkg
    );
  end if;

  if abs(coalesce((v_pkg->>'book_vs_adjusted_difference')::numeric, 0)) > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', format(
        'Cannot finalize with nonzero book vs adjusted-bank difference ($%s).',
        to_char(coalesce((v_pkg->>'book_vs_adjusted_difference')::numeric, 0), 'FM999999990.00')
      ),
      'package', v_pkg
    );
  end if;

  if coalesce((v_pkg->>'match_integrity_ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', 'Match integrity failed (account, posted, direction, or allocation).',
      'package', v_pkg
    );
  end if;

  if coalesce((v_pkg->>'can_finalize')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', 'Reconciliation cannot be finalized; review the compute package gates.',
      'package', v_pkg
    );
  end if;

  -- Overlap lock only vs successfully finalized (NOT void/cancelled).
  select id into v_overlap
  from public.bank_reconciliation_sessions s
  where s.id <> p_session_id
    and s.account_id = v_sess.account_id
    and public.bank_recon_session_is_successfully_finalized(s.status)
    and s.statement_start <= v_sess.statement_end
    and s.statement_end >= v_sess.statement_start
  limit 1;
  if v_overlap is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Another finalized reconciliation overlaps this account and period.',
      'overlapping_session_id', v_overlap
    );
  end if;

  v_snapshot := v_pkg || jsonb_build_object(
    'finalized_at', now(),
    'finalized_by', v_actor,
    'opening_balance', v_sess.opening_balance,
    'ending_balance', v_sess.ending_balance,
    'statement_start', v_sess.statement_start,
    'statement_end', v_sess.statement_end,
    'import_batch_id', v_sess.import_batch_id,
    'account_id', v_sess.account_id
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'match_id', m.id,
        'import_line_id', m.import_line_id,
        'journal_line_id', m.journal_line_id,
        'allocated_amount', m.allocated_amount,
        'bank_direction', l.direction
      )
      order by m.id
    ),
    '[]'::jsonb
  )
  into v_match_summary
  from public.bank_reconciliation_matches m
  join public.bank_statement_import_lines l on l.id = m.import_line_id
  where m.session_id = p_session_id
    and m.status = 'active';

  v_match_digest := md5(coalesce(v_match_summary::text, '[]'));

  select jsonb_build_object(
    'canonical_included_line_count', coalesce(sum(case
      when public.bank_import_line_included_in_statement(l.duplicate_status, l.review_status)
      then 1 else 0 end), 0),
    'excluded_line_count', coalesce(sum(case
      when coalesce(l.review_status, 'pending') = 'excluded' then 1 else 0 end), 0),
    'rejected_count', coalesce(sum(case
      when l.duplicate_status = 'rejected' then 1 else 0 end), 0),
    'possible_duplicate_resolved_count', coalesce(sum(case
      when l.duplicate_status = 'possible_duplicate'
       and coalesce(l.review_status, 'pending') <> 'pending'
      then 1 else 0 end), 0),
    'exact_reimport_evidence_count', coalesce(sum(case
      when l.duplicate_status = 'exact_reimport' then 1 else 0 end), 0)
  )
  into v_import_evidence
  from public.bank_statement_import_lines l
  where l.batch_id = v_sess.import_batch_id;

  v_snapshot := v_snapshot || jsonb_build_object(
    'match_summary', v_match_summary,
    'match_allocation_digest', v_match_digest,
    'import_evidence', v_import_evidence
  );

  update public.bank_reconciliation_sessions
  set prior_status = status,
      status = 'reconciled',
      completed_by = v_actor,
      completed_at = now(),
      calculated_ending_balance = coalesce((v_pkg->>'calculated_ending_balance')::numeric, 0),
      difference = 0,
      final_snapshot = v_snapshot,
      updated_at = now()
  where id = p_session_id;

  perform public.accounting_audit_from_definer_safe(
    'bank_reconciliation_finalized',
    'bank_reconciliation_session',
    p_session_id,
    v_sess.statement_end,
    null,
    jsonb_build_object('sessionId', p_session_id, 'package', v_pkg),
    v_actor,
    'audit:bank_recon_finalize:' || p_session_id::text
  );

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'status', 'reconciled',
    'calculated_ending_balance', coalesce((v_pkg->>'calculated_ending_balance')::numeric, 0),
    'difference', 0,
    'duplicate', false,
    'package', v_pkg
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. void_bank_reconciliation_safe
--     draft/in_progress/open → cancelled (audit bank_reconciliation_cancelled)
--     reconciled/completed → void only if books_of_record is false
--       (audit bank_reconciliation_voided)
--     Terminal does not block replacement. Snapshot and matches preserved.
-- ---------------------------------------------------------------------------
create or replace function public.void_bank_reconciliation_safe(
  p_session_id uuid,
  p_reason text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_sess public.bank_reconciliation_sessions%rowtype;
  v_books boolean := false;
  v_reason text;
  v_new_status text;
  v_audit_action text;
  v_audit_key text;
  v_account uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin'], 'void bank reconciliation');
  v_actor := public.accounting_actor_id(p_actor);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'Void reason is required.');
  end if;

  select account_id into v_account
  from public.bank_reconciliation_sessions
  where id = p_session_id;
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation session not found.');
  end if;

  perform public.bank_recon_lock_account(v_account);

  select * into v_sess
  from public.bank_reconciliation_sessions
  where id = p_session_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Reconciliation session not found.');
  end if;

  if public.bank_recon_session_is_terminal(v_sess.status) then
    return jsonb_build_object('ok', true, 'session_id', p_session_id, 'duplicate', true);
  end if;

  if public.bank_recon_session_is_editable(v_sess.status) then
    v_new_status := 'cancelled';
    v_audit_action := 'bank_reconciliation_cancelled';
    v_audit_key := 'audit:bank_recon_cancel:' || p_session_id::text;

    update public.bank_reconciliation_sessions
    set prior_status = status,
        status = 'cancelled',
        cancelled_by = v_actor,
        cancelled_at = now(),
        void_reason = v_reason,
        updated_at = now()
    where id = p_session_id;
  elsif public.bank_recon_session_is_successfully_finalized(v_sess.status) then
    select coalesce(books_of_record, false) into v_books
    from public.accounting_settings
    where id = 1;

    if coalesce(v_books, false) then
      return jsonb_build_object(
        'ok', false,
        'error', 'Cannot void reconciliations after books_of_record is enabled without a controlled reversal workflow.'
      );
    end if;

    v_new_status := 'void';
    v_audit_action := 'bank_reconciliation_voided';
    v_audit_key := 'audit:bank_recon_void:' || p_session_id::text;

    update public.bank_reconciliation_sessions
    set prior_status = status,
        status = 'void',
        voided_by = v_actor,
        voided_at = now(),
        void_reason = v_reason,
        updated_at = now()
    where id = p_session_id;
  else
    return jsonb_build_object('ok', false, 'error', 'Reconciliation cannot be voided.');
  end if;

  perform public.accounting_audit_from_definer_safe(
    v_audit_action,
    'bank_reconciliation_session',
    p_session_id,
    v_sess.statement_end,
    v_reason,
    jsonb_build_object(
      'sessionId', p_session_id,
      'priorStatus', v_sess.status,
      'newStatus', v_new_status
    ),
    v_actor,
    v_audit_key
  );

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'status', v_new_status,
    'duplicate', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. complete_bank_reconciliation_safe — legacy wrapper; requires p_confirm
-- ---------------------------------------------------------------------------
create or replace function public.complete_bank_reconciliation_safe(
  p_session_id uuid,
  p_completed_by uuid default null,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.finalize_bank_reconciliation_safe(p_session_id, p_completed_by, p_confirm);
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. EXECUTE ACLs — exact overloads
--     Staff RPCs: authenticated + service_role. PUBLIC/anon: none.
--     Internal compute + lock/sync helpers: service_role only.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_staff text[] := array[
    'stage_bank_statement_import_safe',
    'create_bank_reconciliation_safe',
    'attach_bank_import_to_reconciliation_safe',
    'create_bank_match_safe',
    'remove_bank_match_safe',
    'resolve_bank_import_duplicate_safe',
    'exclude_bank_import_line_safe',
    'finalize_bank_reconciliation_safe',
    'void_bank_reconciliation_safe',
    'complete_bank_reconciliation_safe',
    'bank_recon_session_is_editable',
    'bank_recon_session_is_successfully_finalized',
    'bank_recon_session_is_terminal',
    'bank_import_line_included_in_statement'
  ];
  v_internal text[] := array[
    'bank_reconciliation_compute_package',
    'bank_recon_sync_journal_cleared',
    'bank_recon_lock_account',
    'bank_import_try_numeric',
    'bank_import_try_date',
    'bank_import_fingerprint_line',
    'bank_recon_session_was_finalized',
    'bank_recon_match_parent_effective',
    'bank_recon_effective_journal_allocated',
    'bank_recon_effective_import_allocated',
    'bank_recon_batch_has_protected_session',
    'prevent_finalized_bank_recon_mutation',
    'prevent_protected_bank_recon_match_mutation',
    'prevent_protected_bank_recon_cleared_mutation',
    'prevent_protected_bank_import_line_mutation'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_staff || v_internal)
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    if r.proname = any (v_internal) then
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end;
$$;

revoke all on function public.stage_bank_statement_import_safe(uuid, text, jsonb, uuid) from public;
revoke all on function public.stage_bank_statement_import_safe(uuid, text, jsonb, uuid) from anon;
grant execute on function public.stage_bank_statement_import_safe(uuid, text, jsonb, uuid) to authenticated;
grant execute on function public.stage_bank_statement_import_safe(uuid, text, jsonb, uuid) to service_role;

revoke all on function public.create_bank_reconciliation_safe(uuid, date, date, numeric, numeric, text, uuid, text) from public;
revoke all on function public.create_bank_reconciliation_safe(uuid, date, date, numeric, numeric, text, uuid, text) from anon;
grant execute on function public.create_bank_reconciliation_safe(uuid, date, date, numeric, numeric, text, uuid, text) to authenticated;
grant execute on function public.create_bank_reconciliation_safe(uuid, date, date, numeric, numeric, text, uuid, text) to service_role;

revoke all on function public.attach_bank_import_to_reconciliation_safe(uuid, uuid, uuid) from public;
revoke all on function public.attach_bank_import_to_reconciliation_safe(uuid, uuid, uuid) from anon;
grant execute on function public.attach_bank_import_to_reconciliation_safe(uuid, uuid, uuid) to authenticated;
grant execute on function public.attach_bank_import_to_reconciliation_safe(uuid, uuid, uuid) to service_role;

revoke all on function public.create_bank_match_safe(uuid, uuid, uuid, numeric, uuid, text) from public;
revoke all on function public.create_bank_match_safe(uuid, uuid, uuid, numeric, uuid, text) from anon;
grant execute on function public.create_bank_match_safe(uuid, uuid, uuid, numeric, uuid, text) to authenticated;
grant execute on function public.create_bank_match_safe(uuid, uuid, uuid, numeric, uuid, text) to service_role;

revoke all on function public.remove_bank_match_safe(uuid, text, uuid) from public;
revoke all on function public.remove_bank_match_safe(uuid, text, uuid) from anon;
grant execute on function public.remove_bank_match_safe(uuid, text, uuid) to authenticated;
grant execute on function public.remove_bank_match_safe(uuid, text, uuid) to service_role;

revoke all on function public.resolve_bank_import_duplicate_safe(uuid, text, text, uuid) from public;
revoke all on function public.resolve_bank_import_duplicate_safe(uuid, text, text, uuid) from anon;
grant execute on function public.resolve_bank_import_duplicate_safe(uuid, text, text, uuid) to authenticated;
grant execute on function public.resolve_bank_import_duplicate_safe(uuid, text, text, uuid) to service_role;

revoke all on function public.exclude_bank_import_line_safe(uuid, text, uuid) from public;
revoke all on function public.exclude_bank_import_line_safe(uuid, text, uuid) from anon;
grant execute on function public.exclude_bank_import_line_safe(uuid, text, uuid) to authenticated;
grant execute on function public.exclude_bank_import_line_safe(uuid, text, uuid) to service_role;

revoke all on function public.finalize_bank_reconciliation_safe(uuid, uuid, boolean) from public;
revoke all on function public.finalize_bank_reconciliation_safe(uuid, uuid, boolean) from anon;
grant execute on function public.finalize_bank_reconciliation_safe(uuid, uuid, boolean) to authenticated;
grant execute on function public.finalize_bank_reconciliation_safe(uuid, uuid, boolean) to service_role;

revoke all on function public.void_bank_reconciliation_safe(uuid, text, uuid) from public;
revoke all on function public.void_bank_reconciliation_safe(uuid, text, uuid) from anon;
grant execute on function public.void_bank_reconciliation_safe(uuid, text, uuid) to authenticated;
grant execute on function public.void_bank_reconciliation_safe(uuid, text, uuid) to service_role;

-- Obsolete 2-arg complete/finalize overloads were DROP FUNCTION IF EXISTS earlier.
-- Do NOT REVOKE/GRANT those signatures here — PostgreSQL aborts if the exact
-- signature is absent. Canonical signatures only:

revoke all on function public.complete_bank_reconciliation_safe(uuid, uuid, boolean) from public;
revoke all on function public.complete_bank_reconciliation_safe(uuid, uuid, boolean) from anon;
grant execute on function public.complete_bank_reconciliation_safe(uuid, uuid, boolean) to authenticated;
grant execute on function public.complete_bank_reconciliation_safe(uuid, uuid, boolean) to service_role;

revoke all on function public.bank_reconciliation_compute_package(uuid) from public;
revoke all on function public.bank_reconciliation_compute_package(uuid) from anon;
revoke all on function public.bank_reconciliation_compute_package(uuid) from authenticated;
grant execute on function public.bank_reconciliation_compute_package(uuid) to service_role;

revoke all on function public.bank_recon_session_is_editable(text) from public;
revoke all on function public.bank_recon_session_is_editable(text) from anon;
grant execute on function public.bank_recon_session_is_editable(text) to authenticated;
grant execute on function public.bank_recon_session_is_editable(text) to service_role;

revoke all on function public.bank_recon_session_is_successfully_finalized(text) from public;
revoke all on function public.bank_recon_session_is_successfully_finalized(text) from anon;
grant execute on function public.bank_recon_session_is_successfully_finalized(text) to authenticated;
grant execute on function public.bank_recon_session_is_successfully_finalized(text) to service_role;

revoke all on function public.bank_recon_session_is_terminal(text) from public;
revoke all on function public.bank_recon_session_is_terminal(text) from anon;
grant execute on function public.bank_recon_session_is_terminal(text) to authenticated;
grant execute on function public.bank_recon_session_is_terminal(text) to service_role;

revoke all on function public.bank_import_line_included_in_statement(text, text) from public;
revoke all on function public.bank_import_line_included_in_statement(text, text) from anon;
grant execute on function public.bank_import_line_included_in_statement(text, text) to authenticated;
grant execute on function public.bank_import_line_included_in_statement(text, text) to service_role;

revoke all on function public.bank_recon_sync_journal_cleared(uuid, uuid) from public;
revoke all on function public.bank_recon_sync_journal_cleared(uuid, uuid) from anon;
revoke all on function public.bank_recon_sync_journal_cleared(uuid, uuid) from authenticated;
grant execute on function public.bank_recon_sync_journal_cleared(uuid, uuid) to service_role;

revoke all on function public.bank_recon_lock_account(uuid) from public;
revoke all on function public.bank_recon_lock_account(uuid) from anon;
revoke all on function public.bank_recon_lock_account(uuid) from authenticated;
grant execute on function public.bank_recon_lock_account(uuid) to service_role;

revoke all on function public.bank_import_try_numeric(text) from public;
revoke all on function public.bank_import_try_numeric(text) from anon;
revoke all on function public.bank_import_try_numeric(text) from authenticated;
grant execute on function public.bank_import_try_numeric(text) to service_role;

revoke all on function public.bank_import_try_date(text) from public;
revoke all on function public.bank_import_try_date(text) from anon;
revoke all on function public.bank_import_try_date(text) from authenticated;
grant execute on function public.bank_import_try_date(text) to service_role;
