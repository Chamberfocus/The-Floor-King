-- 0185 — Existing customer duplicate cleanup (owner-approved merge).
-- Read-only detection lives in the app. This migration adds:
--   - soft-merge columns on customers
--   - customer_duplicate_exclusions (normalized A/B pair)
--   - customer_merge_history (audit + idempotency)
--   - merge_customer_records(...) SECURITY DEFINER RPC
--
-- Do NOT set posting_enabled
-- Do NOT auto-merge
-- Do NOT hard-delete customers
-- Do NOT apply this file to production without owner review.
-- Safe to re-run. Additive only. No bulk updates. No live merges.

-- ---------------------------------------------------------------------------
-- 0) Accounting safety: never enable posting. Do not mutate flags.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.accounting_settings') is null then
    raise exception 'P0_0185_PRECHECK: accounting_settings missing — apply 0161–0184 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Soft-merge columns on customers (keep the old id for audit)
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists merged_into_customer_id uuid
    references public.customers (id) on delete restrict,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references auth.users (id) on delete set null,
  add column if not exists merge_reason text;

create index if not exists customers_merged_into_idx
  on public.customers (merged_into_customer_id)
  where merged_into_customer_id is not null;

create index if not exists customers_active_id_idx
  on public.customers (id)
  where merged_into_customer_id is null;

-- ---------------------------------------------------------------------------
-- 2) Intentional "not a duplicate" pair suppression
--    Pair order is normalized: customer_id_a < customer_id_b
-- ---------------------------------------------------------------------------
create table if not exists public.customer_duplicate_exclusions (
  customer_id_a uuid not null references public.customers (id) on delete cascade,
  customer_id_b uuid not null references public.customers (id) on delete cascade,
  reason text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (customer_id_a, customer_id_b),
  check (customer_id_a < customer_id_b),
  check (customer_id_a <> customer_id_b)
);

create or replace function public.normalize_customer_duplicate_exclusion()
returns trigger
language plpgsql
as $$
declare
  v_lo uuid;
  v_hi uuid;
begin
  if new.customer_id_a is null or new.customer_id_b is null then
    raise exception 'Both customer ids are required.';
  end if;
  if new.customer_id_a = new.customer_id_b then
    raise exception 'Cannot exclude a customer from itself.';
  end if;
  v_lo := least(new.customer_id_a, new.customer_id_b);
  v_hi := greatest(new.customer_id_a, new.customer_id_b);
  new.customer_id_a := v_lo;
  new.customer_id_b := v_hi;
  return new;
end;
$$;

drop trigger if exists customer_duplicate_exclusions_normalize
  on public.customer_duplicate_exclusions;
create trigger customer_duplicate_exclusions_normalize
  before insert or update on public.customer_duplicate_exclusions
  for each row execute function public.normalize_customer_duplicate_exclusion();

-- ---------------------------------------------------------------------------
-- 3) Merge history (audit trail + idempotency)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_merge_history (
  id uuid primary key default gen_random_uuid(),
  survivor_customer_id uuid not null references public.customers (id) on delete restrict,
  duplicate_customer_id uuid not null references public.customers (id) on delete restrict,
  performed_by uuid references auth.users (id) on delete set null,
  performed_at timestamptz not null default now(),
  reason text not null,
  chosen_fields jsonb not null default '{}'::jsonb,
  pre_merge_counts jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  result jsonb,
  unique (idempotency_key),
  unique (duplicate_customer_id)
);

create index if not exists customer_merge_history_survivor_idx
  on public.customer_merge_history (survivor_customer_id, performed_at desc);

-- ---------------------------------------------------------------------------
-- RLS — office/admin mutate; sales_manager may read review data
-- ---------------------------------------------------------------------------
alter table public.customer_duplicate_exclusions enable row level security;
alter table public.customer_merge_history enable row level security;

drop policy if exists customer_duplicate_exclusions_select on public.customer_duplicate_exclusions;
create policy customer_duplicate_exclusions_select
  on public.customer_duplicate_exclusions
  for select to authenticated
  using (public.my_role() in ('admin', 'office', 'sales_manager'));

drop policy if exists customer_duplicate_exclusions_write on public.customer_duplicate_exclusions;
create policy customer_duplicate_exclusions_write
  on public.customer_duplicate_exclusions
  for all to authenticated
  using (public.my_role() in ('admin', 'office'))
  with check (public.my_role() in ('admin', 'office'));

drop policy if exists customer_merge_history_select on public.customer_merge_history;
create policy customer_merge_history_select
  on public.customer_merge_history
  for select to authenticated
  using (public.my_role() in ('admin', 'office', 'sales_manager'));

grant select, insert, update, delete on public.customer_duplicate_exclusions to authenticated;
grant select on public.customer_merge_history to authenticated;
revoke insert, update, delete on public.customer_merge_history from authenticated, public, anon;

-- ---------------------------------------------------------------------------
-- 4) Allowlisted identity reassignment (never dynamic-from-client)
-- ---------------------------------------------------------------------------
create or replace function public.customer_merge_reassign(
  p_table text,
  p_column text,
  p_from uuid,
  p_to uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
begin
  if p_table not in (
    'jobs', 'estimates', 'invoices', 'customer_deposits', 'credit_memos',
    'refunds', 'orders', 'appointments', 'activities', 'messages', 'documents',
    'office_tasks', 'service_callbacks', 'service_addresses', 'sample_checkouts',
    'customer_areas', 'purchase_orders', 'po_items', 'bills', 'stock_movements',
    'opening_ar_items'
  ) then
    raise exception 'CUSTOMER_MERGE_BAD_TABLE: %', p_table;
  end if;
  if p_column not in ('customer_id', 'for_customer_id') then
    raise exception 'CUSTOMER_MERGE_BAD_COLUMN: %', p_column;
  end if;
  if p_table = 'po_items' and p_column <> 'for_customer_id' then
    raise exception 'CUSTOMER_MERGE_BAD_COLUMN: po_items uses for_customer_id';
  end if;
  execute format(
    'update public.%I set %I = $1 where %I = $2',
    p_table, p_column, p_column
  )
  using p_to, p_from;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.customer_merge_reassign(text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.customer_merge_reassign(text, text, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5) Authoritative merge RPC
--    merge_customer_records(survivor, duplicate, chosen_fields, reason, idempotency_key)
-- ---------------------------------------------------------------------------
create or replace function public.merge_customer_records(
  p_survivor_customer_id uuid,
  p_duplicate_customer_id uuid,
  p_chosen_fields jsonb default '{}'::jsonb,
  p_reason text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_actor uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_surv public.customers%rowtype;
  v_dup public.customers%rowtype;
  v_prior public.customer_merge_history%rowtype;
  v_key text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_portal_s int := 0;
  v_portal_d int := 0;
  v_draft_s int := 0;
  v_draft_d int := 0;
  v_counts jsonb;
  v_before_inv numeric := 0;
  v_before_pay numeric := 0;
  v_before_cred numeric := 0;
  v_before_dep numeric := 0;
  v_before_wo numeric := 0;
  v_after_inv numeric := 0;
  v_after_pay numeric := 0;
  v_after_cred numeric := 0;
  v_after_dep numeric := 0;
  v_after_wo numeric := 0;
  v_pick text;
  v_result jsonb;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role is distinct from 'admin' and v_role is distinct from 'office' then
    return jsonb_build_object(
      'ok', false,
      'code', 'NOT_AUTHORIZED',
      'error', 'Only office/admin can merge customer records.'
    );
  end if;

  if p_survivor_customer_id is null or p_duplicate_customer_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'error', 'Both customer ids are required.');
  end if;
  if p_survivor_customer_id = p_duplicate_customer_id then
    return jsonb_build_object('ok', false, 'code', 'SAME_CUSTOMER', 'error', 'Cannot merge a customer into itself.');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'MISSING_REASON', 'error', 'A merge reason is required.');
  end if;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    v_key := 'merge-customer:' || p_survivor_customer_id::text || ':' || p_duplicate_customer_id::text;
  end if;

  -- Pair lock (namespace 185) then row locks in sorted id order.
  v_lo := least(p_survivor_customer_id, p_duplicate_customer_id);
  v_hi := greatest(p_survivor_customer_id, p_duplicate_customer_id);
  perform pg_advisory_xact_lock(185, hashtext(v_lo::text || ':' || v_hi::text));
  perform pg_advisory_xact_lock(185, hashtext(v_lo::text));
  perform pg_advisory_xact_lock(185, hashtext(v_hi::text));

  select * into v_prior
  from public.customer_merge_history
  where idempotency_key = v_key
  for update;
  if found then
    if v_prior.survivor_customer_id = p_survivor_customer_id
       and v_prior.duplicate_customer_id = p_duplicate_customer_id then
      return coalesce(v_prior.result, jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'survivor_customer_id', v_prior.survivor_customer_id,
        'duplicate_customer_id', v_prior.duplicate_customer_id
      ));
    end if;
    return jsonb_build_object(
      'ok', false,
      'code', 'IDEMPOTENCY_CONFLICT',
      'error', 'This idempotency key was already used for a different merge.'
    );
  end if;

  select * into v_surv from public.customers where id = p_survivor_customer_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'error', 'Surviving customer not found.');
  end if;
  select * into v_dup from public.customers where id = p_duplicate_customer_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'error', 'Duplicate customer not found.');
  end if;

  if v_surv.merged_into_customer_id is not null then
    return jsonb_build_object(
      'ok', false,
      'code', 'SURVIVOR_MERGED',
      'error', 'The surviving customer was already merged into another record.'
    );
  end if;
  if v_dup.merged_into_customer_id is not null then
    if v_dup.merged_into_customer_id = p_survivor_customer_id then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'code', 'ALREADY_MERGED',
        'survivor_customer_id', p_survivor_customer_id,
        'duplicate_customer_id', p_duplicate_customer_id
      );
    end if;
    return jsonb_build_object(
      'ok', false,
      'code', 'DUPLICATE_MERGED',
      'error', 'That customer was already merged and cannot be merged again.'
    );
  end if;

  select count(*)::int into v_portal_s
  from public.profiles
  where customer_id = p_survivor_customer_id and role = 'customer';
  select count(*)::int into v_portal_d
  from public.profiles
  where customer_id = p_duplicate_customer_id and role = 'customer';
  if v_portal_s > 0 and v_portal_d > 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'PORTAL_CONFLICT',
      'error', 'Both records have customer portal logins. Resolve portal identity before merging.'
    );
  end if;

  if to_regclass('public.estimate_drafts') is not null then
    select count(*)::int into v_draft_s from public.estimate_drafts where customer_id = p_survivor_customer_id;
    select count(*)::int into v_draft_d from public.estimate_drafts where customer_id = p_duplicate_customer_id;
    if v_draft_s > 0 and v_draft_d > 0 then
      return jsonb_build_object(
        'ok', false,
        'code', 'DRAFT_CONFLICT',
        'error', 'Both records have an in-progress estimate draft. Resolve drafts before merging.'
      );
    end if;
  end if;

  -- Conflicting profile fields need an explicit choice.
  if coalesce(nullif(btrim(v_surv.full_name), ''), '') <> ''
     and coalesce(nullif(btrim(v_dup.full_name), ''), '') <> ''
     and v_surv.full_name is distinct from v_dup.full_name
     and coalesce(p_chosen_fields->>'full_name', '') not in ('survivor', 'duplicate') then
    return jsonb_build_object('ok', false, 'code', 'FIELD_CONFLICT', 'error', 'Choose a surviving value for: full_name.');
  end if;
  if coalesce(nullif(btrim(v_surv.phone), ''), '') <> ''
     and coalesce(nullif(btrim(v_dup.phone), ''), '') <> ''
     and v_surv.phone is distinct from v_dup.phone
     and coalesce(p_chosen_fields->>'phone', '') not in ('survivor', 'duplicate') then
    return jsonb_build_object('ok', false, 'code', 'FIELD_CONFLICT', 'error', 'Choose a surviving value for: phone.');
  end if;
  if coalesce(nullif(btrim(v_surv.email), ''), '') <> ''
     and coalesce(nullif(btrim(v_dup.email), ''), '') <> ''
     and v_surv.email is distinct from v_dup.email
     and coalesce(p_chosen_fields->>'email', '') not in ('survivor', 'duplicate') then
    return jsonb_build_object('ok', false, 'code', 'FIELD_CONFLICT', 'error', 'Choose a surviving value for: email.');
  end if;
  if coalesce(nullif(btrim(v_surv.street), ''), '') <> ''
     and coalesce(nullif(btrim(v_dup.street), ''), '') <> ''
     and v_surv.street is distinct from v_dup.street
     and coalesce(p_chosen_fields->>'street', '') not in ('survivor', 'duplicate') then
    return jsonb_build_object('ok', false, 'code', 'FIELD_CONFLICT', 'error', 'Choose a surviving value for: street.');
  end if;

  -- Financial snapshot BEFORE any identity rewrite (invoice totals only — not a posting).
  select coalesce(sum(
           (select coalesce(sum(ii.quantity * ii.rate), 0) from public.invoice_items ii where ii.invoice_id = i.id)
           * (1 + coalesce(i.tax_rate, 0) / 100.0)
         ), 0)
    into v_before_inv
  from public.invoices i
  where i.customer_id in (p_survivor_customer_id, p_duplicate_customer_id)
    and i.status is distinct from 'void';

  select coalesce(sum(p.amount), 0) into v_before_pay
  from public.payments p
  join public.invoices i on i.id = p.invoice_id
  where i.customer_id in (p_survivor_customer_id, p_duplicate_customer_id)
    and coalesce(p.status, 'active') is distinct from 'void';

  if to_regclass('public.credit_applications') is not null then
    select coalesce(sum(ca.amount), 0) into v_before_cred
    from public.credit_applications ca
    join public.invoices i on i.id = ca.invoice_id
    where i.customer_id in (p_survivor_customer_id, p_duplicate_customer_id)
      and coalesce(ca.status, 'active') is distinct from 'void';
  end if;
  if to_regclass('public.customer_deposit_applications') is not null then
    select coalesce(sum(da.amount), 0) into v_before_dep
    from public.customer_deposit_applications da
    join public.invoices i on i.id = da.invoice_id
    where i.customer_id in (p_survivor_customer_id, p_duplicate_customer_id)
      and coalesce(da.status, 'active') is distinct from 'void';
  end if;
  if to_regclass('public.invoice_write_offs') is not null then
    select coalesce(sum(w.amount), 0) into v_before_wo
    from public.invoice_write_offs w
    join public.invoices i on i.id = w.invoice_id
    where i.customer_id in (p_survivor_customer_id, p_duplicate_customer_id)
      and coalesce(w.status, 'active') is distinct from 'void';
  end if;

  select jsonb_build_object(
    'jobs', (select count(*) from public.jobs where customer_id = p_duplicate_customer_id),
    'estimates', (select count(*) from public.estimates where customer_id = p_duplicate_customer_id),
    'invoices', (select count(*) from public.invoices where customer_id = p_duplicate_customer_id),
    'deposits', (select count(*) from public.customer_deposits where customer_id = p_duplicate_customer_id),
    'credits', (select count(*) from public.credit_memos where customer_id = p_duplicate_customer_id),
    'refunds', (select count(*) from public.refunds where customer_id = p_duplicate_customer_id),
    'orders', (select count(*) from public.orders where customer_id = p_duplicate_customer_id),
    'appointments', (select count(*) from public.appointments where customer_id = p_duplicate_customer_id),
    'documents', (select count(*) from public.documents where customer_id = p_duplicate_customer_id),
    'notes', (select count(*) from public.activities where customer_id = p_duplicate_customer_id)
  ) into v_counts;

  -- LIVE FK reassignment (identity only).
  perform public.customer_merge_reassign('jobs', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('estimates', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('invoices', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  -- Deposits: reassign identity, keep job_id / estimate_id restrictions, do not auto-apply.
  perform public.customer_merge_reassign('customer_deposits', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('credit_memos', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('refunds', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('orders', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('appointments', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('activities', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('messages', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('documents', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('office_tasks', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('service_callbacks', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('service_addresses', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('sample_checkouts', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('customer_areas', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('purchase_orders', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('po_items', 'for_customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('bills', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  perform public.customer_merge_reassign('stock_movements', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  if to_regclass('public.opening_ar_items') is not null then
    perform public.customer_merge_reassign('opening_ar_items', 'customer_id', p_duplicate_customer_id, p_survivor_customer_id);
  end if;

  -- step_overrides: keep survivor's account-level keys, drop colliding duplicate keys, move the rest.
  if to_regclass('public.step_overrides') is not null then
    delete from public.step_overrides d
    using public.step_overrides s
    where d.customer_id = p_duplicate_customer_id
      and s.customer_id = p_survivor_customer_id
      and d.job_id is null
      and s.job_id is null
      and d.step_key = s.step_key;
    update public.step_overrides
    set customer_id = p_survivor_customer_id
    where customer_id = p_duplicate_customer_id;
  end if;

  -- estimate_drafts: move only when survivor has none (both already blocked).
  if to_regclass('public.estimate_drafts') is not null and v_draft_d > 0 and v_draft_s = 0 then
    insert into public.estimate_drafts (
      customer_id, service_address_id, answers, overrides, step, updated_by, updated_at
    )
    select p_survivor_customer_id, service_address_id, answers, overrides, step, updated_by, updated_at
    from public.estimate_drafts
    where customer_id = p_duplicate_customer_id;
    delete from public.estimate_drafts where customer_id = p_duplicate_customer_id;
  end if;

  -- Portal: at most one side has a customer login (blocked above if both).
  update public.profiles
  set customer_id = p_survivor_customer_id
  where customer_id = p_duplicate_customer_id;

  -- Referrals pointing at the duplicate now point at the survivor (never self).
  update public.customers
  set referred_by_customer_id = p_survivor_customer_id
  where referred_by_customer_id = p_duplicate_customer_id
    and id <> p_survivor_customer_id;
  update public.customers
  set referred_by_customer_id = null
  where id = p_survivor_customer_id
    and referred_by_customer_id = p_duplicate_customer_id;

  -- Apply chosen / fill-empty profile fields. Never silently overwrite a conflict.
  v_pick := coalesce(p_chosen_fields->>'full_name', '');
  if v_pick = 'duplicate' then v_surv.full_name := v_dup.full_name;
  elsif coalesce(nullif(btrim(v_surv.full_name), ''), '') = '' then v_surv.full_name := v_dup.full_name;
  end if;
  v_pick := coalesce(p_chosen_fields->>'phone', '');
  if v_pick = 'duplicate' then v_surv.phone := v_dup.phone;
  elsif coalesce(nullif(btrim(v_surv.phone), ''), '') = '' then v_surv.phone := v_dup.phone;
  end if;
  v_pick := coalesce(p_chosen_fields->>'email', '');
  if v_pick = 'duplicate' then v_surv.email := v_dup.email;
  elsif coalesce(nullif(btrim(v_surv.email), ''), '') = '' then v_surv.email := v_dup.email;
  end if;
  v_pick := coalesce(p_chosen_fields->>'street', '');
  if v_pick = 'duplicate' then v_surv.street := v_dup.street;
  elsif coalesce(nullif(btrim(v_surv.street), ''), '') = '' then v_surv.street := v_dup.street;
  end if;
  v_pick := coalesce(p_chosen_fields->>'city', '');
  if v_pick = 'duplicate' then v_surv.city := v_dup.city;
  elsif coalesce(nullif(btrim(v_surv.city), ''), '') = '' then v_surv.city := v_dup.city;
  end if;
  v_pick := coalesce(p_chosen_fields->>'state', '');
  if v_pick = 'duplicate' then v_surv.state := v_dup.state;
  elsif coalesce(nullif(btrim(v_surv.state), ''), '') = '' then v_surv.state := v_dup.state;
  end if;
  v_pick := coalesce(p_chosen_fields->>'zip', '');
  if v_pick = 'duplicate' then v_surv.zip := v_dup.zip;
  elsif coalesce(nullif(btrim(v_surv.zip), ''), '') = '' then v_surv.zip := v_dup.zip;
  end if;
  v_pick := coalesce(p_chosen_fields->>'company', '');
  if v_pick = 'duplicate' then v_surv.company := v_dup.company;
  elsif coalesce(nullif(btrim(v_surv.company), ''), '') = '' then v_surv.company := v_dup.company;
  end if;
  v_pick := coalesce(p_chosen_fields->>'assigned_to', '');
  if v_pick = 'duplicate' then v_surv.assigned_to := v_dup.assigned_to;
  elsif v_surv.assigned_to is null then v_surv.assigned_to := v_dup.assigned_to;
  end if;
  v_pick := coalesce(p_chosen_fields->>'notes', '');
  if v_pick = 'duplicate' then v_surv.notes := v_dup.notes;
  elsif coalesce(nullif(btrim(v_surv.notes), ''), '') = '' then v_surv.notes := v_dup.notes;
  end if;

  update public.customers
  set full_name = v_surv.full_name,
      phone = v_surv.phone,
      email = v_surv.email,
      street = v_surv.street,
      city = v_surv.city,
      state = v_surv.state,
      zip = v_surv.zip,
      company = v_surv.company,
      assigned_to = v_surv.assigned_to,
      notes = v_surv.notes
  where id = p_survivor_customer_id;

  update public.customers
  set merged_into_customer_id = p_survivor_customer_id,
      merged_at = now(),
      merged_by = v_actor,
      merge_reason = v_reason
  where id = p_duplicate_customer_id;

  insert into public.activities (customer_id, user_id, type, body)
  values (
    p_survivor_customer_id,
    v_actor,
    'system',
    'Customer record ' || p_duplicate_customer_id::text ||
      ' merged into this customer on ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD') ||
      ' by staff. Reason: ' || v_reason
  );

  -- Prove financial totals are unchanged after identity rewrite.
  select coalesce(sum(
           (select coalesce(sum(ii.quantity * ii.rate), 0) from public.invoice_items ii where ii.invoice_id = i.id)
           * (1 + coalesce(i.tax_rate, 0) / 100.0)
         ), 0)
    into v_after_inv
  from public.invoices i
  where i.customer_id = p_survivor_customer_id
    and i.status is distinct from 'void';

  select coalesce(sum(p.amount), 0) into v_after_pay
  from public.payments p
  join public.invoices i on i.id = p.invoice_id
  where i.customer_id = p_survivor_customer_id
    and coalesce(p.status, 'active') is distinct from 'void';

  if to_regclass('public.credit_applications') is not null then
    select coalesce(sum(ca.amount), 0) into v_after_cred
    from public.credit_applications ca
    join public.invoices i on i.id = ca.invoice_id
    where i.customer_id = p_survivor_customer_id
      and coalesce(ca.status, 'active') is distinct from 'void';
  end if;
  if to_regclass('public.customer_deposit_applications') is not null then
    select coalesce(sum(da.amount), 0) into v_after_dep
    from public.customer_deposit_applications da
    join public.invoices i on i.id = da.invoice_id
    where i.customer_id = p_survivor_customer_id
      and coalesce(da.status, 'active') is distinct from 'void';
  end if;
  if to_regclass('public.invoice_write_offs') is not null then
    select coalesce(sum(w.amount), 0) into v_after_wo
    from public.invoice_write_offs w
    join public.invoices i on i.id = w.invoice_id
    where i.customer_id = p_survivor_customer_id
      and coalesce(w.status, 'active') is distinct from 'void';
  end if;

  if round(v_before_inv, 2) is distinct from round(v_after_inv, 2)
     or round(v_before_pay, 2) is distinct from round(v_after_pay, 2)
     or round(v_before_cred, 2) is distinct from round(v_after_cred, 2)
     or round(v_before_dep, 2) is distinct from round(v_after_dep, 2)
     or round(v_before_wo, 2) is distinct from round(v_after_wo, 2) then
    raise exception 'CUSTOMER_MERGE_FINANCIAL_DRIFT';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'survivor_customer_id', p_survivor_customer_id,
    'duplicate_customer_id', p_duplicate_customer_id,
    'pre_merge_counts', v_counts,
    'accounting_posting', false
  );

  insert into public.customer_merge_history (
    survivor_customer_id,
    duplicate_customer_id,
    performed_by,
    reason,
    chosen_fields,
    pre_merge_counts,
    idempotency_key,
    result
  ) values (
    p_survivor_customer_id,
    p_duplicate_customer_id,
    v_actor,
    v_reason,
    coalesce(p_chosen_fields, '{}'::jsonb),
    v_counts,
    v_key,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.merge_customer_records(uuid, uuid, jsonb, text, text) from public, anon;
grant execute on function public.merge_customer_records(uuid, uuid, jsonb, text, text)
  to authenticated;
grant execute on function public.merge_customer_records(uuid, uuid, jsonb, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6) Post-check markers (static CI). No data mutation. No posting enable.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.customer_duplicate_exclusions') is null then
    raise exception 'P0_0185_POSTCHECK: customer_duplicate_exclusions missing.';
  end if;
  if to_regclass('public.customer_merge_history') is null then
    raise exception 'P0_0185_POSTCHECK: customer_merge_history missing.';
  end if;
  if to_regprocedure('public.merge_customer_records(uuid,uuid,jsonb,text,text)') is null then
    raise exception 'P0_0185_POSTCHECK: merge_customer_records missing.';
  end if;
end $$;
