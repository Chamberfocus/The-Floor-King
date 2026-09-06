-- F6-P1: Accounting books-readiness completion (audit log, write-offs, bank import staging,
-- bad debt mapping, backup/PITR attestation columns).
-- Non-destructive. Does not enable posting. No business data mutation.
-- Applied AFTER 0169. Do not edit 0154–0169.
--
-- Owner review revision: bank staging SELECT-only for clients, hardened duplicate model,
-- accurate import counts, PITR attestation evidence, append-only audit log,
-- write-off mapping precheck blocks before insert.

-- ---------------------------------------------------------------------------
-- bad_debt_expense system account + mapping
-- ---------------------------------------------------------------------------
insert into public.gl_accounts (code, name, account_type, subtype, is_system)
values ('6910', 'Bad Debt Expense', 'expense', 'operating', true)
on conflict (code) do nothing;

insert into public.accounting_account_mappings (mapping_key, account_id)
select 'bad_debt_expense', id
from public.gl_accounts
where code = '6910'
on conflict (mapping_key) do nothing;

-- ---------------------------------------------------------------------------
-- accounting_settings — backup/PITR owner attestation (external prerequisite)
-- ---------------------------------------------------------------------------
alter table public.accounting_settings
  add column if not exists backup_pitr_confirmed_at timestamptz,
  add column if not exists backup_pitr_confirmed_by uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- financial_audit_log — technically append-only accounting evidence
-- ---------------------------------------------------------------------------
create table if not exists public.financial_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  economic_date date,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists financial_audit_log_idempotency_uidx
  on public.financial_audit_log (idempotency_key)
  where idempotency_key is not null;

create index if not exists financial_audit_log_entity_idx
  on public.financial_audit_log (entity_type, entity_id, occurred_at desc);

create index if not exists financial_audit_log_occurred_idx
  on public.financial_audit_log (occurred_at desc);

alter table public.financial_audit_log enable row level security;

drop policy if exists financial_audit_log_staff_read on public.financial_audit_log;
create policy financial_audit_log_staff_read on public.financial_audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

revoke all on public.financial_audit_log from public;
revoke insert, update, delete on public.financial_audit_log from authenticated;
grant select on public.financial_audit_log to authenticated;
grant select, insert on public.financial_audit_log to service_role;

-- Block UPDATE/DELETE even if grants change accidentally (controlled maintenance bypass).
create or replace function public.financial_audit_log_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.allow_audit_mutation', true) = 'true' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception
    'financial_audit_log is append-only. UPDATE/DELETE are forbidden.'
    using errcode = '42501';
end;
$$;

drop trigger if exists financial_audit_log_no_update on public.financial_audit_log;
create trigger financial_audit_log_no_update
  before update on public.financial_audit_log
  for each row execute function public.financial_audit_log_immutable();

drop trigger if exists financial_audit_log_no_delete on public.financial_audit_log;
create trigger financial_audit_log_no_delete
  before delete on public.financial_audit_log
  for each row execute function public.financial_audit_log_immutable();

-- ---------------------------------------------------------------------------
-- log_financial_audit_safe — controlled append helper (internal RPCs only)
-- ---------------------------------------------------------------------------
create or replace function public.log_financial_audit_safe(
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_economic_date date default null,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb,
  p_actor uuid default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_existing uuid;
  v_id uuid;
begin
  if not (
    public.accounting_is_service_role()
    or current_setting('app.trusted_definer_audit', true) = 'true'
  ) then
    raise exception
      'ACCOUNTING_FORBIDDEN: log_financial_audit_safe is internal-only.'
      using errcode = '42501';
  end if;
  v_actor := public.accounting_actor_id(p_actor);

  if p_idempotency_key is not null then
    select id into v_existing
    from public.financial_audit_log
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  perform set_config('app.allow_audit_mutation', 'true', true);

  insert into public.financial_audit_log (
    actor_id, action, entity_type, entity_id,
    economic_date, reason, payload, idempotency_key
  ) values (
    v_actor,
    p_action,
    p_entity_type,
    p_entity_id,
    p_economic_date,
    nullif(p_reason, ''),
    coalesce(p_payload, '{}'::jsonb),
    nullif(p_idempotency_key, '')
  )
  returning id into v_id;

  perform set_config('app.allow_audit_mutation', 'false', true);

  return v_id;
exception
  when unique_violation then
    perform set_config('app.allow_audit_mutation', 'false', true);
    if p_idempotency_key is not null then
      select id into v_existing
      from public.financial_audit_log
      where idempotency_key = p_idempotency_key
      limit 1;
      return v_existing;
    end if;
    raise;
end;
$$;

revoke all on function public.log_financial_audit_safe(text, text, uuid, date, text, jsonb, uuid, text) from public;
revoke all on function public.log_financial_audit_safe(text, text, uuid, date, text, jsonb, uuid, text) from anon;
revoke all on function public.log_financial_audit_safe(text, text, uuid, date, text, jsonb, uuid, text) from authenticated;
grant execute on function public.log_financial_audit_safe(text, text, uuid, date, text, jsonb, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- invoice_write_offs — controlled AR write-off records (SELECT-only for clients)
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_write_offs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  reason text not null,
  status text not null default 'active'
    check (status in ('active', 'void')),
  written_off_at date not null,
  created_by uuid references auth.users (id) on delete set null,
  idempotency_key text,
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  created_at timestamptz not null default now(),
  constraint invoice_write_offs_amount_positive check (amount > 0)
);

create unique index if not exists invoice_write_offs_idempotency_uidx
  on public.invoice_write_offs (idempotency_key)
  where idempotency_key is not null;

create index if not exists invoice_write_offs_invoice_idx
  on public.invoice_write_offs (invoice_id)
  where status = 'active';

alter table public.invoice_write_offs enable row level security;

drop policy if exists invoice_write_offs_staff on public.invoice_write_offs;
create policy invoice_write_offs_staff on public.invoice_write_offs
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

revoke all on public.invoice_write_offs from public;
revoke insert, update, delete on public.invoice_write_offs from authenticated;
grant select on public.invoice_write_offs to authenticated;
grant select, insert, update on public.invoice_write_offs to service_role;

create or replace function public.invoice_applied_write_offs(p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)
  from public.invoice_write_offs
  where invoice_id = p_invoice_id
    and status = 'active';
$$;

revoke all on function public.invoice_applied_write_offs(uuid) from public;
grant execute on function public.invoice_applied_write_offs(uuid) to authenticated;
grant execute on function public.invoice_applied_write_offs(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- write_off_invoice_safe — Dr Bad Debt Expense / Cr AR
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

  select t.total into v_total
  from public.invoice_commercial_total(p_invoice_id) as t;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where invoice_id = p_invoice_id and status = 'active';

  v_credited := public.invoice_applied_credits(p_invoice_id);
  v_written_off := public.invoice_applied_write_offs(p_invoice_id);
  v_remaining := round((v_total - v_paid - v_credited - v_written_off)::numeric, 2);

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

revoke all on function public.write_off_invoice_safe(uuid, numeric, text, date, uuid, text) from public;
grant execute on function public.write_off_invoice_safe(uuid, numeric, text, date, uuid, text) to authenticated;
grant execute on function public.write_off_invoice_safe(uuid, numeric, text, date, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- confirm_backup_pitr_safe — OWNER/ADMIN external attestation only (NOT automated proof)
-- Does NOT modify posting_enabled, books_of_record, cutover_date, or pilot flags.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_backup_pitr_safe(
  p_confirmed_by uuid default null,
  p_attestation_evidence text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_evidence text;
begin
  perform public.accounting_require_roles(
    ARRAY['admin'],
    'confirm backup/PITR readiness'
  );
  v_actor := public.accounting_actor_id(p_confirmed_by);

  v_evidence := trim(coalesce(p_attestation_evidence, ''));
  if length(v_evidence) < 30 then
    return jsonb_build_object(
      'ok', false,
      'error',
      'Backup/PITR attestation evidence is required (minimum 30 characters). This must document external verification — the CRM does not verify Supabase backup/PITR automatically.',
      'code', 'PITR_ATTESTATION_REQUIRED'
    );
  end if;

  update public.accounting_settings
  set backup_pitr_confirmed_at = now(),
      backup_pitr_confirmed_by = v_actor,
      updated_at = now(),
      updated_by = v_actor
  where id = 1;

  perform set_config('app.trusted_definer_audit', 'true', true);
  perform public.log_financial_audit_safe(
    'backup_pitr_confirmed',
    'accounting_settings',
    '00000000-0000-0000-0000-000000000001'::uuid,
    current_date,
    v_evidence,
    jsonb_build_object(
      'attestationType', 'OWNER_ADMIN_EXTERNAL_VERIFICATION',
      'automatedVerification', false,
      'statement', 'OWNER/ADMIN ATTESTATION: Supabase backup and PITR were verified externally.',
      'evidence', v_evidence,
      'confirmedAt', now(),
      'actorId', v_actor
    ),
    v_actor,
    'audit:backup_pitr:' || to_char(now(), 'YYYY-MM-DD')
  );
  perform set_config('app.trusted_definer_audit', 'false', true);

  return jsonb_build_object(
    'ok', true,
    'confirmed_at', now(),
    'attestation_recorded', true
  );
end;
$$;

revoke all on function public.confirm_backup_pitr_safe(uuid, text) from public;
grant execute on function public.confirm_backup_pitr_safe(uuid, text) to authenticated;
grant execute on function public.confirm_backup_pitr_safe(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- bank_statement_import_batches — CSV staging (SELECT-only for authenticated clients)
-- ---------------------------------------------------------------------------
create table if not exists public.bank_statement_import_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.gl_accounts (id) on delete restrict,
  file_name text,
  import_fingerprint text,
  status text not null default 'staged'
    check (status in ('staged', 'reviewed', 'matched', 'cancelled')),
  source_row_count int not null default 0,
  staged_row_count int not null default 0,
  rejected_row_count int not null default 0,
  exact_reimport_count int not null default 0,
  possible_duplicate_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  notes text
);

create table if not exists public.bank_statement_import_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.bank_statement_import_batches (id) on delete cascade,
  source_row_no int not null,
  transaction_date date,
  description text,
  amount numeric(12, 2),
  direction text check (direction in ('deposit', 'withdrawal')),
  duplicate_status text not null default 'unmatched'
    check (duplicate_status in ('unmatched', 'exact_reimport', 'possible_duplicate', 'rejected')),
  duplicate_reason text,
  rejection_reason text,
  source_row_fingerprint text,
  canonical_source_row_fingerprint text,
  exact_reimport_of_line_id uuid references public.bank_statement_import_lines (id) on delete set null,
  possible_duplicate_of_line_id uuid references public.bank_statement_import_lines (id) on delete set null,
  matched_journal_line_id uuid references public.journal_lines (id) on delete set null,
  raw_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint bank_import_lines_batch_source_row unique (batch_id, source_row_no)
);

create unique index if not exists bank_import_lines_source_fp_uidx
  on public.bank_statement_import_lines (source_row_fingerprint)
  where source_row_fingerprint is not null
    and duplicate_status in ('unmatched', 'possible_duplicate');

create index if not exists bank_import_lines_batch_idx
  on public.bank_statement_import_lines (batch_id, duplicate_status);

alter table public.bank_statement_import_batches enable row level security;
alter table public.bank_statement_import_lines enable row level security;

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

revoke all on public.bank_statement_import_batches from public;
revoke insert, update, delete on public.bank_statement_import_batches from authenticated;
grant select on public.bank_statement_import_batches to authenticated;
grant select, insert, update on public.bank_statement_import_batches to service_role;

revoke all on public.bank_statement_import_lines from public;
revoke insert, update, delete on public.bank_statement_import_lines from authenticated;
grant select on public.bank_statement_import_lines to authenticated;
grant select, insert, update on public.bank_statement_import_lines to service_role;

-- ---------------------------------------------------------------------------
-- stage_bank_statement_import_safe — controlled staging (no GL mutation)
-- Duplicate model:
--   exact_reimport — same canonical source_row_fingerprint already staged; new row retained
--     with canonical_source_row_fingerprint + exact_reimport_of_line_id (no fingerprint on reimport row)
--   possible_duplicate — heuristic date+amount+description match, different fingerprint
--   unmatched — legitimate row (including repeated transactions)
--
-- import_fingerprint = md5(account_id || '|' || normalized_row_lines)
-- Each normalized row line (array order, 1-based source_row_no):
--   sourceRowNo|date|amount(abs,2dp)|description(lower)|sourceRef
-- Filename is metadata only (batch.file_name); not hashed.
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
  v_source_fp text;
  v_heuristic_key text;
  v_existing_fp uuid;
  v_possible_of uuid;
  v_line_id uuid;
  v_import_fp text;
  v_batch_heuristic_map jsonb := '{}'::jsonb;
  v_norm_content text;
begin
  perform public.accounting_require_roles(
    ARRAY['admin', 'office'],
    'stage bank statement imports'
  );
  v_actor := public.accounting_actor_id(p_created_by);

  if p_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'Bank/cash account is required.');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Import requires at least one row.');
  end if;

  v_source_count := jsonb_array_length(p_rows);

  select coalesce(string_agg(norm_line, E'\n' order by ord), '')
    into v_norm_content
  from (
    select
      ord,
      ord::text || '|' ||
      coalesce(elem->>'date', '') || '|' ||
      round(abs(coalesce((elem->>'amount')::numeric, 0))::numeric, 2)::text || '|' ||
      lower(coalesce(nullif(trim(elem->>'description'), ''), '')) || '|' ||
      coalesce(nullif(elem->>'sourceRef', ''), nullif(elem->>'source_ref', ''), '')
        as norm_line
    from jsonb_array_elements(p_rows) with ordinality as t(elem, ord)
  ) normalized;

  v_import_fp := md5(p_account_id::text || '|' || v_norm_content);

  insert into public.bank_statement_import_batches (
    account_id, file_name, import_fingerprint, status, created_by
  ) values (
    p_account_id, nullif(p_file_name, ''), v_import_fp, 'staged', v_actor
  )
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_source_row_no := v_source_row_no + 1;
    v_date := (v_row->>'date')::date;
    v_desc := nullif(v_row->>'description', '');
    v_amount := coalesce((v_row->>'amount')::numeric, 0);
    v_dir := case when v_amount >= 0 then 'deposit' else 'withdrawal' end;
    v_amount := abs(v_amount);

    if v_date is null or v_amount <= 0 then
      insert into public.bank_statement_import_lines (
        batch_id, source_row_no, duplicate_status, rejection_reason, raw_row
      ) values (
        v_batch_id,
        v_source_row_no,
        'rejected',
        case
          when v_date is null then 'Missing or invalid transaction date.'
          else 'Amount must be greater than zero.'
        end,
        v_row
      );
      v_rejected_count := v_rejected_count + 1;
      continue;
    end if;

    v_source_fp := md5(
      p_account_id::text || '|' ||
      v_source_row_no::text || '|' ||
      v_date::text || '|' ||
      round(v_amount::numeric, 2)::text || '|' ||
      lower(coalesce(v_desc, '')) || '|' ||
      coalesce(v_row->>'sourceRef', v_row->>'source_ref', '')
    );

    v_heuristic_key :=
      v_date::text || '|' ||
      round(v_amount::numeric, 2)::text || '|' ||
      lower(coalesce(v_desc, ''));

    v_existing_fp := null;
    v_possible_of := null;

    select l.id into v_existing_fp
    from public.bank_statement_import_lines l
    join public.bank_statement_import_batches b on b.id = l.batch_id
    where l.source_row_fingerprint = v_source_fp
      and l.duplicate_status in ('unmatched', 'possible_duplicate')
    limit 1;

    if v_existing_fp is not null then
      insert into public.bank_statement_import_lines (
        batch_id, source_row_no, transaction_date, description, amount, direction,
        duplicate_status, duplicate_reason, canonical_source_row_fingerprint,
        exact_reimport_of_line_id, raw_row
      ) values (
        v_batch_id, v_source_row_no, v_date, v_desc, round(v_amount::numeric, 2), v_dir,
        'exact_reimport',
        'Exact source row fingerprint already staged.',
        v_source_fp,
        v_existing_fp,
        v_row
      );
      v_exact_reimport_count := v_exact_reimport_count + 1;
      v_staged_count := v_staged_count + 1;
      continue;
    end if;

    if v_batch_heuristic_map ? v_heuristic_key then
      v_possible_of := (v_batch_heuristic_map->>v_heuristic_key)::uuid;
      insert into public.bank_statement_import_lines (
        batch_id, source_row_no, transaction_date, description, amount, direction,
        duplicate_status, duplicate_reason, source_row_fingerprint,
        possible_duplicate_of_line_id, raw_row
      ) values (
        v_batch_id, v_source_row_no, v_date, v_desc, round(v_amount::numeric, 2), v_dir,
        'possible_duplicate',
        'Another transaction shares date, amount, and description; review required.',
        v_source_fp,
        v_possible_of,
        v_row
      );
      v_possible_dup_count := v_possible_dup_count + 1;
      v_staged_count := v_staged_count + 1;
      continue;
    end if;

    insert into public.bank_statement_import_lines (
      batch_id, source_row_no, transaction_date, description, amount, direction,
      duplicate_status, source_row_fingerprint, raw_row
    ) values (
      v_batch_id, v_source_row_no, v_date, v_desc, round(v_amount::numeric, 2), v_dir,
      'unmatched',
      v_source_fp,
      v_row
    )
    returning id into v_line_id;

    v_batch_heuristic_map :=
      v_batch_heuristic_map || jsonb_build_object(v_heuristic_key, v_line_id::text);
    v_staged_count := v_staged_count + 1;
  end loop;

  update public.bank_statement_import_batches
  set source_row_count = v_source_count,
      staged_row_count = v_staged_count,
      rejected_row_count = v_rejected_count,
      exact_reimport_count = v_exact_reimport_count,
      possible_duplicate_count = v_possible_dup_count
  where id = v_batch_id;

  perform set_config('app.trusted_definer_audit', 'true', true);
  perform public.log_financial_audit_safe(
    'bank_import_staged',
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
  perform set_config('app.trusted_definer_audit', 'false', true);

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

revoke all on function public.stage_bank_statement_import_safe(uuid, text, jsonb, uuid) from public;
grant execute on function public.stage_bank_statement_import_safe(uuid, text, jsonb, uuid) to authenticated;
grant execute on function public.stage_bank_statement_import_safe(uuid, text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- EXECUTE ACLs — F6-P1 RPCs + read helpers
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_staff_rpc text[] := array[
    'write_off_invoice_safe',
    'confirm_backup_pitr_safe',
    'stage_bank_statement_import_safe'
  ];
  v_internal_rpc text[] := array[
    'log_financial_audit_safe'
  ];
  v_read_helper text[] := array[
    'invoice_applied_write_offs'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_staff_rpc || v_internal_rpc || v_read_helper)
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);

    if r.proname = any (v_staff_rpc) then
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname = any (v_internal_rpc) then
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.proname = any (v_read_helper) then
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end;
$$;
