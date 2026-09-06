-- F6-P3B: Accounts payable cleanup + vendor/category integrity.
-- Canonical AP ledger remains public.bills. Posting stays OFF.
-- DO NOT SET posting_enabled, books_of_record, opening_balances, or PITR flags.
-- DO NOT invent vendors, source IDs, categories, or liabilities for legacy rows.
--
-- FINAL GLOBAL ADVISORY LOCK ORDER (all competing workflows must follow):
--   1) JOB(s)           installer_labor_lock_job / advisory 174
--                       (0–2 job IDs via ap_lock_jobs_sorted, UUID lex order)
--   2) SOURCE           PO or installer_bills row FOR UPDATE
--   3) VENDOR INVOICE (176)  md5(supplier_id || chr(31) || norm)
--                       (0–2 identities via ap_lock_vendor_invoices_sorted, lex order)
--   4) AP BILL (175)    + bills FOR UPDATE
--   5) PAYMENTS         bill_payments FOR UPDATE
--   6) OUTBOX           via enqueue / installer_labor_record_vendor_event
--
-- Existing-bill RPCs: non-locking discovery → acquire (1)–(5) → re-read under lock.
-- When job/invoice identity can change, pass NEW job + NEW invoice into ap_lock_bill
-- so BOTH old and new JOB locks are taken BEFORE source/invoice/bill.
-- Identity/job drift between discovery and bill lock → AP_LOCK_RETRY (safe retry).
-- Direct expense vs AP: same invoice lock (176) serializes both economic paths.
-- Direct expense: job lock before vendor invoice (preserves hierarchy).
-- LEGACY: post_vendor_bill_safe (0166/0171) is DROPPED — activate_vendor_bill_safe
-- is the sole staff activation/posting entry for vendor AP.

-- ===========================================================================
-- 1) Schema — source identity, draft lifecycle, legacy flags
-- ===========================================================================

alter table public.bills
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists replacement_of_bill_id uuid references public.bills (id) on delete set null,
  add column if not exists replaced_by_bill_id uuid references public.bills (id) on delete set null,
  add column if not exists legacy_review_required boolean not null default false,
  add column if not exists vendor_invoice_norm text,
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by uuid references auth.users (id) on delete set null;

comment on column public.bills.source_type is
  'Canonical AP source: manual | purchase_order | installer_labor | legacy. Not a second ledger.';
comment on column public.bills.vendor_invoice_norm is
  'Normalized vendor invoice/reference for duplicate detection. Null when no invoice number.';

update public.bills
set source_type = case
      when installer_labor_bill_id is not null then 'installer_labor'
      when po_id is not null then 'purchase_order'
      else 'legacy'
    end,
    source_id = coalesce(installer_labor_bill_id, po_id, source_id)
where source_type is null;

update public.bills
set vendor_invoice_norm = nullif(lower(regexp_replace(btrim(coalesce(bill_number, '')), '\s+', '', 'g')), '')
where vendor_invoice_norm is null;

update public.bills
set legacy_review_required = true
where source_type = 'legacy'
  and (supplier_id is null or coalesce(accounting_category, 'review_required') = 'review_required');

alter table public.bills
  alter column source_type set default 'legacy';

alter table public.bills
  alter column source_type set not null;

alter table public.bills drop constraint if exists bills_ap_lifecycle_status_check;
alter table public.bills
  add constraint bills_ap_lifecycle_status_check
  check (ap_lifecycle in ('draft', 'open', 'void'));

alter table public.bills drop constraint if exists bills_source_type_check;
alter table public.bills
  add constraint bills_source_type_check
  check (source_type in ('manual', 'purchase_order', 'installer_labor', 'legacy'));

create table if not exists public.ap_action_idempotency (
  idempotency_key text not null,
  action text not null,
  context_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (idempotency_key)
);

comment on table public.ap_action_idempotency is
  'Context-aware AP idempotency: same key + same action + same hash returns stored result; mismatch is IDEMPOTENCY_CONFLICT.';

-- Unique indexes only when production has no colliding active rows.
do $$
begin
  if not exists (
    select 1 from public.bills
    where source_type = 'purchase_order'
      and po_id is not null
      and ap_lifecycle in ('draft', 'open')
    group by po_id
    having count(*) > 1
  ) then
    execute $idx$
      create unique index if not exists bills_active_po_source_uidx
        on public.bills (po_id)
        where source_type = 'purchase_order'
          and po_id is not null
          and ap_lifecycle in ('draft', 'open')
    $idx$;
  end if;

  if not exists (
    select 1 from public.bills
    where source_type in ('manual', 'purchase_order')
      and supplier_id is not null
      and vendor_invoice_norm is not null
      and ap_lifecycle in ('draft', 'open')
    group by supplier_id, vendor_invoice_norm
    having count(*) > 1
  ) then
    execute $idx$
      create unique index if not exists bills_active_vendor_invoice_uidx
        on public.bills (supplier_id, vendor_invoice_norm)
        where source_type in ('manual', 'purchase_order')
          and supplier_id is not null
          and vendor_invoice_norm is not null
          and ap_lifecycle in ('draft', 'open')
    $idx$;
  end if;

  if not exists (
    select 1 from public.bills
    where source_id is not null
      and source_type in ('purchase_order', 'installer_labor')
      and ap_lifecycle in ('draft', 'open')
    group by source_type, source_id
    having count(*) > 1
  ) then
    execute $idx$
      create unique index if not exists bills_active_source_id_uidx
        on public.bills (source_type, source_id)
        where source_id is not null
          and source_type in ('purchase_order', 'installer_labor')
          and ap_lifecycle in ('draft', 'open')
    $idx$;
  end if;
end $$;

-- ===========================================================================
-- 1b) Expenses provenance columns — MUST precede any function referencing them
-- ===========================================================================
-- Direct expense vs AP: never insert an expense row for a vendor bill.
-- Provenance columns make a *supplied* supplier+invoice identity deterministic.
-- Amount/date/vendor-name matching is not used as a blocker.
--
-- Ordering note: PostgreSQL validates SQL-language function bodies at CREATE
-- time. ap_direct_expense_identity_exists references these columns, so the
-- ALTER must run before that helper (and before record_direct_expense_safe).

alter table public.expenses
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null,
  add column if not exists vendor_invoice_norm text,
  add column if not exists economic_kind text;

comment on column public.expenses.supplier_id is
  'Canonical supplier for deterministic AP/direct-expense identity. Null on legacy free-text rows.';
comment on column public.expenses.vendor_invoice_norm is
  'Normalized vendor invoice/reference for deterministic duplicate checks with AP.';
comment on column public.expenses.economic_kind is
  'Expense economic class. Only direct_cash is allowed (AP uses bills + bill_payments).';

update public.expenses
set economic_kind = 'direct_cash'
where economic_kind is null;

alter table public.expenses
  alter column economic_kind set default 'direct_cash';

alter table public.expenses
  alter column economic_kind set not null;

alter table public.expenses drop constraint if exists expenses_economic_kind_check;
alter table public.expenses
  add constraint expenses_economic_kind_check
  check (economic_kind = 'direct_cash');

create or replace function public.expenses_block_ap_linked_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bill_id is not null then
    raise exception 'AP_EXPENSE_BOUNDARY: Do not insert expenses for AP bills. Settle with bill_payments.';
  end if;
  if new.economic_kind is distinct from 'direct_cash' then
    raise exception 'AP_EXPENSE_BOUNDARY: Only direct_cash expenses may be stored.';
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_block_ap_linked_insert on public.expenses;
create trigger expenses_block_ap_linked_insert
  before insert or update of bill_id, economic_kind on public.expenses
  for each row execute function public.expenses_block_ap_linked_insert();

-- ===========================================================================
-- 2) Canonical money / display helpers
-- ===========================================================================

create or replace function public.ap_text_is_nonfinite(p_text text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_text ~* '(nan|inf|infinity)';
$$;

create or replace function public.ap_parse_numeric_text(p_text text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := btrim(coalesce(p_text, ''));
begin
  if v = '' then
    raise exception 'AP_INVALID_AMOUNT: empty numeric.';
  end if;
  if public.ap_text_is_nonfinite(v) then
    raise exception 'AP_INVALID_AMOUNT: NaN/Infinity rejected.';
  end if;
  if v !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception 'AP_INVALID_AMOUNT: malformed numeric %.', v;
  end if;
  if v ~ '\.[0-9]{3,}$' then
    raise exception 'AP_INVALID_AMOUNT: more than two decimal places.';
  end if;
  return v::numeric;
end;
$$;

create or replace function public.ap_money_ok(p_amount numeric, p_allow_zero boolean default false)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_txt text;
begin
  if p_amount is null then
    raise exception 'AP_INVALID_AMOUNT: null.';
  end if;
  v_txt := btrim(p_amount::text);
  if public.ap_text_is_nonfinite(v_txt) then
    raise exception 'AP_INVALID_AMOUNT: NaN/Infinity rejected.';
  end if;
  if v_txt !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception 'AP_INVALID_AMOUNT: NaN/Infinity rejected.';
  end if;
  if p_amount < 0 then
    raise exception 'AP_INVALID_AMOUNT: negative amount rejected.';
  end if;
  if round(p_amount, 2) <> p_amount then
    raise exception 'AP_INVALID_AMOUNT: more than two decimal places.';
  end if;
  if p_amount = 0 and not p_allow_zero then
    raise exception 'AP_INVALID_AMOUNT: zero amount rejected.';
  end if;
  return round(p_amount, 2);
end;
$$;

-- Native float8 path (JSON/IEEE specials). Never cast Inf/NaN to numeric first.
create or replace function public.ap_money_ok(p_amount double precision, p_allow_zero boolean default false)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_amount is null then
    raise exception 'AP_INVALID_AMOUNT: null.';
  end if;
  if p_amount <> p_amount then
    raise exception 'AP_INVALID_AMOUNT: NaN rejected.';
  end if;
  if p_amount = 'Infinity'::double precision or p_amount = '-Infinity'::double precision then
    raise exception 'AP_INVALID_AMOUNT: Infinity rejected.';
  end if;
  return public.ap_money_ok(p_amount::numeric, p_allow_zero);
end;
$$;

create or replace function public.ap_json_numeric(p jsonb, p_key text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v jsonb := p -> p_key;
begin
  if v is null or v = 'null'::jsonb then
    return 0;
  end if;
  if jsonb_typeof(v) = 'string' then
    return public.ap_parse_numeric_text(v #>> '{}');
  end if;
  if jsonb_typeof(v) <> 'number' then
    raise exception 'AP_INVALID_AMOUNT: % is not numeric.', p_key;
  end if;
  if (v #>> '{}') ~* '(nan|inf)' then
    raise exception 'AP_INVALID_AMOUNT: NaN/Infinity rejected.';
  end if;
  return public.ap_parse_numeric_text(v #>> '{}');
end;
$$;

create or replace function public.ap_line_total(p_qty numeric, p_unit numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select round(
    public.ap_money_ok(coalesce(p_qty, 0), true)
    * public.ap_money_ok(coalesce(p_unit, 0), true),
    2
  );
$$;

create or replace function public.ap_bill_original_total(p_bill_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public.ap_line_total(quantity, unit_cost)), 0)::numeric
  from public.bill_items
  where bill_id = p_bill_id;
$$;

create or replace function public.ap_bill_paid_total(p_bill_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric
  from public.bill_payments
  where bill_id = p_bill_id
    and status = 'active';
$$;

create or replace function public.ap_bill_remaining(p_bill_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_life text;
  v_orig numeric;
  v_paid numeric;
begin
  select ap_lifecycle into v_life from public.bills where id = p_bill_id;
  if v_life is null then
    return 0;
  end if;
  if v_life in ('void', 'draft') then
    return 0;
  end if;
  v_orig := public.ap_bill_original_total(p_bill_id);
  v_paid := public.ap_bill_paid_total(p_bill_id);
  return greatest(0, round((v_orig - v_paid)::numeric, 2));
end;
$$;

create or replace function public.ap_bill_display_status(p_bill_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_life text;
  v_orig numeric;
  v_paid numeric;
begin
  select ap_lifecycle into v_life from public.bills where id = p_bill_id;
  if v_life is null then
    return 'open';
  end if;
  if v_life = 'void' then
    return 'void';
  end if;
  if v_life = 'draft' then
    return 'draft';
  end if;
  v_orig := public.ap_bill_original_total(p_bill_id);
  v_paid := public.ap_bill_paid_total(p_bill_id);
  if v_orig > 0 and v_paid + 0.005 >= v_orig then
    return 'paid';
  end if;
  if v_paid > 0.005 then
    return 'partial';
  end if;
  return 'open';
end;
$$;

create or replace function public.ap_normalize_invoice(p_raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_raw, '')), '\s+', '', 'g')), '');
$$;

create or replace function public.ap_context_hash(p_action text, p_payload jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select md5(coalesce(p_action, '') || '|' || coalesce(p_payload::text, ''));
$$;

create or replace function public.ap_lookup_action(p_key text, p_action text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.ap_action_idempotency%rowtype;
begin
  if p_key is null or btrim(p_key) = '' then
    return null;
  end if;
  select * into v from public.ap_action_idempotency where idempotency_key = p_key;
  if not found then
    return null;
  end if;
  if v.action is distinct from p_action or v.context_hash is distinct from p_hash then
    raise exception 'IDEMPOTENCY_CONFLICT: key already used for a different AP action or economic context.'
      using errcode = 'P0001';
  end if;
  return v.result;
end;
$$;

create or replace function public.ap_store_action(p_key text, p_action text, p_hash text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or btrim(p_key) = '' then
    return p_result;
  end if;
  insert into public.ap_action_idempotency (idempotency_key, action, context_hash, result)
  values (p_key, p_action, p_hash, p_result)
  on conflict (idempotency_key) do nothing;
  return coalesce(public.ap_lookup_action(p_key, p_action, p_hash), p_result);
end;
$$;

create or replace function public.ap_require_ok(p_result jsonb, p_step text)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if coalesce((p_result->>'ok')::boolean, false) is not true then
    raise exception 'AP_CORRECTION_ABORTED: % — %',
      p_step,
      coalesce(p_result->>'error', p_result->>'code', 'failed')
      using errcode = 'P0001';
  end if;
  return p_result;
end;
$$;

-- Canonical lock order (every AP workflow must follow this; never invert):
--   1) JOB (advisory 174)
--   2) SOURCE row (PO / installer_bills FOR UPDATE)
--   3) VENDOR INVOICE identity (advisory 176) — sorted when locking two identities
--   4) AP BILL (advisory 175 + FOR UPDATE)
--   5) BILL PAYMENTS (FOR UPDATE)
--   6) OUTBOX / accounting event state
-- Discovery SELECTs are non-locking. Re-read under lock before mutating.
-- GUC app.ap_mutation is not a grant. Authenticated DML on bills is revoked.

create or replace function public.ap_lock_vendor_invoice(p_supplier_id uuid, p_invoice_norm text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_supplier_id is null or p_invoice_norm is null or btrim(p_invoice_norm) = '' then
    return;
  end if;
  perform pg_advisory_xact_lock(
    176,
    ('x' || substr(md5(p_supplier_id::text || chr(31) || btrim(p_invoice_norm)), 1, 8))::bit(32)::int
  );
end;
$$;

-- Lock 0–2 job IDs in UUID text order before SOURCE / invoice / AP bill.
create or replace function public.ap_lock_jobs_sorted(
  p_job_a uuid,
  p_job_b uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_job_a is not null and p_job_b is not null and p_job_a = p_job_b then
    p_job_b := null;
  end if;
  if p_job_a is not null and p_job_b is not null then
    if p_job_a::text < p_job_b::text then
      perform public.installer_labor_lock_job(p_job_a);
      perform public.installer_labor_lock_job(p_job_b);
    else
      perform public.installer_labor_lock_job(p_job_b);
      perform public.installer_labor_lock_job(p_job_a);
    end if;
  elsif p_job_a is not null then
    perform public.installer_labor_lock_job(p_job_a);
  elsif p_job_b is not null then
    perform public.installer_labor_lock_job(p_job_b);
  end if;
end;
$$;

-- Lock 0–2 invoice identities in lexicographic key order to prevent swap deadlocks.
create or replace function public.ap_lock_vendor_invoices_sorted(
  p_supplier_a uuid,
  p_norm_a text,
  p_supplier_b uuid default null,
  p_norm_b text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a text;
  v_b text;
begin
  if p_supplier_a is not null and coalesce(nullif(btrim(p_norm_a), ''), '') <> '' then
    v_a := p_supplier_a::text || chr(31) || btrim(p_norm_a);
  end if;
  if p_supplier_b is not null and coalesce(nullif(btrim(p_norm_b), ''), '') <> '' then
    v_b := p_supplier_b::text || chr(31) || btrim(p_norm_b);
  end if;
  if v_a is not null and v_b is not null and v_a = v_b then
    v_b := null;
  end if;
  if v_a is not null and v_b is not null then
    if v_a < v_b then
      perform public.ap_lock_vendor_invoice(p_supplier_a, btrim(p_norm_a));
      perform public.ap_lock_vendor_invoice(p_supplier_b, btrim(p_norm_b));
    else
      perform public.ap_lock_vendor_invoice(p_supplier_b, btrim(p_norm_b));
      perform public.ap_lock_vendor_invoice(p_supplier_a, btrim(p_norm_a));
    end if;
  elsif v_a is not null then
    perform public.ap_lock_vendor_invoice(p_supplier_a, btrim(p_norm_a));
  elsif v_b is not null then
    perform public.ap_lock_vendor_invoice(p_supplier_b, btrim(p_norm_b));
  end if;
end;
$$;

-- True when a persisted direct_cash expense already owns this canonical invoice identity.
-- Expenses have no void lifecycle yet — any matching row is conservatively active history.
create or replace function public.ap_direct_expense_identity_exists(
  p_supplier_id uuid,
  p_invoice_norm text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.expenses e
    where e.supplier_id = p_supplier_id
      and e.vendor_invoice_norm = p_invoice_norm
      and e.economic_kind = 'direct_cash'
      and e.bill_id is null
  );
$$;

create or replace function public.ap_reject_if_direct_expense_identity(
  p_supplier_id uuid,
  p_invoice_norm text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_supplier_id is null or p_invoice_norm is null or btrim(p_invoice_norm) = '' then
    return;
  end if;
  if public.ap_direct_expense_identity_exists(p_supplier_id, btrim(p_invoice_norm)) then
    raise exception
      'DIRECT_EXPENSE_EXISTS: A direct cash expense already uses this vendor invoice. Do not create a second AP liability.'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Drop prior ap_lock_bill overloads so only the complete context-lock signature remains.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'ap_lock_bill'
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

-- Discover (no lock) → JOB(s sorted) → SOURCE → INVOICE(s sorted) → BILL → PAYMENTS.
-- p_extra_* locks additional NEW job / invoice identity (draft save / correction).
create or replace function public.ap_lock_bill(
  p_bill_id uuid,
  p_extra_supplier_id uuid default null,
  p_extra_invoice_norm text default null,
  p_extra_job_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid;
  v_src uuid;
  v_kind text;
  v_labor uuid;
  v_po uuid;
  v_sup uuid;
  v_norm text;
  v_live_sup uuid;
  v_live_norm text;
  v_live_job uuid;
begin
  -- PHASE 0: non-locking discovery of IDs needed for the hierarchy.
  select job_id, source_id, source_type, installer_labor_bill_id, po_id,
         supplier_id, vendor_invoice_norm
    into v_job, v_src, v_kind, v_labor, v_po, v_sup, v_norm
  from public.bills
  where id = p_bill_id;

  if not found then
    raise exception 'AP_BILL_NOT_FOUND: bill % missing.', p_bill_id;
  end if;

  -- (1) OLD + NEW jobs before SOURCE / invoice / bill.
  perform public.ap_lock_jobs_sorted(v_job, p_extra_job_id);

  -- (2) SOURCE (installer or PO). Draft/correct workflows do not change source.
  if v_kind = 'installer_labor' and coalesce(v_labor, v_src) is not null then
    perform 1 from public.installer_bills where id = coalesce(v_labor, v_src) for update;
  elsif v_kind = 'purchase_order' and coalesce(v_src, v_po) is not null then
    perform 1 from public.purchase_orders
      where id = coalesce(v_src, v_po)
      for update;
  end if;

  -- (3) OLD + NEW invoice identities.
  perform public.ap_lock_vendor_invoices_sorted(
    v_sup, v_norm, p_extra_supplier_id, p_extra_invoice_norm
  );

  -- (4)–(5) AP bill + payments.
  perform pg_advisory_xact_lock(
    175,
    ('x' || substr(md5(p_bill_id::text), 1, 8))::bit(32)::int
  );
  perform 1 from public.bills where id = p_bill_id for update;
  perform 1 from public.bill_payments where bill_id = p_bill_id for update;

  -- Do not mutate from stale discovery: current identity/job must still match.
  select job_id, supplier_id, vendor_invoice_norm
    into v_live_job, v_live_sup, v_live_norm
  from public.bills
  where id = p_bill_id;

  if v_live_sup is distinct from v_sup
     or v_live_norm is distinct from v_norm
     or v_live_job is distinct from v_job then
    raise exception
      'AP_LOCK_RETRY: bill identity changed during lock acquisition; retry the operation.'
      using errcode = 'P0001';
  end if;

  return v_live_job;
end;
$$;

create or replace function public.ap_record_vendor_event(
  p_ap_bill_id uuid,
  p_event_kind text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reuse 0174 pending-safe writer. Do not replace enqueue_accounting_outbox_safe.
  perform public.installer_labor_record_vendor_event(p_ap_bill_id, p_event_kind, p_payload);
end;
$$;

create or replace function public.ap_validate_lines(p_lines jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  el jsonb;
  v_desc text;
  v_qty numeric;
  v_cost numeric;
  v_out jsonb := '[]'::jsonb;
  i int := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'AP_LINES_REQUIRED: at least one line item is required.';
  end if;
  for el in select value from jsonb_array_elements(p_lines)
  loop
    v_desc := btrim(coalesce(el->>'description', ''));
    if v_desc = '' then
      raise exception 'AP_LINES_INVALID: description required.';
    end if;
    v_qty := public.ap_json_numeric(el, 'quantity');
    v_cost := public.ap_json_numeric(el, 'unit_cost');
    perform public.ap_line_total(v_qty, v_cost);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'position', i,
      'description', v_desc,
      'quantity', v_qty,
      'unit', coalesce(nullif(btrim(el->>'unit'), ''), 'ea'),
      'unit_cost', v_cost
    ));
    i := i + 1;
  end loop;
  return v_out;
end;
$$;

create or replace function public.ap_assert_category(p_cat text, p_require_mapped boolean)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_cat is null or p_cat not in (
    'material_purchase', 'installer_labor', 'freight',
    'operating_expense', 'inventory_asset', 'other_mapped', 'review_required'
  ) then
    raise exception 'AP_CATEGORY_INVALID: unknown accounting category.';
  end if;
  if p_require_mapped and p_cat = 'review_required' then
    raise exception 'AP_CATEGORY_INVALID: review_required is not allowed on activation.';
  end if;
  return p_cat;
end;
$$;

create or replace function public.ap_assert_supplier(p_supplier_id uuid, p_require_active boolean)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_name text;
  v_active boolean;
begin
  if p_supplier_id is null then
    raise exception 'AP_SUPPLIER_REQUIRED: canonical supplier_id is required.';
  end if;
  select name, coalesce(active, true) into v_name, v_active
  from public.suppliers
  where id = p_supplier_id;
  if v_name is null then
    raise exception 'AP_SUPPLIER_INVALID: supplier not found.';
  end if;
  if p_require_active and v_active is not true then
    raise exception 'AP_SUPPLIER_INACTIVE: cannot activate a bill for an inactive supplier.';
  end if;
  return v_name;
end;
$$;

-- ===========================================================================
-- 3) Immutability — draft editable via RPC GUC; open economic fields locked
-- ===========================================================================

create or replace function public.bills_enforce_ap_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guc text := current_setting('app.ap_mutation', true);
  v_economic boolean := false;
begin
  if tg_op = 'DELETE' then
    if old.ap_lifecycle in ('open', 'void') then
      raise exception 'AP_IMMUTABLE: Active or void vendor bills cannot be deleted. Void unpaid bills with void_vendor_bill_safe.';
    end if;
    if old.installer_labor_bill_id is not null then
      raise exception 'AP_IMMUTABLE: Installer-linked AP cannot be deleted from bills UI.';
    end if;
    if v_guc is distinct from 'true' then
      raise exception 'AP_IMMUTABLE: Draft bills must be cancelled through save/void RPCs.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.installer_labor_bill_id is not null then
      new.source_type := 'installer_labor';
      new.source_id := new.installer_labor_bill_id;
      -- 0174 approve inserts lines immediately after this row with mutation GUC off.
      perform set_config('app.ap_mutation', 'true', true);
    elsif new.po_id is not null and coalesce(new.source_type, 'legacy') in ('legacy', 'purchase_order') then
      new.source_type := 'purchase_order';
      new.source_id := coalesce(new.source_id, new.po_id);
    end if;
    new.vendor_invoice_norm := public.ap_normalize_invoice(new.bill_number);
    return new;
  end if;

  -- UPDATE
  if old.installer_labor_bill_id is not null
     and (
       new.supplier_id is distinct from old.supplier_id
       or new.source_type is distinct from old.source_type
       or new.source_id is distinct from old.source_id
       or new.po_id is distinct from old.po_id
       or new.job_id is distinct from old.job_id
       or new.installer_labor_bill_id is distinct from old.installer_labor_bill_id
     )
     and v_guc is distinct from 'true' then
    raise exception 'AP_IMMUTABLE: Installer-linked AP cannot be reassigned from bills UI. Correct through installer labor.';
  end if;

  if old.ap_lifecycle = 'void' and v_guc is distinct from 'true' then
    raise exception 'AP_IMMUTABLE: Void bills cannot be edited.';
  end if;

  v_economic :=
       new.supplier_id is distinct from old.supplier_id
    or new.supplier is distinct from old.supplier
    or new.source_type is distinct from old.source_type
    or new.source_id is distinct from old.source_id
    or new.po_id is distinct from old.po_id
    or new.job_id is distinct from old.job_id
    or new.bill_number is distinct from old.bill_number
    or new.bill_date is distinct from old.bill_date
    or new.accounting_category is distinct from old.accounting_category
    or new.installer_labor_bill_id is distinct from old.installer_labor_bill_id;

  if old.ap_lifecycle = 'open' and v_economic and v_guc is distinct from 'true' then
    raise exception 'AP_IMMUTABLE: Approved vendor bills cannot change economic fields. Void unpaid and replace.';
  end if;

  new.vendor_invoice_norm := public.ap_normalize_invoice(new.bill_number);
  return new;
end;
$$;

drop trigger if exists bills_enforce_ap_immutability on public.bills;
create trigger bills_enforce_ap_immutability
  before insert or update or delete on public.bills
  for each row execute function public.bills_enforce_ap_immutability();

create or replace function public.bill_items_enforce_ap_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_life text;
  v_guc text := current_setting('app.ap_mutation', true);
  v_bill uuid := coalesce(new.bill_id, old.bill_id);
begin
  select ap_lifecycle into v_life from public.bills where id = v_bill;
  if v_life in ('open', 'void')
     and v_guc is distinct from 'true'
     and current_setting('app.installer_labor_mutation', true) is distinct from 'true' then
    raise exception 'AP_IMMUTABLE: Line items on active/void bills cannot be inserted, updated, or deleted.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists bill_items_enforce_ap_immutability on public.bill_items;
create trigger bill_items_enforce_ap_immutability
  before insert or update or delete on public.bill_items
  for each row execute function public.bill_items_enforce_ap_immutability();

create or replace function public.bill_payments_enforce_ap_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guc text := current_setting('app.ap_mutation', true);
begin
  if tg_op = 'DELETE' then
    raise exception 'AP_IMMUTABLE: Bill payments cannot be deleted. Use void_bill_payment_safe.';
  end if;
  if tg_op = 'UPDATE' and v_guc is distinct from 'true' then
    if new.amount is distinct from old.amount
       or new.bill_id is distinct from old.bill_id
       or new.date is distinct from old.date then
      raise exception 'AP_IMMUTABLE: Bill payments cannot be rewritten. Void and re-record.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bill_payments_enforce_ap_immutability on public.bill_payments;
create trigger bill_payments_enforce_ap_immutability
  before update or delete on public.bill_payments
  for each row execute function public.bill_payments_enforce_ap_immutability();

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
  if v_status = 'draft' then
    raise exception 'AP_DRAFT: Cannot record payments on a draft vendor bill. Activate first.';
  end if;
  return new;
end;
$$;

-- 0174 already attached this trigger; recreate so 0175's draft+void body is guaranteed wired.
drop trigger if exists bill_payments_block_void_ap on public.bill_payments;
create trigger bill_payments_block_void_ap
  before insert or update of bill_id, amount, status on public.bill_payments
  for each row execute function public.bill_payments_block_void_ap();

-- ===========================================================================
-- 4) Staff RPCs — create / draft save / activate / void / correct
-- ===========================================================================

create or replace function public.create_vendor_bill_safe(
  p_supplier_id uuid,
  p_lines jsonb,
  p_bill_date date default current_date,
  p_due_date date default null,
  p_bill_number text default null,
  p_terms text default 'net_30',
  p_memo text default null,
  p_job_id uuid default null,
  p_po_id uuid default null,
  p_accounting_category text default 'review_required',
  p_source_type text default 'manual',
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
  v_lines jsonb;
  v_name text;
  v_src text;
  v_id uuid;
  v_norm text;
  v_cat text;
  v_result jsonb;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'create vendor bills');
  v_actor := public.accounting_actor_id(p_created_by);
  v_src := coalesce(nullif(p_source_type, ''), 'manual');
  if v_src not in ('manual', 'purchase_order') then
    raise exception 'AP_SOURCE_INVALID: manual RPC cannot create installer_labor or inventory AP.';
  end if;
  if v_src = 'purchase_order' and p_po_id is null then
    raise exception 'AP_SOURCE_INVALID: purchase_order source requires po_id.';
  end if;
  v_lines := public.ap_validate_lines(p_lines);
  v_cat := public.ap_assert_category(coalesce(p_accounting_category, 'review_required'), false);
  v_name := public.ap_assert_supplier(p_supplier_id, false);
  v_norm := public.ap_normalize_invoice(p_bill_number);

  v_hash := public.ap_context_hash('create_vendor_bill', jsonb_build_object(
    'supplier_id', p_supplier_id,
    'po_id', p_po_id,
    'bill_number', v_norm,
    'bill_date', coalesce(p_bill_date, current_date),
    'due_date', p_due_date,
    'terms', coalesce(nullif(btrim(p_terms), ''), 'net_30'),
    'memo', nullif(btrim(coalesce(p_memo, '')), ''),
    'lines', v_lines,
    'job_id', p_job_id,
    'category', v_cat,
    'source_type', v_src
  ));
  v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'create_vendor_bill', v_hash);
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  -- JOB → SOURCE → INVOICE (create has no prior bill lock).
  perform public.ap_lock_jobs_sorted(p_job_id, null);

  if v_src = 'purchase_order' then
    perform 1 from public.purchase_orders where id = p_po_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'Purchase order not found.');
    end if;
    -- Row lock serializes PO→AP even if bills_active_po_source_uidx was skipped.
    if exists (
      select 1 from public.bills
      where po_id = p_po_id
        and source_type = 'purchase_order'
        and ap_lifecycle in ('draft', 'open')
    ) then
      return jsonb_build_object('ok', false, 'error', 'This purchase order already has an active AP bill.', 'code', 'DUPLICATE_PO_AP');
    end if;
  end if;

  perform public.ap_lock_vendor_invoice(p_supplier_id, v_norm);
  v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'create_vendor_bill', v_hash);
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  begin
    perform public.ap_reject_if_direct_expense_identity(p_supplier_id, v_norm);
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'error', sqlerrm,
      'code', 'DIRECT_EXPENSE_EXISTS'
    );
  end;

  if v_norm is not null and exists (
    select 1 from public.bills
    where supplier_id = p_supplier_id
      and vendor_invoice_norm = v_norm
      and ap_lifecycle in ('draft', 'open')
      and source_type in ('manual', 'purchase_order')
  ) then
    return jsonb_build_object('ok', false, 'error', 'Duplicate vendor invoice number for this supplier.', 'code', 'DUPLICATE_VENDOR_INVOICE');
  end if;

  perform set_config('app.ap_mutation', 'true', true);
  insert into public.bills (
    supplier_id, supplier, bill_number, bill_date, due_date, terms, memo,
    job_id, po_id, accounting_category, source_type, source_id,
    ap_lifecycle, created_by, vendor_invoice_norm
  ) values (
    p_supplier_id, v_name, nullif(btrim(p_bill_number), ''),
    coalesce(p_bill_date, current_date), p_due_date, coalesce(nullif(p_terms, ''), 'net_30'),
    nullif(p_memo, ''), p_job_id, p_po_id, v_cat, v_src,
    case when v_src = 'purchase_order' then p_po_id else null end,
    'draft', v_actor, v_norm
  )
  returning id into v_id;

  insert into public.bill_items (bill_id, position, description, quantity, unit, unit_cost)
  select v_id,
         (el->>'position')::int,
         el->>'description',
         (el->>'quantity')::numeric,
         el->>'unit',
         (el->>'unit_cost')::numeric
  from jsonb_array_elements(v_lines) el;
  perform set_config('app.ap_mutation', 'false', true);

  perform public.accounting_audit_from_definer_safe(
    'vendor_bill_created', 'vendor_bill', v_id, coalesce(p_bill_date, current_date), null,
    jsonb_build_object('billId', v_id, 'sourceType', v_src, 'supplierId', p_supplier_id),
    v_actor, 'audit:vendor_bill_created:' || v_id::text
  );

  v_result := jsonb_build_object('ok', true, 'bill_id', v_id, 'ap_lifecycle', 'draft', 'duplicate', false);
  return public.ap_store_action(nullif(p_idempotency_key, ''), 'create_vendor_bill', v_hash, v_result);
end;
$$;

create or replace function public.save_vendor_bill_draft_safe(
  p_bill_id uuid,
  p_supplier_id uuid,
  p_lines jsonb,
  p_bill_date date default null,
  p_due_date date default null,
  p_bill_number text default null,
  p_terms text default null,
  p_memo text default null,
  p_job_id uuid default null,
  p_accounting_category text default null,
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
  v_bill public.bills%rowtype;
  v_lines jsonb;
  v_name text;
  v_cat text;
  v_norm text;
  v_hash text;
  v_dup jsonb;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'save vendor bill drafts');
  v_actor := public.accounting_actor_id(p_created_by);

  -- PHASE A: parse/validate complete payload before any mutation.
  v_lines := public.ap_validate_lines(p_lines);
  v_name := public.ap_assert_supplier(p_supplier_id, false);
  v_cat := public.ap_assert_category(coalesce(p_accounting_category, 'review_required'), false);
  v_norm := public.ap_normalize_invoice(p_bill_number);
  v_hash := public.ap_context_hash('save_vendor_bill_draft', jsonb_build_object(
    'bill_id', p_bill_id,
    'supplier_id', p_supplier_id,
    'lines', v_lines,
    'bill_date', p_bill_date,
    'due_date', p_due_date,
    'bill_number', v_norm,
    'terms', nullif(btrim(coalesce(p_terms, '')), ''),
    'memo', nullif(btrim(coalesce(p_memo, '')), ''),
    'category', v_cat,
    'job_id', p_job_id
  ));
  v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'save_vendor_bill_draft', v_hash);
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  -- OLD+NEW jobs and OLD+NEW invoices lock in sorted order BEFORE the bill row.
  perform public.ap_lock_bill(p_bill_id, p_supplier_id, v_norm, p_job_id);
  select * into v_bill from public.bills where id = p_bill_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Bill not found.');
  end if;
  if v_bill.ap_lifecycle is distinct from 'draft' then
    return jsonb_build_object('ok', false, 'error', 'Only draft bills can be edited.', 'code', 'NOT_DRAFT');
  end if;
  if v_bill.installer_labor_bill_id is not null or v_bill.source_type = 'installer_labor' then
    return jsonb_build_object('ok', false, 'error', 'Installer-linked AP cannot be edited here.', 'code', 'INSTALLER_LINKED');
  end if;
  -- Identity may have changed under concurrent edit — re-verify after lock.
  if v_bill.supplier_id is distinct from p_supplier_id
     and v_bill.vendor_invoice_norm is distinct from v_norm then
    -- still OK: we locked both identities; continue with validated payload
    null;
  end if;
  v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'save_vendor_bill_draft', v_hash);
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;
  begin
    perform public.ap_reject_if_direct_expense_identity(p_supplier_id, v_norm);
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'error', sqlerrm,
      'code', 'DIRECT_EXPENSE_EXISTS'
    );
  end;
  if v_norm is not null and exists (
    select 1 from public.bills
    where supplier_id = p_supplier_id
      and vendor_invoice_norm = v_norm
      and ap_lifecycle in ('draft', 'open')
      and id <> p_bill_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'Duplicate vendor invoice number for this supplier.', 'code', 'DUPLICATE_VENDOR_INVOICE');
  end if;

  -- PHASE B: mutate only after validation succeeded.
  perform set_config('app.ap_mutation', 'true', true);
  update public.bills
  set supplier_id = p_supplier_id,
      supplier = v_name,
      bill_number = nullif(btrim(p_bill_number), ''),
      bill_date = coalesce(p_bill_date, bill_date),
      due_date = coalesce(p_due_date, due_date),
      terms = coalesce(nullif(p_terms, ''), terms),
      memo = coalesce(p_memo, memo),
      job_id = p_job_id,
      accounting_category = v_cat,
      vendor_invoice_norm = v_norm
  where id = p_bill_id;

  delete from public.bill_items where bill_id = p_bill_id;
  insert into public.bill_items (bill_id, position, description, quantity, unit, unit_cost)
  select p_bill_id,
         (el->>'position')::int,
         el->>'description',
         (el->>'quantity')::numeric,
         el->>'unit',
         (el->>'unit_cost')::numeric
  from jsonb_array_elements(v_lines) el;
  perform set_config('app.ap_mutation', 'false', true);

  return public.ap_store_action(
    nullif(p_idempotency_key, ''),
    'save_vendor_bill_draft',
    v_hash,
    jsonb_build_object('ok', true, 'bill_id', p_bill_id, 'duplicate', false)
  );
end;
$$;

create or replace function public.activate_vendor_bill_safe(
  p_bill_id uuid,
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
  v_bill public.bills%rowtype;
  v_hash text;
  v_dup jsonb;
  v_total numeric;
  v_payload jsonb;
  v_name text;
  v_result jsonb;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'activate vendor bills');
  v_actor := public.accounting_actor_id(p_created_by);
  v_hash := public.ap_context_hash('activate_vendor_bill', jsonb_build_object('bill_id', p_bill_id));
  v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'activate_vendor_bill', v_hash);
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  perform public.ap_lock_bill(p_bill_id);
  select * into v_bill from public.bills where id = p_bill_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Bill not found.');
  end if;
  if v_bill.ap_lifecycle = 'open' then
    v_result := jsonb_build_object('ok', true, 'bill_id', p_bill_id, 'duplicate', true, 'ap_lifecycle', 'open');
    return public.ap_store_action(nullif(p_idempotency_key, ''), 'activate_vendor_bill', v_hash, v_result);
  end if;
  if v_bill.ap_lifecycle = 'void' then
    return jsonb_build_object('ok', false, 'error', 'Void bills cannot be activated.');
  end if;
  if v_bill.source_type = 'installer_labor' then
    return jsonb_build_object('ok', false, 'error', 'Installer-linked AP is activated through installer labor approval.', 'code', 'INSTALLER_LINKED');
  end if;

  -- Invoice identity already locked inside ap_lock_bill (before bill row).
  v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'activate_vendor_bill', v_hash);
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  begin
    perform public.ap_reject_if_direct_expense_identity(v_bill.supplier_id, v_bill.vendor_invoice_norm);
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'error', sqlerrm,
      'code', 'DIRECT_EXPENSE_EXISTS'
    );
  end;

  v_name := public.ap_assert_supplier(v_bill.supplier_id, true);
  perform public.ap_assert_category(coalesce(v_bill.accounting_category, 'review_required'), true);
  v_total := public.ap_bill_original_total(p_bill_id);
  if v_total <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Cannot activate a zero-total bill.');
  end if;
  if v_bill.vendor_invoice_norm is not null and exists (
    select 1 from public.bills
    where supplier_id = v_bill.supplier_id
      and vendor_invoice_norm = v_bill.vendor_invoice_norm
      and ap_lifecycle = 'open'
      and id <> p_bill_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'Duplicate vendor invoice number for this supplier.', 'code', 'DUPLICATE_VENDOR_INVOICE');
  end if;
  if v_bill.source_type = 'purchase_order' and v_bill.po_id is not null and exists (
    select 1 from public.bills
    where po_id = v_bill.po_id
      and ap_lifecycle = 'open'
      and id <> p_bill_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'This purchase order already has an active AP bill.', 'code', 'DUPLICATE_PO_AP');
  end if;

  perform set_config('app.ap_mutation', 'true', true);
  update public.bills
  set ap_lifecycle = 'open',
      supplier = v_name,
      activated_at = now(),
      activated_by = v_actor
  where id = p_bill_id;
  perform set_config('app.ap_mutation', 'false', true);

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'vendor_bill',
    'economicEventDate', v_bill.bill_date::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'vendor_bill',
    'sourceId', p_bill_id,
    'amount', v_total,
    'supplierId', v_bill.supplier_id,
    'category', v_bill.accounting_category
  );
  perform public.ap_record_vendor_event(p_bill_id, 'vendor_bill', v_payload);

  perform public.accounting_audit_from_definer_safe(
    'vendor_bill_activated', 'vendor_bill', p_bill_id, v_bill.bill_date, null,
    jsonb_build_object('billId', p_bill_id, 'amount', v_total),
    v_actor, 'audit:vendor_bill_activated:' || p_bill_id::text
  );

  v_result := jsonb_build_object('ok', true, 'bill_id', p_bill_id, 'ap_lifecycle', 'open', 'duplicate', false);
  return public.ap_store_action(nullif(p_idempotency_key, ''), 'activate_vendor_bill', v_hash, v_result);
end;
$$;

create or replace function public.void_vendor_bill_safe(
  p_bill_id uuid,
  p_reason text,
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
  v_bill public.bills%rowtype;
  v_paid numeric;
  v_hash text;
  v_dup jsonb;
  v_payload jsonb;
  v_result jsonb;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'void vendor bills');
  v_actor := public.accounting_actor_id(p_created_by);
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'error', 'Void reason is required.');
  end if;
  v_hash := public.ap_context_hash('void_vendor_bill', jsonb_build_object('bill_id', p_bill_id, 'reason', btrim(p_reason)));
  v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'void_vendor_bill', v_hash);
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  perform public.ap_lock_bill(p_bill_id);
  select * into v_bill from public.bills where id = p_bill_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Bill not found.');
  end if;
  if v_bill.ap_lifecycle = 'void' then
    v_result := jsonb_build_object('ok', true, 'bill_id', p_bill_id, 'duplicate', true, 'ap_lifecycle', 'void');
    return public.ap_store_action(nullif(p_idempotency_key, ''), 'void_vendor_bill', v_hash, v_result);
  end if;
  if v_bill.source_type = 'installer_labor' or v_bill.installer_labor_bill_id is not null then
    return jsonb_build_object('ok', false, 'error', 'Installer-linked AP must be reversed through installer labor.', 'code', 'INSTALLER_LINKED');
  end if;
  v_paid := public.ap_bill_paid_total(p_bill_id);
  if v_paid > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Paid or partially paid bills cannot be voided. Reverse payments first.',
      'code', 'AP_SETTLED'
    );
  end if;

  perform set_config('app.ap_mutation', 'true', true);
  update public.bills
  set ap_lifecycle = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = btrim(p_reason)
  where id = p_bill_id;
  perform set_config('app.ap_mutation', 'false', true);

  if v_bill.ap_lifecycle = 'open' then
    v_payload := jsonb_build_object(
      'schemaVersion', 1,
      'eventKind', 'vendor_bill_void',
      'economicEventDate', v_bill.bill_date::text,
      'sourceType', 'vendor_bill',
      'sourceId', p_bill_id,
      'reason', btrim(p_reason)
    );
    perform public.ap_record_vendor_event(p_bill_id, 'vendor_bill_void', v_payload);
  end if;

  perform public.accounting_audit_from_definer_safe(
    'vendor_bill_voided', 'vendor_bill', p_bill_id, v_bill.bill_date, btrim(p_reason),
    jsonb_build_object('billId', p_bill_id),
    v_actor, 'audit:vendor_bill_voided:' || p_bill_id::text
  );

  v_result := jsonb_build_object('ok', true, 'bill_id', p_bill_id, 'ap_lifecycle', 'void', 'duplicate', false);
  return public.ap_store_action(nullif(p_idempotency_key, ''), 'void_vendor_bill', v_hash, v_result);
end;
$$;

create or replace function public.correct_vendor_bill_safe(
  p_bill_id uuid,
  p_reason text,
  p_supplier_id uuid,
  p_lines jsonb,
  p_bill_date date default null,
  p_due_date date default null,
  p_bill_number text default null,
  p_terms text default null,
  p_memo text default null,
  p_job_id uuid default null,
  p_accounting_category text default null,
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
  v_bill public.bills%rowtype;
  v_void jsonb;
  v_create jsonb;
  v_act jsonb;
  v_hash text;
  v_dup jsonb;
  v_new uuid;
  v_lines jsonb;
  v_cat text;
  v_norm text;
  v_src_type text;
  v_po_id uuid;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'correct vendor bills');
  v_actor := public.accounting_actor_id(p_created_by);
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'error', 'Correction reason is required.');
  end if;
  -- Preflight complete payload (including lines) before any mutation.
  v_lines := public.ap_validate_lines(p_lines);
  perform public.ap_assert_supplier(p_supplier_id, true);
  v_cat := public.ap_assert_category(coalesce(p_accounting_category, 'operating_expense'), true);
  v_norm := public.ap_normalize_invoice(p_bill_number);

  -- Non-locking discovery for hash completeness (PO/source are not caller-editable).
  select source_type, po_id into v_src_type, v_po_id
  from public.bills where id = p_bill_id;

  v_hash := public.ap_context_hash('correct_vendor_bill', jsonb_build_object(
    'bill_id', p_bill_id,
    'reason', btrim(p_reason),
    'supplier_id', p_supplier_id,
    'lines', v_lines,
    'bill_date', p_bill_date,
    'due_date', p_due_date,
    'bill_number', v_norm,
    'terms', nullif(btrim(coalesce(p_terms, '')), ''),
    'memo', nullif(btrim(coalesce(p_memo, '')), ''),
    'job_id', p_job_id,
    'category', v_cat,
    'source_type', v_src_type,
    'po_id', v_po_id
  ));
  v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'correct_vendor_bill', v_hash);
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  -- Lock original + replacement jobs and invoice identities before nested void/create.
  perform public.ap_lock_bill(
    p_bill_id,
    p_supplier_id,
    v_norm,
    p_job_id
  );
  select * into v_bill from public.bills where id = p_bill_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Bill not found.');
  end if;
  if v_bill.source_type = 'installer_labor' or v_bill.installer_labor_bill_id is not null then
    return jsonb_build_object('ok', false, 'error', 'Correct installer AP through installer labor.', 'code', 'INSTALLER_LINKED');
  end if;
  if public.ap_bill_paid_total(p_bill_id) > 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Paid or partially paid bills cannot be corrected. Reverse payments first.',
      'code', 'AP_SETTLED'
    );
  end if;
  begin
    perform public.ap_reject_if_direct_expense_identity(p_supplier_id, v_norm);
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'error', sqlerrm,
      'code', 'DIRECT_EXPENSE_EXISTS'
    );
  end;

  v_void := public.ap_require_ok(
    public.void_vendor_bill_safe(p_bill_id, p_reason, null, v_actor),
    'void original'
  );
  -- Nested create reacquires job/source/invoice locks already held (xact-reentrant).
  v_create := public.ap_require_ok(
    public.create_vendor_bill_safe(
      p_supplier_id, v_lines, coalesce(p_bill_date, v_bill.bill_date), p_due_date,
      p_bill_number, coalesce(p_terms, v_bill.terms), p_memo, p_job_id, v_bill.po_id,
      coalesce(p_accounting_category, v_bill.accounting_category),
      v_bill.source_type, null, v_actor
    ),
    'create replacement draft'
  );
  v_new := (v_create->>'bill_id')::uuid;
  v_act := public.ap_require_ok(
    public.activate_vendor_bill_safe(v_new, null, v_actor),
    'activate replacement'
  );

  perform set_config('app.ap_mutation', 'true', true);
  update public.bills set replaced_by_bill_id = v_new where id = p_bill_id;
  update public.bills set replacement_of_bill_id = p_bill_id where id = v_new;
  perform set_config('app.ap_mutation', 'false', true);

  perform public.accounting_audit_from_definer_safe(
    'vendor_bill_corrected', 'vendor_bill', v_new, coalesce(p_bill_date, v_bill.bill_date), btrim(p_reason),
    jsonb_build_object('originalBillId', p_bill_id, 'replacementBillId', v_new),
    v_actor, 'audit:vendor_bill_corrected:' || p_bill_id::text
  );

  return public.ap_store_action(
    nullif(p_idempotency_key, ''),
    'correct_vendor_bill',
    v_hash,
    jsonb_build_object(
      'ok', true,
      'original_bill_id', p_bill_id,
      'bill_id', v_new,
      'void', v_void,
      'activate', v_act,
      'duplicate', false
    )
  );
end;
$$;

-- ===========================================================================
-- 5) Payment + reversal — lock remaining, reject draft/void/overpay, no expense
-- ===========================================================================

create or replace function public.record_bill_payment_safe(
  p_bill_id uuid,
  p_amount numeric,
  p_date date,
  p_method text default null,
  p_note text default null,
  p_created_by uuid default null,
  p_idempotency_key text default null,
  p_cash_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_bill public.bills%rowtype;
  v_remaining numeric := 0;
  v_pay_id uuid;
  v_pay_row public.bill_payments%rowtype;
  v_ap uuid;
  v_cash uuid;
  v_econ date;
  v_frozen jsonb;
  v_payload jsonb;
  v_review boolean := false;
  v_amt numeric;
  v_hash text;
  v_dup jsonb;
  v_result jsonb;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'record bill payments');
  v_actor := public.accounting_actor_id(p_created_by);
  begin
    v_amt := public.ap_money_ok(p_amount, false);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  v_econ := public.accounting_resolve_business_date(p_date, 'ap');

  v_hash := public.ap_context_hash('record_bill_payment', jsonb_build_object(
    'bill_id', p_bill_id,
    'amount', v_amt,
    'date', p_date,
    'economic_date', v_econ,
    'method', nullif(btrim(coalesce(p_method, '')), ''),
    'note', nullif(btrim(coalesce(p_note, '')), ''),
    'cash_account_id', p_cash_account_id
  ));
  begin
    v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'record_bill_payment', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  -- Legacy bill_payments.idempotency_key without ap_action row: accept only when
  -- stored economic fields prove the same context (never bill_id-only shortcut).
  if p_idempotency_key is not null then
    select * into v_pay_row
    from public.bill_payments
    where idempotency_key = p_idempotency_key
    limit 1;
    if found then
      if v_pay_row.bill_id is not distinct from p_bill_id
         and round(v_pay_row.amount, 2) = v_amt
         and v_pay_row."date" is not distinct from v_econ
         and coalesce(v_pay_row.method, '') is not distinct from coalesce(nullif(btrim(coalesce(p_method, '')), ''), '')
         and coalesce(v_pay_row.note, '') is not distinct from coalesce(nullif(btrim(coalesce(p_note, '')), ''), '')
         and p_cash_account_id is null then
        v_result := jsonb_build_object(
          'ok', true, 'bill_payment_id', v_pay_row.id, 'duplicate', true
        );
        return public.ap_store_action(
          nullif(p_idempotency_key, ''), 'record_bill_payment', v_hash, v_result
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different bill payment.',
        'code', 'IDEMPOTENCY_CONFLICT'
      );
    end if;
  end if;

  perform public.ap_lock_bill(p_bill_id);
  select * into v_bill from public.bills where id = p_bill_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Bill not found.');
  end if;
  if v_bill.ap_lifecycle = 'void' then
    return jsonb_build_object('ok', false, 'error', 'Cannot pay a void vendor bill.', 'code', 'AP_VOID');
  end if;
  if v_bill.ap_lifecycle = 'draft' then
    return jsonb_build_object('ok', false, 'error', 'Cannot pay a draft vendor bill.', 'code', 'AP_DRAFT');
  end if;

  -- Re-check context idempotency after locks.
  begin
    v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'record_bill_payment', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  v_remaining := public.ap_bill_remaining(p_bill_id);
  if v_amt > v_remaining + 0.005 then
    return jsonb_build_object(
      'ok', false,
      'error', format('Bill payment exceeds remaining balance of $%s.', to_char(v_remaining, 'FM999999990.00')),
      'remaining', v_remaining,
      'code', 'OVERPAYMENT'
    );
  end if;

  perform set_config('app.ap_mutation', 'true', true);
  begin
    insert into public.bill_payments (
      bill_id, "date", amount, method, note, created_by, status, idempotency_key
    ) values (
      p_bill_id, v_econ, v_amt, nullif(p_method, ''), nullif(p_note, ''),
      v_actor, 'active', nullif(p_idempotency_key, '')
    )
    returning id into v_pay_id;
  exception
    when unique_violation then
      perform set_config('app.ap_mutation', 'false', true);
      begin
        v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'record_bill_payment', v_hash);
        if v_dup is not null then
          return v_dup || jsonb_build_object('duplicate', true);
        end if;
      exception when others then
        return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
      end;
      select * into v_pay_row
      from public.bill_payments
      where idempotency_key = p_idempotency_key
      limit 1;
      if found
         and v_pay_row.bill_id is not distinct from p_bill_id
         and round(v_pay_row.amount, 2) = v_amt
         and v_pay_row."date" is not distinct from v_econ
         and coalesce(v_pay_row.method, '') is not distinct from coalesce(nullif(btrim(coalesce(p_method, '')), ''), '')
         and coalesce(v_pay_row.note, '') is not distinct from coalesce(nullif(btrim(coalesce(p_note, '')), ''), '')
         and p_cash_account_id is null then
        v_result := jsonb_build_object(
          'ok', true, 'bill_payment_id', v_pay_row.id, 'duplicate', true
        );
        return public.ap_store_action(
          nullif(p_idempotency_key, ''), 'record_bill_payment', v_hash, v_result
        );
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different bill payment.',
        'code', 'IDEMPOTENCY_CONFLICT'
      );
  end;
  perform set_config('app.ap_mutation', 'false', true);

  select account_id into v_ap
  from public.accounting_account_mappings
  where mapping_key = 'accounts_payable';

  if p_cash_account_id is not null then
    if not public.accounting_is_eligible_cash_account(p_cash_account_id) then
      raise exception 'AP_PAYMENT_ABORTED: invalid cash account after insert would leave partial state — rolling back.';
    end if;
    v_cash := p_cash_account_id;
  else
    select account_id into v_cash
    from public.accounting_payment_method_mappings
    where payment_method = coalesce(nullif(p_method, ''), 'other');
    if v_cash is null then
      select account_id into v_cash
      from public.accounting_account_mappings
      where mapping_key = 'cash_operating';
    end if;
  end if;

  if v_ap is null or v_cash is null then
    v_review := true;
  end if;

  v_frozen := jsonb_build_array(
    jsonb_build_object('accountId', v_ap, 'debit', v_amt, 'credit', 0, 'memo', 'Pay AP', 'billId', p_bill_id),
    jsonb_build_object('accountId', v_cash, 'debit', 0, 'credit', v_amt, 'memo', 'Cash out', 'billId', p_bill_id)
  );
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'bill_payment',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'bill_payment',
    'sourceId', v_pay_id,
    'amount', v_amt,
    'billId', p_bill_id,
    'apAccountId', v_ap,
    'cashAccountId', v_cash,
    'paymentMethod', coalesce(nullif(p_method, ''), 'other'),
    'frozenLines', v_frozen
  );
  perform public.enqueue_accounting_outbox_safe(
    'bill_payment', v_pay_id, 'bill_payment', v_payload, v_review
  );

  perform public.accounting_audit_from_definer_safe(
    'bill_payment_recorded', 'bill_payment', v_pay_id, v_econ, null,
    jsonb_build_object('billPaymentId', v_pay_id, 'billId', p_bill_id, 'amount', v_amt),
    v_actor, 'audit:bill_payment:' || v_pay_id::text
  );

  return public.ap_store_action(
    nullif(p_idempotency_key, ''),
    'record_bill_payment',
    v_hash,
    jsonb_build_object(
      'ok', true,
      'bill_payment_id', v_pay_id,
      'duplicate', false,
      'remaining_after', public.ap_bill_remaining(p_bill_id)
    )
  );
end;
$$;

create or replace function public.void_bill_payment_safe(
  p_bill_payment_id uuid,
  p_voided_by uuid,
  p_void_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_pay public.bill_payments%rowtype;
  v_orig uuid;
  v_payload jsonb;
  v_econ date;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'void bill payments');
  v_actor := public.accounting_actor_id(p_voided_by);
  if p_void_reason is null or btrim(p_void_reason) = '' then
    return jsonb_build_object('ok', false, 'error', 'Payment reversal reason is required.');
  end if;

  select * into v_pay from public.bill_payments where id = p_bill_payment_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Bill payment not found.');
  end if;
  perform public.ap_lock_bill(v_pay.bill_id);
  select * into v_pay from public.bill_payments where id = p_bill_payment_id for update;

  if v_pay.status = 'void' then
    return jsonb_build_object('ok', true, 'bill_payment_id', p_bill_payment_id, 'duplicate', true);
  end if;

  perform set_config('app.ap_mutation', 'true', true);
  update public.bill_payments
  set status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      void_reason = btrim(p_void_reason)
  where id = p_bill_payment_id;
  perform set_config('app.ap_mutation', 'false', true);

  select id into v_orig
  from public.journal_entries
  where idempotency_key = 'bill_payment:' || p_bill_payment_id::text || ':post'
    and status = 'posted'
  limit 1;

  v_econ := (timezone('utc', now()))::date;
  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'bill_payment_void',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'bill_payment',
    'sourceId', p_bill_payment_id,
    'amount', v_pay.amount,
    'billId', v_pay.bill_id,
    'originalJournalEntryId', v_orig,
    'originalIdempotencyKey', 'bill_payment:' || p_bill_payment_id::text || ':post'
  );
  perform public.enqueue_accounting_outbox_safe(
    'bill_payment', p_bill_payment_id, 'bill_payment_void', v_payload, v_orig is null
  );

  perform public.accounting_audit_from_definer_safe(
    'bill_payment_voided', 'bill_payment', p_bill_payment_id, v_econ, btrim(p_void_reason),
    jsonb_build_object('billPaymentId', p_bill_payment_id, 'billId', v_pay.bill_id, 'amount', v_pay.amount),
    v_actor, 'audit:bill_payment_void:' || p_bill_payment_id::text
  );

  return jsonb_build_object('ok', true, 'bill_payment_id', p_bill_payment_id, 'duplicate', false);
end;
$$;

-- ===========================================================================
-- Direct expense RPC (expenses provenance schema + boundary trigger: section 1b)
-- skip ledger when p_bill_id is set (0171). Canonical supplier+invoice identity
-- rejects open AP under lock 176; UI ack required for unlinked cash expenses.
-- ===========================================================================

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'record_direct_expense_safe'
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

create or replace function public.record_direct_expense_safe(
  p_date date,
  p_category public.expense_category,
  p_amount numeric,
  p_vendor text default null,
  p_note text default null,
  p_job_id uuid default null,
  p_bill_id uuid default null,
  p_created_by uuid default null,
  p_idempotency_key text default null,
  p_supplier_id uuid default null,
  p_vendor_invoice_ref text default null,
  p_ack_unlinked boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_expense_id uuid;
  v_econ date;
  v_map public.accounting_expense_category_mappings%rowtype;
  v_exp_acct uuid;
  v_cash uuid;
  v_review boolean := false;
  v_frozen jsonb;
  v_payload jsonb;
  v_existing uuid;
  v_norm text;
  v_amt numeric;
  v_hash text;
  v_dup jsonb;
  v_result jsonb;
  v_exp public.expenses%rowtype;
begin
  perform public.accounting_require_roles(ARRAY['admin','office'], 'record direct expenses');
  v_actor := public.accounting_actor_id(p_created_by);

  begin
    v_amt := public.ap_money_ok(p_amount, false);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  if p_bill_id is not null then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'Expense is linked to a vendor bill — ledger uses bill + bill payment.'
    );
  end if;

  v_norm := public.ap_normalize_invoice(p_vendor_invoice_ref);
  v_hash := public.ap_context_hash('record_direct_expense', jsonb_build_object(
    'date', p_date,
    'category', coalesce(p_category, 'other')::text,
    'amount', v_amt,
    'supplier_id', p_supplier_id,
    'vendor_invoice_norm', v_norm,
    'vendor', nullif(p_vendor, ''),
    'job_id', p_job_id,
    'note', nullif(p_note, '')
  ));
  begin
    v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'record_direct_expense', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  if p_job_id is not null then
    perform public.installer_labor_lock_job(p_job_id);
  end if;

  if p_supplier_id is not null and v_norm is not null then
    perform public.ap_lock_vendor_invoice(p_supplier_id, v_norm);
    if exists (
      select 1 from public.bills
      where supplier_id = p_supplier_id
        and vendor_invoice_norm = v_norm
        and ap_lifecycle in ('draft', 'open')
    ) then
      return jsonb_build_object(
        'ok', false,
        'error', 'An AP bill already exists for this vendor invoice. Pay the bill; do not record a direct expense.',
        'code', 'AP_OBLIGATION_EXISTS'
      );
    end if;
  end if;

  if p_ack_unlinked is not true then
    return jsonb_build_object(
      'ok', false,
      'error', 'Confirm this is an already-paid cash/card expense, not a vendor bill.',
      'code', 'REQUIRE_DIRECT_EXPENSE_ACK'
    );
  end if;

  -- Re-check context idempotency after locks (same key concurrent winner may have stored).
  begin
    v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'record_direct_expense', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then
    return v_dup || jsonb_build_object('duplicate', true);
  end if;

  v_econ := public.accounting_resolve_business_date(p_date, 'expense');

  begin
    insert into public.expenses (
      date, category, amount, vendor, note, job_id, bill_id, created_by, idempotency_key,
      supplier_id, vendor_invoice_norm, economic_kind
    ) values (
      v_econ,
      coalesce(p_category, 'other'),
      v_amt,
      nullif(p_vendor, ''),
      nullif(p_note, ''),
      p_job_id,
      null,
      v_actor,
      nullif(p_idempotency_key, ''),
      p_supplier_id,
      v_norm,
      'direct_cash'
    )
    returning id into v_expense_id;
  exception
    when unique_violation then
      begin
        v_dup := public.ap_lookup_action(nullif(p_idempotency_key, ''), 'record_direct_expense', v_hash);
        if v_dup is not null then
          return v_dup || jsonb_build_object('duplicate', true);
        end if;
      exception when others then
        return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
      end;
      select * into v_exp
      from public.expenses
      where idempotency_key = p_idempotency_key
      limit 1;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'Idempotency conflict on expense key.', 'code', 'IDEMPOTENCY_CONFLICT');
      end if;
      -- Legacy row with same key: only accept if economic fields match this context.
      if round(v_exp.amount, 2) = v_amt
         and v_exp.category is not distinct from coalesce(p_category, 'other')
         and v_exp.supplier_id is not distinct from p_supplier_id
         and v_exp.vendor_invoice_norm is not distinct from v_norm
         and v_exp.job_id is not distinct from p_job_id
         and coalesce(v_exp.vendor, '') is not distinct from coalesce(nullif(p_vendor, ''), '') then
        v_result := jsonb_build_object('ok', true, 'expense_id', v_exp.id, 'duplicate', true);
        return public.ap_store_action(nullif(p_idempotency_key, ''), 'record_direct_expense', v_hash, v_result);
      end if;
      return jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a different direct expense.',
        'code', 'IDEMPOTENCY_CONFLICT'
      );
  end;

  select * into v_map
  from public.accounting_expense_category_mappings
  where expense_category = coalesce(p_category, 'other')::text;

  if not found or coalesce(v_map.requires_review, true) or v_map.account_id is null then
    v_review := true;
    v_exp_acct := null;
  else
    v_exp_acct := v_map.account_id;
  end if;

  select account_id into v_cash
  from public.accounting_account_mappings
  where mapping_key = 'cash_operating';

  if v_exp_acct is null or v_cash is null then
    v_review := true;
  end if;

  v_frozen := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_exp_acct,
      'debit', v_amt,
      'credit', 0,
      'memo', 'Direct expense',
      'jobId', p_job_id
    ),
    jsonb_build_object(
      'accountId', v_cash,
      'debit', 0,
      'credit', v_amt,
      'memo', 'Cash out',
      'jobId', p_job_id
    )
  );

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'eventKind', 'direct_expense',
    'economicEventDate', v_econ::text,
    'rebuildStrategy', 'immutable_outbox_snapshot',
    'sourceType', 'expense',
    'sourceId', v_expense_id,
    'amount', v_amt,
    'expenseCategory', coalesce(p_category, 'other')::text,
    'expenseAccountId', v_exp_acct,
    'cashAccountId', v_cash,
    'jobId', p_job_id,
    'idempotencyKey', nullif(p_idempotency_key, ''),
    'frozenLines', v_frozen,
    'actorId', v_actor
  );

  perform public.enqueue_accounting_outbox_safe(
    'expense', v_expense_id, 'direct_expense', v_payload, v_review
  );

  perform public.accounting_audit_from_definer_safe(
    'direct_expense_recorded', 'expense', v_expense_id, v_econ, null,
    jsonb_build_object(
      'expenseId', v_expense_id,
      'amount', v_amt,
      'category', p_category::text
    ),
    v_actor, 'audit:expense:' || v_expense_id::text
  );

  v_result := jsonb_build_object(
    'ok', true,
    'expense_id', v_expense_id,
    'duplicate', false,
    'review_required', v_review
  );
  return public.ap_store_action(
    nullif(p_idempotency_key, ''),
    'record_direct_expense',
    v_hash,
    v_result
  );
end;
$$;

-- ===========================================================================
-- 6) Privileges — revoke authenticated DML; staff RPCs only
-- ===========================================================================

revoke insert, update, delete on public.bills from authenticated;
revoke insert, update, delete on public.bill_items from authenticated;
revoke insert, update, delete on public.bill_payments from authenticated;
grant select on public.bills to authenticated;
grant select on public.bill_items to authenticated;
grant select on public.bill_payments to authenticated;
grant select, insert, update, delete on public.bills to service_role;
grant select, insert, update, delete on public.bill_items to service_role;
grant select, insert, update, delete on public.bill_payments to service_role;

drop policy if exists bills_staff_all on public.bills;
drop policy if exists bills_admin_office_select on public.bills;
create policy bills_admin_office_select on public.bills
  for select to authenticated
  using (public.user_role(auth.uid()) in ('admin', 'office'));

drop policy if exists bill_items_staff_all on public.bill_items;
drop policy if exists bill_items_admin_office_select on public.bill_items;
create policy bill_items_admin_office_select on public.bill_items
  for select to authenticated
  using (public.user_role(auth.uid()) in ('admin', 'office'));

drop policy if exists bill_payments_staff_all on public.bill_payments;
drop policy if exists bill_payments_admin_office_select on public.bill_payments;
create policy bill_payments_admin_office_select on public.bill_payments
  for select to authenticated
  using (public.user_role(auth.uid()) in ('admin', 'office'));

revoke insert, update, delete on public.expenses from authenticated;
grant select on public.expenses to authenticated;
grant select, insert, update, delete on public.expenses to service_role;

-- Cost history: admin/office SELECT only (align with bills). No authenticated DML.
drop policy if exists expenses_staff_all on public.expenses;
drop policy if exists expenses_admin_all on public.expenses;
drop policy if exists expenses_admin_office_select on public.expenses;
create policy expenses_admin_office_select on public.expenses
  for select to authenticated
  using (public.user_role(auth.uid()) in ('admin', 'office'));

revoke all on public.ap_action_idempotency from public;
revoke all on public.ap_action_idempotency from anon;
revoke all on public.ap_action_idempotency from authenticated;
grant all on public.ap_action_idempotency to service_role;

-- ---------------------------------------------------------------------------
-- LEGACY RPC CLOSURE — post_vendor_bill_safe
-- Historically (0166/0171): snapshot accounting enqueue for an already-open bill.
-- Canonical 0175 lifecycle is create → save draft → activate → void/correct +
-- payments. No UI/server path calls post_vendor_bill_safe. Keeping it granted
-- would inherit a parallel AP posting surface. Drop all overloads.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'post_vendor_bill_safe'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    execute format('revoke all on function %s from service_role', r.sig);
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

do $$
declare
  r record;
  v_staff text[] := array[
    'create_vendor_bill_safe',
    'save_vendor_bill_draft_safe',
    'activate_vendor_bill_safe',
    'void_vendor_bill_safe',
    'correct_vendor_bill_safe',
    'record_bill_payment_safe',
    'void_bill_payment_safe',
    'ap_bill_original_total',
    'ap_bill_paid_total',
    'ap_bill_remaining',
    'ap_bill_display_status',
    'record_direct_expense_safe'
  ];
  v_internal text[] := array[
    'ap_text_is_nonfinite',
    'ap_parse_numeric_text',
    'ap_money_ok',
    'ap_json_numeric',
    'ap_line_total',
    'ap_normalize_invoice',
    'ap_context_hash',
    'ap_lookup_action',
    'ap_store_action',
    'ap_require_ok',
    'ap_lock_bill',
    'ap_lock_jobs_sorted',
    'ap_lock_vendor_invoice',
    'ap_lock_vendor_invoices_sorted',
    'ap_direct_expense_identity_exists',
    'ap_reject_if_direct_expense_identity',
    'ap_record_vendor_event',
    'ap_validate_lines',
    'ap_assert_category',
    'ap_assert_supplier',
    'bills_enforce_ap_immutability',
    'bill_items_enforce_ap_immutability',
    'bill_payments_enforce_ap_immutability',
    'bill_payments_block_void_ap',
    'expenses_block_ap_linked_insert'
  ];
  v_all text[];
  v_staff_name text;
begin
  -- Sanity: every staff name must exist before ACL grants (no orphan grants).
  foreach v_staff_name in array v_staff
  loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = v_staff_name
    ) then
      raise exception
        'AP_ACL_MISSING_STAFF_RPC: % must be defined before 0175 ACL grant.',
        v_staff_name;
    end if;
  end loop;

  -- post_vendor_bill_safe must be fully gone (no accidental grant).
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'post_vendor_bill_safe'
  ) then
    raise exception
      'AP_LEGACY_RPC: post_vendor_bill_safe must be dropped before ACL sweep.';
  end if;

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

-- Catalog-driven: never REVOKE a named overload that may not exist.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'complete_bank_reconciliation_safe',
        'enqueue_accounting_outbox_safe'
      )
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
