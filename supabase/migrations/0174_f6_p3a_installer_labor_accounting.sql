-- F6-P3A: Installer labor source + accounting-ready labor cost foundation.
-- Canonical SoT: public.installer_bills (hardened). job_labor remains legacy/display-only.
-- Does NOT enable posting. Does NOT mutate production business rows.
-- Do NOT apply until owner review. Do NOT create 0175 in this phase.
--
-- Canonical lock order (all mutation RPCs):
--   1. discover job_id WITHOUT installer_bills FOR UPDATE
--   2. installer_labor_lock_job(job_id)  -- advisory namespace 174
--   3. installer_bills FOR UPDATE
--   4. public.bills FOR UPDATE (linked AP, if any)
--   5. bill_payments FOR UPDATE (linked AP payments, if any)
--   6. accounting_outbox / event_status last

-- ===========================================================================
-- 1) Schema
-- ===========================================================================

alter table public.installer_bills
  drop constraint if exists installer_bills_status_check;

-- Existing production statuses are only draft/approved/paid (0123). void/cancelled are additive.
alter table public.installer_bills
  add column if not exists crew_id uuid references public.install_crews (id) on delete set null,
  add column if not exists worker_kind text,
  add column if not exists service_date date,
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  add column if not exists approved_by uuid references auth.users (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists idempotency_key text,
  add column if not exists context_hash text,
  add column if not exists prior_status text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users (id) on delete set null,
  add column if not exists void_reason text,
  add column if not exists reversal_of_bill_id uuid references public.installer_bills (id) on delete set null,
  add column if not exists ap_bill_id uuid references public.bills (id) on delete set null,
  add column if not exists ap_sync_status text not null default 'none',
  add column if not exists source_context jsonb not null default '{}'::jsonb,
  add column if not exists legacy_display_only boolean not null default false,
  add column if not exists payroll_ops_status text not null default 'none';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'installer_bills_status_check'
  ) then
    alter table public.installer_bills
      add constraint installer_bills_status_check
      check (status in ('draft', 'approved', 'paid', 'void', 'cancelled'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'installer_bills_worker_kind_check'
  ) then
    alter table public.installer_bills
      add constraint installer_bills_worker_kind_check
      check (worker_kind is null or worker_kind in ('employee', 'subcontractor', 'unknown'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'installer_bills_ap_sync_status_check'
  ) then
    alter table public.installer_bills
      add constraint installer_bills_ap_sync_status_check
      check (ap_sync_status in (
        'none',
        'not_applicable_employee',
        'pending_vendor_ap',
        'linked_vendor_ap',
        'ap_voided',
        'payroll_boundary'
      ));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'installer_bills_payroll_ops_status_check'
  ) then
    alter table public.installer_bills
      add constraint installer_bills_payroll_ops_status_check
      check (payroll_ops_status in ('none', 'recorded'));
  end if;
end $$;

create unique index if not exists installer_bills_idempotency_uidx
  on public.installer_bills (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists installer_bills_ap_bill_uidx
  on public.installer_bills (ap_bill_id)
  where ap_bill_id is not null;

create index if not exists installer_bills_job_status_idx
  on public.installer_bills (job_id, status);

create index if not exists installer_bills_reversal_idx
  on public.installer_bills (reversal_of_bill_id)
  where reversal_of_bill_id is not null;

alter table public.bills
  add column if not exists installer_labor_bill_id uuid references public.installer_bills (id) on delete set null,
  add column if not exists ap_lifecycle text not null default 'open',
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users (id) on delete set null,
  add column if not exists void_reason text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'bills_ap_lifecycle_status_check'
  ) then
    alter table public.bills
      add constraint bills_ap_lifecycle_status_check
      check (ap_lifecycle in ('open', 'void'));
  end if;
end $$;

create unique index if not exists bills_installer_labor_bill_uidx
  on public.bills (installer_labor_bill_id)
  where installer_labor_bill_id is not null;

alter table public.installer_bill_line_items
  add column if not exists job_line_id uuid references public.job_line_items (id) on delete set null;

alter table public.installer_bill_line_items
  alter column quantity type numeric(14, 4),
  alter column rate type numeric(14, 4);

alter table public.install_crews
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

alter table public.job_labor
  add column if not exists legacy_non_canonical boolean not null default true,
  add column if not exists financial_note text;

comment on column public.job_labor.legacy_non_canonical is
  'F6-P3A: job_labor is NOT the financial actual labor SoT. Use installer_bills.';

-- Per-action idempotency (create/approve/reverse/correct/cancel/payroll_ops).
-- One key cannot represent unrelated lifecycle operations.
create table if not exists public.installer_labor_action_idempotency (
  idempotency_key text primary key,
  action text not null,
  labor_bill_id uuid,
  context_hash text,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint installer_labor_action_idempotency_action_check
    check (action in (
      'create', 'save_draft', 'approve', 'reverse', 'correct', 'cancel', 'payroll_ops'
    ))
);

alter table public.installer_labor_action_idempotency enable row level security;

drop trigger if exists installer_bills_set_updated_at on public.installer_bills;
create trigger installer_bills_set_updated_at
  before update on public.installer_bills
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2) Finite numeric + safe JSON parsing
-- ===========================================================================

create or replace function public.installer_labor_text_is_nonfinite(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text is not null and lower(btrim(p_text)) ~ '(^|[^a-z])([+-]?inf(inity)?|nan)($|[^a-z])';
$$;

create or replace function public.installer_labor_money_ok(p_amount numeric)
returns boolean
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_txt text;
begin
  if p_amount is null then
    return false;
  end if;
  v_txt := p_amount::text;
  if public.installer_labor_text_is_nonfinite(v_txt) then
    return false;
  end if;
  if p_amount < 0 then
    return false;
  end if;
  if p_amount > 9999999999.99 then
    return false;
  end if;
  if round(p_amount, 2) <> p_amount then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.installer_labor_parse_numeric_text(p_text text)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v numeric;
  v_raw text;
begin
  v_raw := btrim(coalesce(p_text, ''));
  if v_raw = '' then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: empty numeric.';
  end if;
  if public.installer_labor_text_is_nonfinite(v_raw) then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: non-finite numeric rejected.';
  end if;
  begin
    v := v_raw::numeric;
  exception when others then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: malformed numeric.';
  end;
  if public.installer_labor_text_is_nonfinite(v::text) then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: non-finite numeric rejected.';
  end if;
  return v;
end;
$$;

create or replace function public.installer_labor_json_numeric(p_line jsonb, p_field text)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_el jsonb;
  v_t text;
begin
  v_el := p_line -> p_field;
  if v_el is null or v_el = 'null'::jsonb then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: % is required.', p_field;
  end if;
  v_t := jsonb_typeof(v_el);
  if v_t = 'boolean' or v_t = 'array' or v_t = 'object' then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: % must be numeric.', p_field;
  end if;
  return public.installer_labor_parse_numeric_text(v_el #>> '{}');
end;
$$;

create or replace function public.installer_labor_json_bool(p_line jsonb, p_field text, p_default boolean)
returns boolean
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_el jsonb;
  v_t text;
  v_txt text;
begin
  v_el := p_line -> p_field;
  if v_el is null or v_el = 'null'::jsonb then
    return p_default;
  end if;
  v_t := jsonb_typeof(v_el);
  if v_t = 'boolean' then
    return (v_el #>> '{}')::boolean;
  end if;
  if v_t = 'string' then
    v_txt := lower(btrim(v_el #>> '{}'));
    if v_txt in ('true', 't', '1', 'yes') then return true; end if;
    if v_txt in ('false', 'f', '0', 'no', '') then return false; end if;
  end if;
  raise exception 'INSTALLER_LABOR_INVALID_BOOLEAN: % is not a valid boolean.', p_field;
end;
$$;

create or replace function public.installer_labor_json_uuid(p_line jsonb, p_field text)
returns uuid
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_el jsonb;
  v_txt text;
  v uuid;
begin
  v_el := p_line -> p_field;
  if v_el is null or v_el = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(v_el) not in ('string') then
    raise exception 'INSTALLER_LABOR_INVALID_UUID: % must be a UUID string.', p_field;
  end if;
  v_txt := btrim(v_el #>> '{}');
  if v_txt = '' then
    return null;
  end if;
  begin
    v := v_txt::uuid;
  exception when others then
    raise exception 'INSTALLER_LABOR_INVALID_UUID: malformed % .', p_field;
  end;
  return v;
end;
$$;

create or replace function public.installer_labor_line_total(
  p_quantity numeric,
  p_rate numeric
)
returns numeric
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_qty numeric;
  v_rate numeric;
  v_total numeric;
begin
  if p_quantity is null or p_rate is null then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: quantity and rate are required.';
  end if;
  if public.installer_labor_text_is_nonfinite(p_quantity::text)
     or public.installer_labor_text_is_nonfinite(p_rate::text) then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: non-finite numeric rejected.';
  end if;
  if p_quantity < 0 then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: negative quantity rejected.';
  end if;
  if p_rate < 0 then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: negative rate rejected.';
  end if;
  if p_quantity > 1000000000 or p_rate > 1000000000 then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: quantity/rate exceeds bound.';
  end if;
  if round(p_quantity, 4) <> p_quantity then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: quantity precision exceeds 4 decimals.';
  end if;
  if round(p_rate, 4) <> p_rate then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: rate precision exceeds 4 decimals.';
  end if;
  v_qty := round(p_quantity, 4);
  v_rate := round(p_rate, 4);
  v_total := round((v_qty * v_rate)::numeric, 2);
  if not public.installer_labor_money_ok(v_total) then
    raise exception 'INSTALLER_LABOR_INVALID_AMOUNT: line total is not valid money.';
  end if;
  return v_total;
end;
$$;

-- PHASE A: validate/compute only. No persistent mutation.
create or replace function public.installer_labor_validate_lines(
  p_job_id uuid,
  p_lines jsonb,
  p_adjustments numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_line jsonb;
  v_i int := 0;
  v_qty numeric;
  v_rate numeric;
  v_lt numeric;
  v_subtotal numeric := 0;
  v_adj numeric;
  v_total numeric;
  v_fp text := '';
  v_desc text;
  v_unit text;
  v_source text;
  v_mod boolean;
  v_reason text;
  v_jlid uuid;
  v_jl_job uuid;
begin
  if p_adjustments is null
     or public.installer_labor_text_is_nonfinite(p_adjustments::text)
     or round(p_adjustments, 2) <> p_adjustments then
    return jsonb_build_object('ok', false, 'error', 'Invalid adjustments amount.', 'code', 'INVALID_AMOUNT');
  end if;
  v_adj := round(p_adjustments, 2);
  if abs(v_adj) > 9999999999.99 then
    return jsonb_build_object('ok', false, 'error', 'Adjustments exceed bound.', 'code', 'INVALID_AMOUNT');
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'lines must be a JSON array.', 'code', 'INVALID_LINES');
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    if jsonb_typeof(v_line) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'Every line must be a JSON object.', 'code', 'INVALID_LINES');
    end if;
    begin
      v_qty := public.installer_labor_json_numeric(v_line, 'quantity');
      v_rate := public.installer_labor_json_numeric(v_line, 'rate');
      v_lt := public.installer_labor_line_total(v_qty, v_rate);
      v_mod := public.installer_labor_json_bool(v_line, 'is_modified', false);
      v_jlid := public.installer_labor_json_uuid(v_line, 'job_line_id');
    exception when others then
      return jsonb_build_object('ok', false, 'error', SQLERRM, 'code', 'INVALID_AMOUNT');
    end;

    v_desc := coalesce(nullif(btrim(coalesce(v_line->>'description', '')), ''), 'Labor');
    v_unit := nullif(btrim(coalesce(v_line->>'unit', '')), '');
    v_source := coalesce(v_line->>'source', 'from_work_order');
    if v_source not in ('from_work_order', 'manually_added') then
      v_source := 'from_work_order';
    end if;
    v_reason := nullif(btrim(coalesce(v_line->>'change_reason', '')), '');
    if v_mod or v_source = 'manually_added' then
      if v_reason is null then
        return jsonb_build_object(
          'ok', false,
          'error', 'Change reason required for modified or manually added lines.',
          'code', 'REASON_REQUIRED'
        );
      end if;
    end if;

    if v_jlid is not null then
      select job_id into v_jl_job from public.job_line_items where id = v_jlid;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'job_line_id does not exist.', 'code', 'INVALID_JOB_LINE');
      end if;
      if v_jl_job is distinct from p_job_id then
        return jsonb_build_object('ok', false, 'error', 'job_line_id belongs to a different job.', 'code', 'CROSS_JOB_LINE');
      end if;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'description', v_desc,
      'quantity', round(v_qty, 4),
      'unit', v_unit,
      'rate', round(v_rate, 4),
      'line_total', v_lt,
      'source', v_source,
      'is_modified', v_mod,
      'change_reason', v_reason,
      'job_line_id', v_jlid,
      'position', v_i
    ));
    v_subtotal := v_subtotal + v_lt;
    v_fp := v_fp || v_desc || ':' || v_lt::text || ':' || coalesce(v_jlid::text, '') || ';';
    v_i := v_i + 1;
  end loop;

  v_subtotal := round(v_subtotal, 2);
  v_total := round(v_subtotal + v_adj, 2);
  if v_total < 0 or not public.installer_labor_money_ok(v_total) then
    return jsonb_build_object('ok', false, 'error', 'Bill total must be non-negative valid money.', 'code', 'INVALID_AMOUNT');
  end if;

  return jsonb_build_object(
    'ok', true,
    'subtotal', v_subtotal,
    'adjustments', v_adj,
    'total', v_total,
    'fingerprint', v_fp,
    'lines', v_out
  );
end;
$$;

create or replace function public.installer_labor_resolve_worker_kind(
  p_installer_id uuid,
  p_crew_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  if p_crew_id is not null then
    select lower(coalesce(c.kind, 'unknown')) into v_kind
    from public.install_crews c
    where c.id = p_crew_id;
    if v_kind in ('employee', 'subcontractor') then
      return v_kind;
    end if;
    return 'unknown';
  end if;
  if p_installer_id is not null then
    select lower(coalesce(c.kind, 'unknown')) into v_kind
    from public.install_crews c
    where c.profile_id = p_installer_id
    order by c.active desc nulls last, c.created_at desc
    limit 1;
    if v_kind in ('employee', 'subcontractor') then
      return v_kind;
    end if;
    return 'unknown';
  end if;
  return 'unknown';
end;
$$;

-- Strict identity + classification for APPROVAL (draft may remain unknown).
create or replace function public.installer_labor_classify_worker(
  p_installer_id uuid,
  p_crew_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_crew public.install_crews%rowtype;
  v_kind text;
  v_installer uuid := p_installer_id;
  v_crew_id uuid := p_crew_id;
begin
  if v_installer is null and v_crew_id is null then
    return jsonb_build_object('ok', false, 'code', 'CLASSIFICATION_REQUIRED',
      'error', 'Approval requires an installer or crew identity.');
  end if;

  if v_crew_id is not null then
    select * into v_crew from public.install_crews where id = v_crew_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'CLASSIFICATION_REQUIRED',
        'error', 'Crew does not exist.');
    end if;
    if v_installer is not null then
      if v_crew.profile_id is distinct from v_installer then
        return jsonb_build_object('ok', false, 'code', 'CLASSIFICATION_REQUIRED',
          'error', 'installer_id and crew_id do not refer to the same worker.');
      end if;
    else
      v_installer := v_crew.profile_id;
    end if;
  elsif v_installer is not null then
    if not exists (select 1 from public.profiles where id = v_installer) then
      return jsonb_build_object('ok', false, 'code', 'CLASSIFICATION_REQUIRED',
        'error', 'Installer profile does not exist.');
    end if;
    select * into v_crew
    from public.install_crews c
    where c.profile_id = v_installer
    order by c.active desc nulls last, c.created_at desc
    limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'CLASSIFICATION_REQUIRED',
        'error', 'Installer has no crew classification (employee vs subcontractor).');
    end if;
    v_crew_id := v_crew.id;
  end if;

  v_kind := lower(coalesce(v_crew.kind, 'unknown'));
  if v_kind not in ('employee', 'subcontractor') then
    return jsonb_build_object('ok', false, 'code', 'CLASSIFICATION_REQUIRED',
      'error', 'Worker kind must be employee or subcontractor before approval.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'kind', v_kind,
    'installer_id', v_installer,
    'crew_id', v_crew_id,
    'supplier_id', v_crew.supplier_id,
    'crew_name', v_crew.name
  );
end;
$$;

create or replace function public.installer_labor_context_hash(
  p_job_id uuid,
  p_installer_id uuid,
  p_crew_id uuid,
  p_subtotal numeric,
  p_adjustments numeric,
  p_total numeric,
  p_service_date date,
  p_line_fingerprint text
)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select md5(
    coalesce(p_job_id::text, '') || '|' ||
    coalesce(p_installer_id::text, '') || '|' ||
    coalesce(p_crew_id::text, '') || '|' ||
    coalesce(round(coalesce(p_subtotal, 0), 2)::text, '0') || '|' ||
    coalesce(round(coalesce(p_adjustments, 0), 2)::text, '0') || '|' ||
    coalesce(round(coalesce(p_total, 0), 2)::text, '0') || '|' ||
    coalesce(p_service_date::text, '') || '|' ||
    coalesce(p_line_fingerprint, '')
  );
$$;

create or replace function public.installer_labor_lookup_action(
  p_key text,
  p_action text,
  p_labor_bill_id uuid,
  p_context_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.installer_labor_action_idempotency%rowtype;
begin
  if p_key is null or btrim(p_key) = '' then
    return null;
  end if;
  select * into v from public.installer_labor_action_idempotency
  where idempotency_key = p_key;
  if not found then
    return null;
  end if;
  if v.action = p_action
     and v.context_hash is not distinct from p_context_hash
     and (
       p_labor_bill_id is null
       or v.labor_bill_id is not distinct from p_labor_bill_id
     ) then
    return v.result || jsonb_build_object('duplicate', true);
  end if;
  return jsonb_build_object(
    'ok', false,
    'error', 'Idempotency key already used with a different labor action or context.',
    'code', 'IDEMPOTENCY_CONFLICT'
  );
end;
$$;

create or replace function public.installer_labor_store_action(
  p_key text,
  p_action text,
  p_labor_bill_id uuid,
  p_context_hash text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or btrim(p_key) = '' then
    return;
  end if;
  insert into public.installer_labor_action_idempotency (
    idempotency_key, action, labor_bill_id, context_hash, result
  ) values (
    p_key, p_action, p_labor_bill_id, p_context_hash, coalesce(p_result, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.installer_labor_active_actual_total(p_job_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(b.total), 0)::numeric
  from public.installer_bills b
  where b.job_id = p_job_id
    and b.status in ('approved', 'paid')
    and coalesce(b.legacy_display_only, false) = false;
$$;

create or replace function public.installer_labor_committed_total(p_job_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(b.total), 0)::numeric
  from public.installer_bills b
  where b.job_id = p_job_id
    and b.status = 'draft'
    and coalesce(b.legacy_display_only, false) = false;
$$;

create or replace function public.installer_labor_recompute_job_actual(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual numeric;
  v_estimated numeric;
begin
  v_actual := round(public.installer_labor_active_actual_total(p_job_id), 2);
  select coalesce(estimated_labor_cost, 0) into v_estimated
  from public.jobs
  where id = p_job_id
  for update;
  if not found then
    return;
  end if;
  update public.jobs
  set actual_labor_cost = v_actual,
      labor_variance = round((v_actual - coalesce(v_estimated, 0))::numeric, 2)
  where id = p_job_id;
end;
$$;

-- Employee-only installer posting intent. Subcontractor accounting owner is vendor AP.
create or replace function public.installer_labor_record_event_status(
  p_bill_id uuid,
  p_event_kind text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.accounting_settings%rowtype;
  v_outbox uuid;
begin
  select * into v_settings from public.accounting_settings where id = 1;
  if found
     and coalesce(v_settings.posting_enabled, false)
     and coalesce(v_settings.installer_posting_enabled, false) then
    v_outbox := public.enqueue_accounting_outbox_safe(
      'installer_bill', p_bill_id, p_event_kind, p_payload, false
    );
    -- enqueue owns event_status when it returns a non-null outbox id.
    if v_outbox is not null then
      return;
    end if;
  end if;

  insert into public.accounting_event_status (
    source_type, source_id, event_kind, status, error_code, error_message
  ) values (
    'installer_bill', p_bill_id, p_event_kind, 'disabled',
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

-- Canonical vendor AP accounting event (subcontractor path). Never overwrites pending.
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
begin
  if p_ap_bill_id is null then
    return;
  end if;
  v_outbox := public.enqueue_accounting_outbox_safe(
    'vendor_bill', p_ap_bill_id, p_event_kind, p_payload, false
  );
  -- When enqueue succeeds it writes pending/review_required itself. Do not overwrite.
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

-- Raise so outer correction transaction rolls back on nested JSON failure.
create or replace function public.installer_labor_require_ok(p_result jsonb, p_step text)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if coalesce((p_result->>'ok')::boolean, false) is not true then
    raise exception 'INSTALLER_LABOR_CORRECTION_ABORTED: % — %',
      p_step,
      coalesce(p_result->>'error', p_result->>'code', 'failed')
      using errcode = 'P0001';
  end if;
  return p_result;
end;
$$;

create or replace function public.installer_labor_lock_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_job_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(
    174,
    ('x' || substr(md5(p_job_id::text), 1, 8))::bit(32)::int
  );
end;
$$;

-- Discover job_id WITHOUT taking installer_bills row lock, then advisory-lock job.
create or replace function public.installer_labor_lock_for_bill(p_bill_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid;
begin
  select job_id into v_job
  from public.installer_bills
  where id = p_bill_id;
  if v_job is null then
    return null;
  end if;
  perform public.installer_labor_lock_job(v_job);
  return v_job;
end;
$$;

create or replace function public.installer_labor_lock_ap_bill(p_ap_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ap_bill_id is null then
    return;
  end if;
  perform 1 from public.bills where id = p_ap_bill_id for update;
  perform 1 from public.bill_payments where bill_id = p_ap_bill_id for update;
end;
$$;

create or replace function public.installer_labor_ap_paid_total(p_ap_bill_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric
  from public.bill_payments
  where bill_id = p_ap_bill_id
    and status = 'active';
$$;

-- Void unpaid installer-linked AP. Never deletes. Blocks if any active payment.
create or replace function public.installer_labor_void_linked_ap(
  p_labor_bill_id uuid,
  p_ap_bill_id uuid,
  p_actor uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ap public.bills%rowtype;
  v_paid numeric;
  v_payload jsonb;
begin
  if p_ap_bill_id is null then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  perform public.installer_labor_lock_ap_bill(p_ap_bill_id);
  select * into v_ap from public.bills where id = p_ap_bill_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  if v_ap.installer_labor_bill_id is distinct from p_labor_bill_id then
    return jsonb_build_object('ok', false, 'error', 'AP bill is not linked to this labor obligation.', 'code', 'AP_LINK_MISMATCH');
  end if;
  if v_ap.ap_lifecycle = 'void' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'ap_bill_id', p_ap_bill_id);
  end if;

  v_paid := public.installer_labor_ap_paid_total(p_ap_bill_id);
  if v_paid > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Linked AP has settlement. Reverse AP payments first.',
      'code', 'AP_SETTLED'
    );
  end if;

  update public.bills
  set ap_lifecycle = 'void',
      voided_at = now(),
      voided_by = p_actor,
      void_reason = trim(p_reason)
  where id = p_ap_bill_id;

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'vendor_bill_void',
    'economicEventDate', coalesce(v_ap.bill_date, current_date)::text,
    'sourceType', 'vendor_bill',
    'sourceId', p_ap_bill_id,
    'installerLaborBillId', p_labor_bill_id,
    'reason', trim(p_reason)
  );
  -- enqueue owns pending/review when posting ON; disabled only when enqueue returns NULL.
  perform public.installer_labor_record_vendor_event(
    p_ap_bill_id, 'vendor_bill_void', v_payload
  );

  perform public.accounting_audit_from_definer_safe(
    'installer_labor_ap_voided',
    'vendor_bill',
    p_ap_bill_id,
    coalesce(v_ap.bill_date, current_date),
    trim(p_reason),
    v_payload,
    p_actor,
    'audit:installer_labor_ap_voided:' || p_ap_bill_id::text
  );

  return jsonb_build_object('ok', true, 'ap_bill_id', p_ap_bill_id, 'duplicate', false);
end;
$$;

-- Sync installer bill paid/approved from canonical AP payments (subcontractor only).
create or replace function public.installer_labor_sync_ap_settlement(p_ap_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_labor public.installer_bills%rowtype;
  v_ap public.bills%rowtype;
  v_paid numeric;
  v_total numeric;
  v_want text;
begin
  select * into v_ap from public.bills where id = p_ap_bill_id;
  if not found or v_ap.installer_labor_bill_id is null then
    return;
  end if;
  select * into v_labor from public.installer_bills where id = v_ap.installer_labor_bill_id;
  if not found then
    return;
  end if;
  if v_labor.worker_kind is distinct from 'subcontractor' then
    return;
  end if;
  if v_labor.status in ('void', 'cancelled', 'draft') then
    return;
  end if;
  if v_ap.ap_lifecycle = 'void' then
    return;
  end if;

  select coalesce(sum(coalesce(quantity, 0) * coalesce(unit_cost, 0)), 0) into v_total
  from public.bill_items where bill_id = p_ap_bill_id;
  v_paid := public.installer_labor_ap_paid_total(p_ap_bill_id);
  v_want := case when v_paid + 0.005 >= v_total and v_total > 0 then 'paid' else 'approved' end;

  if v_labor.status is not distinct from v_want then
    return;
  end if;

  perform set_config('app.installer_labor_mutation', 'true', true);
  update public.installer_bills
  set status = v_want,
      paid_at = case when v_want = 'paid' then coalesce(paid_at, now()) else null end
  where id = v_labor.id;
  perform set_config('app.installer_labor_mutation', 'false', true);
  perform public.installer_labor_recompute_job_actual(v_labor.job_id);
end;
$$;

-- ===========================================================================
-- 3) Immutability triggers (no generic GUC bypass for child lines)
-- ===========================================================================

create or replace function public.installer_bills_enforce_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('approved', 'paid', 'void', 'cancelled') then
      raise exception
        'INSTALLER_LABOR_IMMUTABLE: Approved/paid/void/cancelled installer labor cannot be deleted. Use reverse_installer_labor_safe.';
    end if;
    return old;
  end if;

  -- Cancelled records are historical: not reusable drafts.
  if old.status = 'cancelled' then
    raise exception 'INSTALLER_LABOR_IMMUTABLE: Cancelled installer labor cannot be edited.';
  end if;

  if old.status in ('approved', 'paid', 'void') then
    if current_setting('app.installer_labor_mutation', true) is distinct from 'true' then
      raise exception
        'INSTALLER_LABOR_IMMUTABLE: Approved installer labor is locked. Use reverse/paid RPCs.';
    end if;
    if new.job_id is distinct from old.job_id
       or new.installer_id is distinct from old.installer_id
       or new.crew_id is distinct from old.crew_id
       or new.subtotal is distinct from old.subtotal
       or new.adjustments is distinct from old.adjustments
       or new.total is distinct from old.total
       or new.worker_kind is distinct from old.worker_kind
       or new.reversal_of_bill_id is distinct from old.reversal_of_bill_id
       or new.service_date is distinct from old.service_date
       or new.idempotency_key is distinct from old.idempotency_key then
      raise exception
        'INSTALLER_LABOR_IMMUTABLE: Economic fields on approved installer labor cannot change.';
    end if;
    -- AP source link is financial evidence: never replace once set.
    if old.ap_bill_id is not null and new.ap_bill_id is distinct from old.ap_bill_id then
      raise exception 'INSTALLER_LABOR_IMMUTABLE: AP source link cannot be replaced.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists installer_bills_immutability on public.installer_bills;
create trigger installer_bills_immutability
  before update or delete on public.installer_bills
  for each row execute function public.installer_bills_enforce_immutability();

create or replace function public.installer_bill_lines_enforce_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_new_status text;
begin
  if tg_op = 'DELETE' then
    select status into v_old_status from public.installer_bills where id = old.bill_id;
    if v_old_status in ('approved', 'paid', 'void', 'cancelled') then
      raise exception
        'INSTALLER_LABOR_IMMUTABLE: Lines on approved/void/cancelled installer labor cannot be changed.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select status into v_new_status from public.installer_bills where id = new.bill_id;
    if v_new_status in ('approved', 'paid', 'void', 'cancelled') then
      raise exception
        'INSTALLER_LABOR_IMMUTABLE: Lines on approved/void/cancelled installer labor cannot be changed.';
    end if;
    return new;
  end if;

  -- UPDATE: protect BOTH parents so a cross-parent move cannot bypass.
  select status into v_old_status from public.installer_bills where id = old.bill_id;
  select status into v_new_status from public.installer_bills where id = new.bill_id;
  if v_old_status in ('approved', 'paid', 'void', 'cancelled')
     or v_new_status in ('approved', 'paid', 'void', 'cancelled') then
    raise exception
      'INSTALLER_LABOR_IMMUTABLE: Lines on approved/void/cancelled installer labor cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists installer_bill_lines_immutability on public.installer_bill_line_items;
create trigger installer_bill_lines_immutability
  before insert or update or delete on public.installer_bill_line_items
  for each row execute function public.installer_bill_lines_enforce_immutability();

create or replace function public.bills_installer_labor_link_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.installer_labor_bill_id is not null
       and new.installer_labor_bill_id is distinct from old.installer_labor_bill_id then
      raise exception 'INSTALLER_LABOR_IMMUTABLE: AP installer-labor source link cannot be reassigned.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bills_installer_labor_link_immutable on public.bills;
create trigger bills_installer_labor_link_immutable
  before update on public.bills
  for each row execute function public.bills_installer_labor_link_immutable();

create or replace function public.bill_payments_block_void_ap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select ap_lifecycle into v_status from public.bills where id = new.bill_id;
  if v_status = 'void' then
    raise exception 'AP_VOID: Cannot record payments on a voided vendor bill.';
  end if;
  return new;
end;
$$;

drop trigger if exists bill_payments_block_void_ap on public.bill_payments;
create trigger bill_payments_block_void_ap
  before insert or update of bill_id, amount, status on public.bill_payments
  for each row execute function public.bill_payments_block_void_ap();

create or replace function public.bill_payments_sync_installer_labor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.installer_labor_sync_ap_settlement(coalesce(new.bill_id, old.bill_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists bill_payments_sync_installer_labor on public.bill_payments;
create trigger bill_payments_sync_installer_labor
  after insert or update or delete on public.bill_payments
  for each row execute function public.bill_payments_sync_installer_labor();

-- ===========================================================================
-- 4) Staff RPCs
-- ===========================================================================

create or replace function public.create_installer_labor_bill_safe(
  p_job_id uuid,
  p_installer_id uuid default null,
  p_crew_id uuid default null,
  p_service_date date default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb,
  p_adjustments numeric default 0,
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
  v_job public.jobs%rowtype;
  v_bill_id uuid;
  v_kind text;
  v_computed jsonb;
  v_hash text;
  v_line jsonb;
  v_dup jsonb;
  v_result jsonb;
  v_installer uuid;
  v_crew uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'create installer labor bills');
  v_actor := public.accounting_actor_id(p_created_by);

  if p_job_id is null then
    return jsonb_build_object('ok', false, 'error', 'job_id is required.');
  end if;

  v_computed := public.installer_labor_validate_lines(p_job_id, p_lines, p_adjustments);
  if coalesce((v_computed->>'ok')::boolean, false) is not true then
    return v_computed;
  end if;

  perform public.installer_labor_lock_job(p_job_id);
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Job not found.');
  end if;

  -- Resolve ACTUAL persisted worker identity BEFORE kind/hash/idempotency.
  v_installer := coalesce(p_installer_id, v_job.assigned_to);
  v_crew := coalesce(p_crew_id, v_job.assigned_crew_id);

  v_kind := public.installer_labor_resolve_worker_kind(v_installer, v_crew);
  v_hash := public.installer_labor_context_hash(
    p_job_id, v_installer, v_crew,
    (v_computed->>'subtotal')::numeric,
    (v_computed->>'adjustments')::numeric,
    (v_computed->>'total')::numeric,
    p_service_date,
    v_computed->>'fingerprint'
  );

  v_dup := public.installer_labor_lookup_action(p_idempotency_key, 'create', null, v_hash);
  if v_dup is not null then
    return v_dup;
  end if;

  insert into public.installer_bills (
    job_id, installer_id, crew_id, worker_kind, status,
    subtotal, adjustments, total, notes, service_date,
    created_by, idempotency_key, context_hash, source_context,
    ap_sync_status
  ) values (
    p_job_id,
    v_installer,
    v_crew,
    v_kind,
    'draft',
    (v_computed->>'subtotal')::numeric,
    (v_computed->>'adjustments')::numeric,
    (v_computed->>'total')::numeric,
    nullif(trim(coalesce(p_notes, '')), ''),
    p_service_date,
    v_actor,
    p_idempotency_key,
    v_hash,
    jsonb_build_object('createdVia', 'create_installer_labor_bill_safe'),
    case
      when v_kind = 'employee' then 'payroll_boundary'
      when v_kind = 'subcontractor' then 'pending_vendor_ap'
      else 'none'
    end
  )
  returning id into v_bill_id;

  for v_line in select * from jsonb_array_elements(coalesce(v_computed->'lines', '[]'::jsonb))
  loop
    insert into public.installer_bill_line_items (
      bill_id, description, quantity, unit, rate, line_total,
      source, is_modified, change_reason, position, job_line_id
    ) values (
      v_bill_id,
      v_line->>'description',
      (v_line->>'quantity')::numeric,
      v_line->>'unit',
      (v_line->>'rate')::numeric,
      (v_line->>'line_total')::numeric,
      v_line->>'source',
      coalesce((v_line->>'is_modified')::boolean, false),
      v_line->>'change_reason',
      coalesce((v_line->>'position')::int, 0),
      nullif(v_line->>'job_line_id', '')::uuid
    );
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'bill_id', v_bill_id,
    'status', 'draft',
    'total', (v_computed->>'total')::numeric,
    'worker_kind', v_kind,
    'duplicate', false
  );

  perform public.accounting_audit_from_definer_safe(
    'installer_labor_created',
    'installer_bill',
    v_bill_id,
    coalesce(p_service_date, current_date),
    null,
    jsonb_build_object('jobId', p_job_id, 'total', v_computed->>'total', 'workerKind', v_kind),
    v_actor,
    case when p_idempotency_key is null then null
         else 'audit:installer_labor_created:' || p_idempotency_key end
  );
  perform public.installer_labor_store_action(p_idempotency_key, 'create', v_bill_id, v_hash, v_result);
  return v_result;
end;
$$;

create or replace function public.save_installer_labor_draft_safe(
  p_bill_id uuid,
  p_lines jsonb,
  p_adjustments numeric default 0,
  p_notes text default null,
  p_service_date date default null,
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
  v_job uuid;
  v_bill public.installer_bills%rowtype;
  v_computed jsonb;
  v_hash text;
  v_line jsonb;
  v_dup jsonb;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'edit installer labor drafts');
  v_actor := public.accounting_actor_id(p_created_by);

  v_job := public.installer_labor_lock_for_bill(p_bill_id);
  select * into v_bill from public.installer_bills where id = p_bill_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Installer labor bill not found.');
  end if;
  if v_bill.job_id is distinct from v_job then
    return jsonb_build_object('ok', false, 'error', 'Job mismatch after lock.', 'code', 'JOB_MISMATCH');
  end if;
  if v_bill.status <> 'draft' then
    return jsonb_build_object('ok', false, 'error', 'Only draft installer labor can be edited.');
  end if;

  -- PHASE A — no mutation
  v_computed := public.installer_labor_validate_lines(v_bill.job_id, p_lines, p_adjustments);
  if coalesce((v_computed->>'ok')::boolean, false) is not true then
    return v_computed;
  end if;

  v_hash := public.installer_labor_context_hash(
    v_bill.job_id, v_bill.installer_id, v_bill.crew_id,
    (v_computed->>'subtotal')::numeric,
    (v_computed->>'adjustments')::numeric,
    (v_computed->>'total')::numeric,
    coalesce(p_service_date, v_bill.service_date),
    v_computed->>'fingerprint'
  );

  v_dup := public.installer_labor_lookup_action(p_idempotency_key, 'save_draft', p_bill_id, v_hash);
  if v_dup is not null then
    return v_dup;
  end if;

  -- PHASE B — mutation only after full validation
  delete from public.installer_bill_line_items where bill_id = p_bill_id;
  for v_line in select * from jsonb_array_elements(coalesce(v_computed->'lines', '[]'::jsonb))
  loop
    insert into public.installer_bill_line_items (
      bill_id, description, quantity, unit, rate, line_total,
      source, is_modified, change_reason, position, job_line_id
    ) values (
      p_bill_id,
      v_line->>'description',
      (v_line->>'quantity')::numeric,
      v_line->>'unit',
      (v_line->>'rate')::numeric,
      (v_line->>'line_total')::numeric,
      v_line->>'source',
      coalesce((v_line->>'is_modified')::boolean, false),
      v_line->>'change_reason',
      coalesce((v_line->>'position')::int, 0),
      nullif(v_line->>'job_line_id', '')::uuid
    );
  end loop;

  update public.installer_bills
  set subtotal = (v_computed->>'subtotal')::numeric,
      adjustments = (v_computed->>'adjustments')::numeric,
      total = (v_computed->>'total')::numeric,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      service_date = coalesce(p_service_date, service_date),
      context_hash = v_hash
  where id = p_bill_id;

  perform public.installer_labor_store_action(
    p_idempotency_key, 'save_draft', p_bill_id, v_hash,
    jsonb_build_object('ok', true, 'bill_id', p_bill_id, 'total', v_computed->>'total', 'status', 'draft')
  );

  return jsonb_build_object('ok', true, 'bill_id', p_bill_id, 'total', (v_computed->>'total')::numeric, 'status', 'draft');
end;
$$;

create or replace function public.approve_installer_labor_safe(
  p_bill_id uuid,
  p_confirm boolean default false,
  p_service_date date default null,
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
  v_job uuid;
  v_bill public.installer_bills%rowtype;
  v_role text;
  v_ap_id uuid;
  v_payload jsonb;
  v_econ date;
  v_class jsonb;
  v_kind text;
  v_supplier_id uuid;
  v_supplier text;
  v_dup jsonb;
  v_result jsonb;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'approve installer labor');
  v_actor := public.accounting_actor_id(p_created_by);

  if auth.uid() is not null then
    v_role := public.user_role(auth.uid())::text;
    if v_role = 'crew' then
      return jsonb_build_object('ok', false, 'error', 'Installers cannot approve labor obligations.', 'code', 'SELF_APPROVE_BLOCKED');
    end if;
  end if;

  if not coalesce(p_confirm, false) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Approval creates immutable financial history. Pass p_confirm=true to proceed.',
      'code', 'CONFIRM_REQUIRED'
    );
  end if;

  v_job := public.installer_labor_lock_for_bill(p_bill_id);
  select * into v_bill from public.installer_bills where id = p_bill_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Installer labor bill not found.');
  end if;
  if v_bill.job_id is distinct from v_job then
    return jsonb_build_object('ok', false, 'error', 'Job mismatch after lock.', 'code', 'JOB_MISMATCH');
  end if;
  perform public.installer_labor_lock_ap_bill(v_bill.ap_bill_id);

  if v_bill.status in ('approved', 'paid') then
    v_dup := public.installer_labor_lookup_action(
      p_idempotency_key, 'approve', p_bill_id, v_bill.context_hash
    );
    if v_dup is not null and coalesce((v_dup->>'ok')::boolean, false) is not true then
      return v_dup;
    end if;
    v_result := jsonb_build_object(
      'ok', true, 'bill_id', p_bill_id, 'duplicate', true,
      'status', v_bill.status, 'total', v_bill.total, 'ap_bill_id', v_bill.ap_bill_id,
      'worker_kind', v_bill.worker_kind
    );
    perform public.installer_labor_store_action(p_idempotency_key, 'approve', p_bill_id, v_bill.context_hash, v_result);
    return v_result;
  end if;
  if v_bill.status <> 'draft' then
    return jsonb_build_object('ok', false, 'error', 'Only draft labor can be approved.', 'status', v_bill.status);
  end if;
  if not public.installer_labor_money_ok(v_bill.total) or v_bill.total <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Approved labor total must be positive valid money.', 'code', 'INVALID_AMOUNT');
  end if;

  v_class := public.installer_labor_classify_worker(v_bill.installer_id, v_bill.crew_id);
  if coalesce((v_class->>'ok')::boolean, false) is not true then
    return v_class;
  end if;
  v_kind := v_class->>'kind';
  v_supplier_id := nullif(v_class->>'supplier_id', '')::uuid;

  if v_kind = 'subcontractor' and v_supplier_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'SUBCONTRACTOR_VENDOR_REQUIRED',
      'error', 'Subcontractor crew must be linked to a canonical supplier before approval.'
    );
  end if;

  v_dup := public.installer_labor_lookup_action(p_idempotency_key, 'approve', p_bill_id, v_bill.context_hash);
  if v_dup is not null then
    return v_dup;
  end if;

  v_econ := coalesce(p_service_date, v_bill.service_date, current_date);

  perform set_config('app.installer_labor_mutation', 'true', true);
  update public.installer_bills
  set status = 'approved',
      approved_at = now(),
      approved_by = v_actor,
      service_date = v_econ,
      worker_kind = v_kind,
      installer_id = coalesce(nullif(v_class->>'installer_id','')::uuid, installer_id),
      crew_id = coalesce(nullif(v_class->>'crew_id','')::uuid, crew_id),
      ap_sync_status = case
        when v_kind = 'employee' then 'payroll_boundary'
        when v_kind = 'subcontractor' then 'pending_vendor_ap'
        else 'none'
      end
  where id = p_bill_id;
  perform set_config('app.installer_labor_mutation', 'false', true);

  perform public.installer_labor_recompute_job_actual(v_bill.job_id);

  if v_kind = 'subcontractor' and v_bill.ap_bill_id is null then
    select name into v_supplier from public.suppliers where id = v_supplier_id;
    insert into public.bills (
      job_id, customer_id, supplier_id, supplier, bill_date, due_date, memo,
      created_by, accounting_category, installer_labor_bill_id, ap_lifecycle
    )
    select
      j.id,
      j.customer_id,
      v_supplier_id,
      coalesce(v_supplier, v_class->>'crew_name', 'Installer'),
      v_econ,
      v_econ + 14,
      'Installer labor obligation ' || p_bill_id::text,
      v_actor,
      'installer_labor',
      p_bill_id,
      'open'
    from public.jobs j
    where j.id = v_bill.job_id
    returning id into v_ap_id;

    insert into public.bill_items (
      bill_id, position, description, quantity, unit, unit_cost
    ) values (
      v_ap_id, 0, 'Installer labor', 1, 'job', v_bill.total
    );

    perform set_config('app.installer_labor_mutation', 'true', true);
    update public.installer_bills
    set ap_bill_id = v_ap_id,
        ap_sync_status = 'linked_vendor_ap'
    where id = p_bill_id;
    perform set_config('app.installer_labor_mutation', 'false', true);

    perform public.accounting_audit_from_definer_safe(
      'installer_labor_ap_linked',
      'vendor_bill',
      v_ap_id,
      v_econ,
      null,
      jsonb_build_object('installerLaborBillId', p_bill_id, 'supplierId', v_supplier_id),
      v_actor,
      'audit:installer_labor_ap_linked:' || p_bill_id::text
    );

    -- Subcontractor accounting owner = vendor AP (single event path).
    v_payload := jsonb_build_object(
      'schemaVersion', 1,
      'eventKind', 'vendor_bill',
      'economicEventDate', v_econ::text,
      'sourceType', 'vendor_bill',
      'sourceId', v_ap_id,
      'amount', v_bill.total,
      'jobId', v_bill.job_id,
      'installerLaborBillId', p_bill_id,
      'workerKind', v_kind,
      'actorId', v_actor
    );
    perform public.installer_labor_record_vendor_event(v_ap_id, 'vendor_bill', v_payload);
  elsif v_kind = 'employee' then
    perform set_config('app.installer_labor_mutation', 'true', true);
    update public.installer_bills
    set ap_sync_status = 'payroll_boundary'
    where id = p_bill_id;
    perform set_config('app.installer_labor_mutation', 'false', true);

    -- Employee-only installer_bill posting intent (gated by installer_posting_enabled).
    v_payload := jsonb_build_object(
      'schemaVersion', 1,
      'eventKind', 'installer_bill',
      'economicEventDate', v_econ::text,
      'sourceType', 'installer_bill',
      'sourceId', p_bill_id,
      'amount', v_bill.total,
      'jobId', v_bill.job_id,
      'workerKind', v_kind,
      'actorId', v_actor
    );
    perform public.installer_labor_record_event_status(p_bill_id, 'installer_bill', v_payload);
  end if;

  perform public.accounting_audit_from_definer_safe(
    'installer_labor_approved',
    'installer_bill',
    p_bill_id,
    v_econ,
    null,
    coalesce(v_payload, jsonb_build_object(
      'billId', p_bill_id,
      'workerKind', v_kind,
      'apBillId', v_ap_id,
      'amount', v_bill.total
    )),
    v_actor,
    coalesce(
      case when p_idempotency_key is not null
           then 'audit:installer_labor_approved:' || p_idempotency_key end,
      'audit:installer_labor_approved:' || p_bill_id::text
    )
  );

  v_result := jsonb_build_object(
    'ok', true,
    'bill_id', p_bill_id,
    'status', 'approved',
    'total', v_bill.total,
    'ap_bill_id', v_ap_id,
    'worker_kind', v_kind,
    'duplicate', false
  );
  perform public.installer_labor_store_action(p_idempotency_key, 'approve', p_bill_id, v_bill.context_hash, v_result);
  return v_result;
end;
$$;

create or replace function public.reverse_installer_labor_safe(
  p_bill_id uuid,
  p_reason text,
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
  v_job uuid;
  v_bill public.installer_bills%rowtype;
  v_payload jsonb;
  v_dup jsonb;
  v_ap jsonb;
  v_result jsonb;
  v_ctx text;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'reverse installer labor');
  v_actor := public.accounting_actor_id(p_created_by);

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Reversal reason is required.', 'code', 'REASON_REQUIRED');
  end if;

  v_job := public.installer_labor_lock_for_bill(p_bill_id);
  select * into v_bill from public.installer_bills where id = p_bill_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Installer labor bill not found.');
  end if;
  if v_bill.job_id is distinct from v_job then
    return jsonb_build_object('ok', false, 'error', 'Job mismatch after lock.', 'code', 'JOB_MISMATCH');
  end if;
  perform public.installer_labor_lock_ap_bill(v_bill.ap_bill_id);

  v_ctx := coalesce(v_bill.context_hash, '') || '|void|' || p_bill_id::text;
  v_dup := public.installer_labor_lookup_action(p_idempotency_key, 'reverse', p_bill_id, v_ctx);
  if v_dup is not null then
    return v_dup;
  end if;

  if v_bill.status = 'void' then
    v_result := jsonb_build_object('ok', true, 'bill_id', p_bill_id, 'duplicate', true, 'status', 'void');
    perform public.installer_labor_store_action(p_idempotency_key, 'reverse', p_bill_id, v_ctx, v_result);
    return v_result;
  end if;
  if v_bill.status = 'draft' then
    return jsonb_build_object('ok', false, 'error', 'Cancel draft labor with cancel_installer_labor_draft_safe.');
  end if;
  if v_bill.status = 'paid' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Paid labor cannot be silently voided. Reverse AP/payroll payment first, then reverse.',
      'code', 'PAID_LOCKED'
    );
  end if;
  if v_bill.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'Only approved labor can be reversed.', 'status', v_bill.status);
  end if;

  v_ap := public.installer_labor_void_linked_ap(p_bill_id, v_bill.ap_bill_id, v_actor, p_reason);
  if coalesce((v_ap->>'ok')::boolean, false) is not true then
    return v_ap;
  end if;

  perform set_config('app.installer_labor_mutation', 'true', true);
  update public.installer_bills
  set status = 'void',
      prior_status = 'approved',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = trim(p_reason),
      ap_sync_status = case
        when ap_bill_id is not null then 'ap_voided'
        else ap_sync_status
      end
  where id = p_bill_id;
  perform set_config('app.installer_labor_mutation', 'false', true);

  perform public.installer_labor_recompute_job_actual(v_bill.job_id);

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', case
      when v_bill.worker_kind = 'subcontractor' then 'vendor_bill_void'
      else 'installer_bill_void'
    end,
    'economicEventDate', coalesce(v_bill.service_date, current_date)::text,
    'sourceType', case
      when v_bill.worker_kind = 'subcontractor' then 'vendor_bill'
      else 'installer_bill'
    end,
    'sourceId', case
      when v_bill.worker_kind = 'subcontractor' then v_bill.ap_bill_id
      else p_bill_id
    end,
    'amount', v_bill.total,
    'reason', trim(p_reason),
    'installerLaborBillId', p_bill_id,
    'apBillId', v_bill.ap_bill_id,
    'actorId', v_actor
  );
  -- Subcontractor: vendor_bill_void is recorded by installer_labor_void_linked_ap.
  -- Employee: installer_bill_void behind installer posting gate only.
  if v_bill.worker_kind is distinct from 'subcontractor' then
    perform public.installer_labor_record_event_status(p_bill_id, 'installer_bill_void', v_payload);
  end if;

  perform public.accounting_audit_from_definer_safe(
    'installer_labor_reversed',
    'installer_bill',
    p_bill_id,
    coalesce(v_bill.service_date, current_date),
    trim(p_reason),
    v_payload,
    v_actor,
    coalesce(
      case when p_idempotency_key is not null
           then 'audit:installer_labor_reversed:' || p_idempotency_key end,
      'audit:installer_labor_reversed:' || p_bill_id::text
    )
  );

  v_result := jsonb_build_object(
    'ok', true,
    'bill_id', p_bill_id,
    'status', 'void',
    'original_total', v_bill.total,
    'ap_bill_id', v_bill.ap_bill_id,
    'duplicate', false
  );
  perform public.installer_labor_store_action(p_idempotency_key, 'reverse', p_bill_id, v_ctx, v_result);
  return v_result;
end;
$$;

create or replace function public.cancel_installer_labor_draft_safe(
  p_bill_id uuid,
  p_reason text default null,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_job uuid;
  v_bill public.installer_bills%rowtype;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'cancel installer labor drafts');
  v_actor := public.accounting_actor_id(p_created_by);

  v_job := public.installer_labor_lock_for_bill(p_bill_id);
  select * into v_bill from public.installer_bills where id = p_bill_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Installer labor bill not found.');
  end if;
  if v_bill.job_id is distinct from v_job then
    return jsonb_build_object('ok', false, 'error', 'Job mismatch after lock.', 'code', 'JOB_MISMATCH');
  end if;
  if v_bill.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'bill_id', p_bill_id, 'duplicate', true, 'status', 'cancelled');
  end if;
  if v_bill.status <> 'draft' then
    return jsonb_build_object('ok', false, 'error', 'Only draft labor can be cancelled.');
  end if;

  update public.installer_bills
  set status = 'cancelled',
      prior_status = 'draft',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_bill_id;

  perform public.accounting_audit_from_definer_safe(
    'installer_labor_cancelled',
    'installer_bill',
    p_bill_id,
    current_date,
    nullif(trim(coalesce(p_reason, '')), ''),
    jsonb_build_object('jobId', v_bill.job_id),
    v_actor,
    'audit:installer_labor_cancelled:' || p_bill_id::text
  );

  return jsonb_build_object('ok', true, 'bill_id', p_bill_id, 'status', 'cancelled');
end;
$$;

create or replace function public.mark_installer_labor_paid_safe(
  p_bill_id uuid,
  p_paid_on date default null,
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
  v_job uuid;
  v_bill public.installer_bills%rowtype;
  v_econ date;
  v_dup jsonb;
  v_result jsonb;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'record installer payroll ops status');
  v_actor := public.accounting_actor_id(p_created_by);

  v_job := public.installer_labor_lock_for_bill(p_bill_id);
  select * into v_bill from public.installer_bills where id = p_bill_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Installer labor bill not found.');
  end if;
  if v_bill.job_id is distinct from v_job then
    return jsonb_build_object('ok', false, 'error', 'Job mismatch after lock.', 'code', 'JOB_MISMATCH');
  end if;
  perform public.installer_labor_lock_ap_bill(v_bill.ap_bill_id);

  if v_bill.worker_kind = 'subcontractor' then
    return jsonb_build_object(
      'ok', false,
      'code', 'SUBCONTRACTOR_USE_AP_PAYMENT',
      'error', 'Subcontractor labor is paid through the linked AP bill. Use record_bill_payment_safe.'
    );
  end if;

  v_dup := public.installer_labor_lookup_action(
    p_idempotency_key, 'payroll_ops', p_bill_id, coalesce(v_bill.context_hash, '')
  );
  if v_dup is not null then
    return v_dup;
  end if;

  if v_bill.payroll_ops_status = 'recorded' or v_bill.status = 'paid' then
    v_result := jsonb_build_object(
      'ok', true, 'bill_id', p_bill_id, 'duplicate', true,
      'status', v_bill.status, 'payroll_ops_status', 'recorded'
    );
    perform public.installer_labor_store_action(
      p_idempotency_key, 'payroll_ops', p_bill_id, v_bill.context_hash, v_result
    );
    return v_result;
  end if;
  if v_bill.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'Only approved employee labor can record payroll ops status.', 'status', v_bill.status);
  end if;
  if v_bill.worker_kind is distinct from 'employee' then
    return jsonb_build_object(
      'ok', false,
      'code', 'CLASSIFICATION_REQUIRED',
      'error', 'Payroll ops status is only for employee labor.'
    );
  end if;

  v_econ := coalesce(p_paid_on, current_date);
  perform set_config('app.installer_labor_mutation', 'true', true);
  update public.installer_bills
  set payroll_ops_status = 'recorded',
      paid_at = v_econ::timestamptz
  where id = p_bill_id;
  perform set_config('app.installer_labor_mutation', 'false', true);

  -- Operational payroll flag does not change actual labor cost.
  perform public.installer_labor_recompute_job_actual(v_bill.job_id);

  perform public.accounting_audit_from_definer_safe(
    'installer_labor_payroll_ops_recorded',
    'installer_bill',
    p_bill_id,
    v_econ,
    null,
    jsonb_build_object('jobId', v_bill.job_id, 'total', v_bill.total, 'note', 'operational payroll status only'),
    v_actor,
    coalesce(
      case when p_idempotency_key is not null
           then 'audit:installer_labor_payroll_ops:' || p_idempotency_key end,
      'audit:installer_labor_payroll_ops:' || p_bill_id::text
    )
  );

  v_result := jsonb_build_object(
    'ok', true, 'bill_id', p_bill_id, 'status', 'approved',
    'payroll_ops_status', 'recorded', 'total', v_bill.total
  );
  perform public.installer_labor_store_action(
    p_idempotency_key, 'payroll_ops', p_bill_id, v_bill.context_hash, v_result
  );
  return v_result;
end;
$$;

create or replace function public.installer_labor_owed_paid_remaining(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actual numeric := 0;
  v_committed numeric := 0;
  v_owed numeric := 0;
  v_paid numeric := 0;
  r record;
  v_ap_paid numeric;
  v_ap_status text;
begin
  for r in
    select b.*
    from public.installer_bills b
    where b.job_id = p_job_id
      and coalesce(b.legacy_display_only, false) = false
  loop
    if r.status = 'draft' then
      v_committed := v_committed + coalesce(r.total, 0);
    elsif r.status in ('approved', 'paid') then
      v_actual := v_actual + coalesce(r.total, 0);
      if r.worker_kind = 'subcontractor' and r.ap_bill_id is not null then
        select ap_lifecycle into v_ap_status from public.bills where id = r.ap_bill_id;
        if v_ap_status = 'void' then
          null;
        else
          v_ap_paid := public.installer_labor_ap_paid_total(r.ap_bill_id);
          v_paid := v_paid + v_ap_paid;
          v_owed := v_owed + greatest(round(coalesce(r.total, 0) - v_ap_paid, 2), 0);
        end if;
      elsif r.worker_kind = 'employee' then
        if r.payroll_ops_status = 'recorded' then
          v_paid := v_paid + coalesce(r.total, 0);
        else
          v_owed := v_owed + coalesce(r.total, 0);
        end if;
      else
        if r.status = 'paid' then
          v_paid := v_paid + coalesce(r.total, 0);
        else
          v_owed := v_owed + coalesce(r.total, 0);
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'actual', round(v_actual, 2),
    'owed', round(v_owed, 2),
    'paid', round(v_paid, 2),
    'remaining', round(v_owed, 2),
    'committed', round(v_committed, 2)
  );
end;
$$;

create or replace function public.correct_installer_labor_safe(
  p_bill_id uuid,
  p_reason text,
  p_lines jsonb,
  p_adjustments numeric default 0,
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
  v_job uuid;
  v_bill public.installer_bills%rowtype;
  v_ap public.bills%rowtype;
  v_create jsonb;
  v_new_id uuid;
  v_approve jsonb;
  v_rev jsonb;
  v_computed jsonb;
  v_hash text;
  v_dup jsonb;
  v_result jsonb;
  v_class jsonb;
  v_paid numeric;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'correct installer labor');
  v_actor := public.accounting_actor_id(p_created_by);

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Correction reason is required.', 'code', 'REASON_REQUIRED');
  end if;

  -- -------------------------------------------------------------------------
  -- COMPLETE PREFLIGHT — no economic mutation before this block succeeds.
  -- -------------------------------------------------------------------------
  v_job := public.installer_labor_lock_for_bill(p_bill_id);
  select * into v_bill from public.installer_bills where id = p_bill_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Installer labor bill not found.');
  end if;
  if v_bill.job_id is distinct from v_job then
    return jsonb_build_object('ok', false, 'error', 'Job mismatch after lock.', 'code', 'JOB_MISMATCH');
  end if;
  perform public.installer_labor_lock_ap_bill(v_bill.ap_bill_id);

  if v_bill.status = 'paid' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Paid labor cannot be silently corrected. Reverse payment first.',
      'code', 'PAID_LOCKED'
    );
  end if;
  if v_bill.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'Only approved labor can be corrected.', 'status', v_bill.status);
  end if;

  if v_bill.ap_bill_id is not null then
    select * into v_ap from public.bills where id = v_bill.ap_bill_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'Linked AP bill missing.', 'code', 'AP_LINK_MISMATCH');
    end if;
    if v_ap.installer_labor_bill_id is distinct from p_bill_id then
      return jsonb_build_object('ok', false, 'error', 'AP bill is not linked to this labor obligation.', 'code', 'AP_LINK_MISMATCH');
    end if;
    if v_ap.ap_lifecycle = 'void' then
      return jsonb_build_object(
        'ok', false,
        'error', 'Linked AP is already void; resolve inconsistency before correction.',
        'code', 'AP_INCONSISTENT'
      );
    end if;
    v_paid := public.installer_labor_ap_paid_total(v_bill.ap_bill_id);
    if v_paid > 0.005 then
      return jsonb_build_object(
        'ok', false,
        'error', 'Linked AP has settlement. Reverse AP payments first.',
        'code', 'AP_SETTLED'
      );
    end if;
  end if;

  v_computed := public.installer_labor_validate_lines(v_bill.job_id, p_lines, p_adjustments);
  if coalesce((v_computed->>'ok')::boolean, false) is not true then
    return v_computed;
  end if;
  if not public.installer_labor_money_ok((v_computed->>'total')::numeric)
     or (v_computed->>'total')::numeric <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Replacement total must be positive valid money.', 'code', 'INVALID_AMOUNT');
  end if;

  v_class := public.installer_labor_classify_worker(v_bill.installer_id, v_bill.crew_id);
  if coalesce((v_class->>'ok')::boolean, false) is not true then
    return v_class;
  end if;
  if (v_class->>'kind') = 'subcontractor'
     and nullif(v_class->>'supplier_id', '') is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'SUBCONTRACTOR_VENDOR_REQUIRED',
      'error', 'Subcontractor crew must be linked to a canonical supplier before correction.'
    );
  end if;

  v_hash := public.installer_labor_context_hash(
    v_bill.job_id, v_bill.installer_id, v_bill.crew_id,
    (v_computed->>'subtotal')::numeric,
    (v_computed->>'adjustments')::numeric,
    (v_computed->>'total')::numeric,
    v_bill.service_date,
    v_computed->>'fingerprint'
  );

  v_dup := public.installer_labor_lookup_action(p_idempotency_key, 'correct', p_bill_id, v_hash);
  if v_dup is not null then
    return v_dup;
  end if;

  -- -------------------------------------------------------------------------
  -- MUTATION PATH — any nested JSON failure RAISES so the whole TX rolls back.
  -- -------------------------------------------------------------------------
  v_create := public.installer_labor_require_ok(
    public.create_installer_labor_bill_safe(
      v_bill.job_id,
      v_bill.installer_id,
      v_bill.crew_id,
      v_bill.service_date,
      'Correction of ' || p_bill_id::text || ': ' || trim(p_reason),
      p_lines,
      p_adjustments,
      v_actor,
      case when p_idempotency_key is null then null else p_idempotency_key || ':create-replacement' end
    ),
    'create replacement'
  );
  v_new_id := (v_create->>'bill_id')::uuid;

  update public.installer_bills
  set reversal_of_bill_id = p_bill_id
  where id = v_new_id
    and status = 'draft';

  v_rev := public.installer_labor_require_ok(
    public.reverse_installer_labor_safe(
      p_bill_id,
      p_reason,
      v_actor,
      case when p_idempotency_key is null then null else p_idempotency_key || ':void-original' end
    ),
    'reverse original'
  );

  v_approve := public.installer_labor_require_ok(
    public.approve_installer_labor_safe(
      v_new_id, true, v_bill.service_date, v_actor,
      case when p_idempotency_key is null then null else p_idempotency_key || ':approve-correction' end
    ),
    'approve replacement'
  );

  perform public.accounting_audit_from_definer_safe(
    'installer_labor_corrected',
    'installer_bill',
    v_new_id,
    coalesce(v_bill.service_date, current_date),
    trim(p_reason),
    jsonb_build_object(
      'originalBillId', p_bill_id,
      'correctionBillId', v_new_id,
      'originalTotal', v_bill.total,
      'originalApBillId', v_bill.ap_bill_id,
      'replacementApBillId', v_approve->>'ap_bill_id'
    ),
    v_actor,
    case when p_idempotency_key is null then null
         else 'audit:installer_labor_corrected:' || p_idempotency_key end
  );

  v_result := jsonb_build_object(
    'ok', true,
    'bill_id', v_new_id,
    'original_bill_id', p_bill_id,
    'status', 'approved',
    'ap_bill_id', v_approve->>'ap_bill_id',
    'duplicate', false
  );
  perform public.installer_labor_store_action(p_idempotency_key, 'correct', p_bill_id, v_hash, v_result);
  return v_result;
end;
$$;

-- ===========================================================================
-- 5) enqueue_accounting_outbox_safe — 0171 body + installer_bill + vendor_bill_void
--    Additive event kinds only. posting_enabled still short-circuits first.
-- ===========================================================================

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

-- ===========================================================================
-- 6) RLS — admin/office only (explicit). Crew/sales/warehouse cannot SELECT compensation.
-- ===========================================================================

alter table public.installer_bills enable row level security;
alter table public.installer_bill_line_items enable row level security;

drop policy if exists installer_bills_staff on public.installer_bills;
drop policy if exists installer_bills_staff_select on public.installer_bills;
drop policy if exists installer_bills_admin_office_select on public.installer_bills;
create policy installer_bills_admin_office_select on public.installer_bills
  for select to authenticated
  using (public.user_role(auth.uid()) in ('admin', 'office'));

drop policy if exists installer_bill_line_items_staff on public.installer_bill_line_items;
drop policy if exists installer_bill_line_items_staff_select on public.installer_bill_line_items;
drop policy if exists installer_bill_line_items_admin_office_select on public.installer_bill_line_items;
create policy installer_bill_line_items_admin_office_select on public.installer_bill_line_items
  for select to authenticated
  using (public.user_role(auth.uid()) in ('admin', 'office'));

revoke insert, update, delete on public.installer_bills from authenticated;
revoke insert, update, delete on public.installer_bill_line_items from authenticated;
grant select on public.installer_bills to authenticated;
grant select on public.installer_bill_line_items to authenticated;
grant select, insert, update, delete on public.installer_bills to service_role;
grant select, insert, update, delete on public.installer_bill_line_items to service_role;

revoke all on public.installer_labor_action_idempotency from public;
revoke all on public.installer_labor_action_idempotency from anon;
revoke all on public.installer_labor_action_idempotency from authenticated;
grant all on public.installer_labor_action_idempotency to service_role;

-- ===========================================================================
-- 7) ACL sweep
-- ===========================================================================

do $$
declare
  r record;
  v_staff text[] := array[
    'create_installer_labor_bill_safe',
    'save_installer_labor_draft_safe',
    'approve_installer_labor_safe',
    'reverse_installer_labor_safe',
    'cancel_installer_labor_draft_safe',
    'correct_installer_labor_safe',
    'mark_installer_labor_paid_safe',
    'installer_labor_active_actual_total',
    'installer_labor_committed_total',
    'installer_labor_owed_paid_remaining'
  ];
  v_internal text[] := array[
    'installer_labor_money_ok',
    'installer_labor_line_total',
    'installer_labor_resolve_worker_kind',
    'installer_labor_classify_worker',
    'installer_labor_context_hash',
    'installer_labor_recompute_job_actual',
    'installer_labor_record_event_status',
    'installer_labor_record_vendor_event',
    'installer_labor_require_ok',
    'installer_labor_lock_job',
    'installer_labor_lock_for_bill',
    'installer_labor_lock_ap_bill',
    'installer_labor_validate_lines',
    'installer_labor_parse_numeric_text',
    'installer_labor_json_numeric',
    'installer_labor_json_bool',
    'installer_labor_json_uuid',
    'installer_labor_text_is_nonfinite',
    'installer_labor_lookup_action',
    'installer_labor_store_action',
    'installer_labor_void_linked_ap',
    'installer_labor_sync_ap_settlement',
    'installer_labor_ap_paid_total',
    'installer_bills_enforce_immutability',
    'installer_bill_lines_enforce_immutability',
    'bills_installer_labor_link_immutable',
    'bill_payments_block_void_ap',
    'bill_payments_sync_installer_labor'
  ];
  v_all text[];
begin
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
end;
$$;

-- Explicit: no posting flags touched.
-- posting_enabled / installer_posting_enabled / books_of_record remain as set by owner.
