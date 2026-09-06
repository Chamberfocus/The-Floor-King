-- F6-P4: Inventory accounting — harden stock_movements as the single ledger.
-- Integrity-corrected revision (HOLD — DO NOT APPLY until owner review).
-- Moving weighted average + canonical inventory_carrying_value.
-- Posting stays OFF. Do NOT set posting_enabled / inventory_posting_enabled /
-- books_of_record / PITR flags.
--
-- FINAL GLOBAL LOCK ORDER (compatible with 0174/0175):
--   1) IDEMPOTENCY KEY   advisory 178 (when key present)
--   2) JOB               advisory 174 (installer_labor_lock_job)
--   3) SOURCE / PO LINE  purchase_orders + po_items FOR UPDATE
--   4) VENDOR INVOICE    advisory 176 when AP identity involved
--   5) PRODUCT / ROLL    advisory 177 + stock_rolls FOR UPDATE
--   6) AP BILL           advisory 175 when bill-linked
--   7) MOVEMENT          stock_movements row FOR UPDATE (reversals)
--   8) OUTBOX            enqueue_accounting_outbox_safe
--
-- Reversal MUST discover unlocked → acquire 1..6 → FOR UPDATE movement → drift check.
-- Never lock MOVEMENT before JOB/SOURCE/PRODUCT.
--
-- Valuation invariant (within 0.02 money / 0.0001 qty):
--   products.on_hand, inventory_carrying_value, avg_unit_cost
--   reconcile to append-only stock_movements economics.
--   When on_hand = 0 → carrying_value = 0 and avg_unit_cost = null (no phantom value).
--
-- Rolled goods: stock_rolls.remaining_qty is physical SoT; consume requires roll_id
-- and decrements the roll under lock. products.on_hand is a cached mirror.
-- Discrete goods: products.on_hand is operational cache updated only via GUC path.
--
-- Job returns: NET returnable = active pulls − active job returns (FIFO historical cost).
-- Reservations: job/line scoped from stock_movements (not aggregate products.reserved alone).

-- ===========================================================================
-- 1) Schema (BEFORE any function bodies that reference new cols)
-- ===========================================================================

alter table public.products
  add column if not exists avg_unit_cost numeric,
  add column if not exists inventory_carrying_value numeric not null default 0;

comment on column public.products.avg_unit_cost is
  'Cached moving average = carrying_value / on_hand when on_hand > 0; null when empty.';
comment on column public.products.inventory_carrying_value is
  'Canonical inventory asset carrying value. Must reconcile to movement economics.';

alter table public.stock_movements
  add column if not exists economic_date date,
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists po_id uuid,
  add column if not exists po_item_id uuid,
  add column if not exists bill_id uuid,
  add column if not exists extended_cost numeric,
  add column if not exists base_unit text,
  add column if not exists reversal_of uuid,
  add column if not exists reversed_by uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists idempotency_key text,
  add column if not exists legacy_review_required boolean not null default false,
  add column if not exists return_kind text,
  add column if not exists value_delta numeric;

alter table public.stock_movements drop constraint if exists stock_movements_po_id_fkey;
alter table public.stock_movements drop constraint if exists stock_movements_po_item_id_fkey;
alter table public.stock_movements drop constraint if exists stock_movements_bill_id_fkey;
alter table public.stock_movements drop constraint if exists stock_movements_reversal_of_fkey;
alter table public.stock_movements drop constraint if exists stock_movements_reversed_by_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stock_movements_po_id_fkey'
  ) then
    alter table public.stock_movements
      add constraint stock_movements_po_id_fkey
        foreign key (po_id) references public.purchase_orders (id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'stock_movements_po_item_id_fkey'
  ) then
    alter table public.stock_movements
      add constraint stock_movements_po_item_id_fkey
        foreign key (po_item_id) references public.po_items (id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'stock_movements_bill_id_fkey'
  ) then
    alter table public.stock_movements
      add constraint stock_movements_bill_id_fkey
        foreign key (bill_id) references public.bills (id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'stock_movements_reversal_of_fkey'
  ) then
    alter table public.stock_movements
      add constraint stock_movements_reversal_of_fkey
        foreign key (reversal_of) references public.stock_movements (id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'stock_movements_reversed_by_fkey'
  ) then
    alter table public.stock_movements
      add constraint stock_movements_reversed_by_fkey
        foreign key (reversed_by) references public.stock_movements (id) on delete restrict;
  end if;
end $$;

comment on column public.stock_movements.source_type is
  'Canonical movement provenance: po_receipt|manual_receive|job_pull|job_reserve|job_release|adjust|vendor_return|job_return|reversal|legacy';
comment on column public.stock_movements.value_delta is
  'Signed inventory carrying-value effect of this movement (append-only).';

update public.stock_movements
set source_type = 'legacy',
    economic_date = coalesce(economic_date, (created_at at time zone 'utc')::date),
    legacy_review_required = case
      when kind in ('receive', 'pull', 'adjust', 'return') and unit_cost is null then true
      else coalesce(legacy_review_required, false)
    end
where source_type is null;

update public.stock_movements
set extended_cost = round(abs(qty) * unit_cost, 2)
where extended_cost is null and unit_cost is not null and qty is not null;

update public.stock_movements
set value_delta = case
  when kind = 'receive' then coalesce(extended_cost, 0)
  when kind = 'pull' then -coalesce(extended_cost, 0)
  when kind = 'return' and coalesce(qty, 0) > 0 then coalesce(extended_cost, 0)
  when kind = 'return' and coalesce(qty, 0) < 0 then -coalesce(extended_cost, 0)
  when kind = 'adjust' and coalesce(qty, 0) > 0 then coalesce(extended_cost, 0)
  when kind = 'adjust' and coalesce(qty, 0) < 0 then -coalesce(extended_cost, 0)
  else coalesce(value_delta, 0)
end
where value_delta is null;

alter table public.stock_movements alter column source_type set default 'legacy';
alter table public.stock_movements alter column source_type set not null;

alter table public.stock_movements drop constraint if exists stock_movements_source_type_check;
alter table public.stock_movements
  add constraint stock_movements_source_type_check
  check (source_type in (
    'po_receipt', 'manual_receive', 'job_pull', 'job_reserve', 'job_release',
    'adjust', 'vendor_return', 'job_return', 'reversal', 'legacy'
  ));

alter table public.stock_movements drop constraint if exists stock_movements_return_kind_check;
alter table public.stock_movements
  add constraint stock_movements_return_kind_check
  check (return_kind is null or return_kind in ('vendor', 'job'));

create unique index if not exists stock_movements_idempotency_key_uidx
  on public.stock_movements (idempotency_key)
  where idempotency_key is not null;

create index if not exists stock_movements_po_item_idx
  on public.stock_movements (po_item_id)
  where po_item_id is not null;

create index if not exists stock_movements_job_product_kind_idx
  on public.stock_movements (job_id, product_id, kind)
  where job_id is not null;

create table if not exists public.inventory_action_idempotency (
  idempotency_key text not null,
  action text not null,
  context_hash text not null,
  result jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (idempotency_key),
  constraint inventory_action_idempotency_status_check
    check (status in ('pending', 'completed'))
);

create table if not exists public.inventory_return_allocations (
  id uuid primary key default gen_random_uuid(),
  return_movement_id uuid not null references public.stock_movements (id) on delete restrict,
  pull_movement_id uuid not null references public.stock_movements (id) on delete restrict,
  qty numeric not null,
  unit_cost numeric not null,
  extended_cost numeric not null,
  created_at timestamptz not null default now(),
  constraint inventory_return_allocations_qty_pos check (qty > 0),
  constraint inventory_return_allocations_cost_nonneg check (unit_cost >= 0 and extended_cost >= 0)
);

create index if not exists inventory_return_allocations_return_idx
  on public.inventory_return_allocations (return_movement_id);
create index if not exists inventory_return_allocations_pull_idx
  on public.inventory_return_allocations (pull_movement_id);

create or replace view public.stock_movements_ops
with (security_invoker = true)
as
select
  id, product_id, qty, kind, job_id, customer_id, note, created_by, created_at,
  roll_id, line_id, economic_date, source_type, source_id, po_id, po_item_id,
  return_kind, voided_at, reversal_of, reversed_by, legacy_review_required
from public.stock_movements;

comment on view public.stock_movements_ops is
  'Operational stock movement fields without unit_cost/extended_cost/value_delta.';

update public.products p
set inventory_carrying_value = round(coalesce(p.on_hand, 0) * coalesce(p.avg_unit_cost, 0), 2)
where coalesce(p.inventory_carrying_value, 0) = 0
  and coalesce(p.on_hand, 0) > 0
  and p.avg_unit_cost is not null;


-- ===========================================================================
-- 2) Helpers — money, qty, hash, balances, locks, valuation, job nets
-- ===========================================================================

create or replace function public.inv_text_is_nonfinite(p_text text)
returns boolean
language sql immutable set search_path = public
as $$ select p_text ~* '(nan|inf|infinity)'; $$;

create or replace function public.inv_norm_text(p text)
returns text language sql immutable set search_path = public
as $$ select nullif(btrim(coalesce(p, '')), ''); $$;

create or replace function public.inv_money_ok(p_amount numeric, p_allow_zero boolean default false)
returns numeric language plpgsql immutable set search_path = public as $$
begin
  if p_amount is null then raise exception 'INV_INVALID_AMOUNT: null.'; end if;
  if public.inv_text_is_nonfinite(p_amount::text) then
    raise exception 'INV_INVALID_AMOUNT: NaN/Infinity rejected.';
  end if;
  if p_amount < 0 then raise exception 'INV_INVALID_AMOUNT: negative amount rejected.'; end if;
  if not p_allow_zero and p_amount = 0 then
    raise exception 'INV_INVALID_AMOUNT: zero amount rejected.';
  end if;
  if round(p_amount, 2) <> p_amount then
    raise exception 'INV_INVALID_AMOUNT: more than two decimal places.';
  end if;
  return round(p_amount, 2);
end; $$;

create or replace function public.inv_qty_ok(p_qty numeric, p_allow_zero boolean default false)
returns numeric language plpgsql immutable set search_path = public as $$
begin
  if p_qty is null then raise exception 'INV_INVALID_QTY: null.'; end if;
  if public.inv_text_is_nonfinite(p_qty::text) then
    raise exception 'INV_INVALID_QTY: NaN/Infinity rejected.';
  end if;
  if p_qty < 0 then raise exception 'INV_INVALID_QTY: negative quantity rejected.'; end if;
  if not p_allow_zero and p_qty = 0 then
    raise exception 'INV_INVALID_QTY: zero quantity rejected.';
  end if;
  if round(p_qty, 4) <> p_qty then
    raise exception 'INV_INVALID_QTY: more than four decimal places.';
  end if;
  return round(p_qty, 4);
end; $$;

create or replace function public.inv_context_hash(p_action text, p_payload jsonb)
returns text language sql immutable set search_path = public as $$
  select md5(p_action || chr(31) || coalesce(p_payload::text, ''));
$$;

create or replace function public.inv_lock_idempotency(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or btrim(p_key) = '' then return; end if;
  perform pg_advisory_xact_lock(
    178,
    ('x' || substr(md5(p_key), 1, 8))::bit(32)::int
  );
end; $$;

create or replace function public.inv_begin_action(
  p_key text, p_action text, p_hash text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.inventory_action_idempotency%rowtype;
begin
  if p_key is null or btrim(p_key) = '' then
    return null;
  end if;
  perform public.inv_lock_idempotency(p_key);
  insert into public.inventory_action_idempotency (idempotency_key, action, context_hash, status)
  values (p_key, p_action, p_hash, 'pending')
  on conflict (idempotency_key) do nothing;

  select * into v from public.inventory_action_idempotency
  where idempotency_key = p_key for update;

  if v.action is distinct from p_action or v.context_hash is distinct from p_hash then
    raise exception 'IDEMPOTENCY_CONFLICT: key reused with different inventory context.'
      using errcode = 'P0001';
  end if;
  if v.status = 'completed' then
    return coalesce(v.result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;
  return null; -- pending claim owned by this tx
end; $$;

create or replace function public.inv_complete_action(
  p_key text, p_action text, p_hash text, p_result jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or btrim(p_key) = '' then
    return p_result;
  end if;
  update public.inventory_action_idempotency
  set result = p_result,
      status = 'completed',
      completed_at = now()
  where idempotency_key = p_key
    and action = p_action
    and context_hash = p_hash
    and status = 'pending';
  return p_result;
end; $$;

create or replace function public.inv_lock_product(p_product_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_product_id is null then return; end if;
  perform pg_advisory_xact_lock(
    177,
    ('x' || substr(md5(p_product_id::text), 1, 8))::bit(32)::int
  );
  perform 1 from public.products where id = p_product_id for update;
end; $$;

create or replace function public.inv_lock_products_sorted(p_a uuid, p_b uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_a is not null and p_b is not null and p_a = p_b then p_b := null; end if;
  if p_a is not null and p_b is not null then
    if p_a::text < p_b::text then
      perform public.inv_lock_product(p_a);
      perform public.inv_lock_product(p_b);
    else
      perform public.inv_lock_product(p_b);
      perform public.inv_lock_product(p_a);
    end if;
  elsif p_a is not null then
    perform public.inv_lock_product(p_a);
  elsif p_b is not null then
    perform public.inv_lock_product(p_b);
  end if;
end; $$;

create or replace function public.inv_lock_roll(p_roll_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_roll_id is null then return; end if;
  perform pg_advisory_xact_lock(
    177,
    ('x' || substr(md5('roll:' || p_roll_id::text), 1, 8))::bit(32)::int
  );
  perform 1 from public.stock_rolls where id = p_roll_id for update;
end; $$;

create or replace function public.inv_rolled_available(p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(remaining_qty), 0)::numeric
  from public.stock_rolls
  where product_id = p_product_id
    and status = 'available'
    and not (kind = 'remnant' and usable is false);
$$;

create or replace function public.inv_on_hand(p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(on_hand, 0)::numeric from public.products where id = p_product_id;
$$;

create or replace function public.inv_reserved(p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(reserved, 0)::numeric from public.products where id = p_product_id;
$$;

create or replace function public.inv_available(p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select greatest(
    coalesce((select on_hand from public.products where id = p_product_id), 0)
    - coalesce((select reserved from public.products where id = p_product_id), 0),
    0
  )::numeric;
$$;

-- INTERNAL ONLY: trusted avg-cost lookup for SECURITY DEFINER inventory writers.
-- Not executable by authenticated (see ACL revoke below). Staff-facing read is
-- public.inv_product_avg_cost (admin/office role check).
create or replace function public.inv_product_avg_cost_internal(p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select avg_unit_cost from public.products where id = p_product_id;
$$;

revoke all on function public.inv_product_avg_cost_internal(uuid) from public;
revoke all on function public.inv_product_avg_cost_internal(uuid) from anon;
revoke all on function public.inv_product_avg_cost_internal(uuid) from authenticated;
grant execute on function public.inv_product_avg_cost_internal(uuid) to service_role;

-- Cost-input trust boundary: warehouse may operate inventory but may NOT choose valuation.
-- Checks the business role of the resolved actor (works for JWT and service_role+p_created_by).
-- Returns NULL when no override; validated money when admin/office override authorized.
create or replace function public.inv_authorize_unit_cost_override(
  p_unit_cost numeric,
  p_actor uuid,
  p_purpose text default 'inventory mutation'
) returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_unit_cost is null then
    return null;
  end if;
  if p_actor is null then
    raise exception
      'INV_COST_OVERRIDE_FORBIDDEN: cannot authorize unit_cost override without actor for %.',
      p_purpose
      using errcode = 'P0001';
  end if;
  select role::text into v_role from public.profiles where id = p_actor;
  if coalesce(v_role, '') not in ('admin', 'office') then
    raise exception
      'INV_COST_OVERRIDE_FORBIDDEN: only admin/office may supply unit_cost for % (actor role=%).',
      p_purpose,
      coalesce(v_role, 'none')
      using errcode = 'P0001';
  end if;
  return public.inv_money_ok(p_unit_cost, true);
end;
$$;

revoke all on function public.inv_authorize_unit_cost_override(numeric, uuid, text) from public;
revoke all on function public.inv_authorize_unit_cost_override(numeric, uuid, text) from anon;
revoke all on function public.inv_authorize_unit_cost_override(numeric, uuid, text) from authenticated;
grant execute on function public.inv_authorize_unit_cost_override(numeric, uuid, text) to service_role;

create or replace function public.inv_carrying_value(p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(inventory_carrying_value, 0)::numeric from public.products where id = p_product_id;
$$;

create or replace function public.inv_on_hand_value(p_product_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select public.inv_carrying_value(p_product_id);
$$;

-- Active pull = not voided (formal reversal sets voided_at on original).
create or replace function public.inv_job_gross_consumed_qty(
  p_job_id uuid, p_product_id uuid default null
) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(abs(qty)), 0)::numeric
  from public.stock_movements
  where job_id = p_job_id
    and kind = 'pull'
    and voided_at is null
    and (p_product_id is null or product_id = p_product_id);
$$;

create or replace function public.inv_job_returned_qty(
  p_job_id uuid, p_product_id uuid default null
) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0)::numeric
  from public.stock_movements
  where job_id = p_job_id
    and kind = 'return'
    and source_type = 'job_return'
    and voided_at is null
    and (p_product_id is null or product_id = p_product_id);
$$;

create or replace function public.inv_job_net_returnable_qty(
  p_job_id uuid, p_product_id uuid
) returns numeric language sql stable security definer set search_path = public as $$
  select greatest(
    public.inv_job_gross_consumed_qty(p_job_id, p_product_id)
    - public.inv_job_returned_qty(p_job_id, p_product_id),
    0
  );
$$;

-- Back-compat alias used by earlier app expectations.
create or replace function public.inv_job_consumed_qty(
  p_job_id uuid, p_product_id uuid default null
) returns numeric language sql stable security definer set search_path = public as $$
  select public.inv_job_gross_consumed_qty(p_job_id, p_product_id)
       - public.inv_job_returned_qty(p_job_id, p_product_id);
$$;

create or replace function public.inv_job_net_material_actual(
  p_job_id uuid, p_product_id uuid default null
) returns numeric language sql stable security definer set search_path = public as $$
  select round((
    coalesce((
      select sum(coalesce(extended_cost, round(abs(qty) * coalesce(unit_cost, 0), 2)))
      from public.stock_movements
      where job_id = p_job_id and kind = 'pull' and voided_at is null
        and (p_product_id is null or product_id = p_product_id)
    ), 0)
    -
    coalesce((
      select sum(coalesce(extended_cost, round(abs(qty) * coalesce(unit_cost, 0), 2)))
      from public.stock_movements
      where job_id = p_job_id and kind = 'return' and source_type = 'job_return'
        and voided_at is null
        and (p_product_id is null or product_id = p_product_id)
    ), 0)
  )::numeric, 2);
$$;

create or replace function public.inv_job_consumed_value(
  p_job_id uuid, p_product_id uuid default null
) returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  perform public.accounting_require_roles(array['admin','office'], 'read job consumed value');
  return public.inv_job_net_material_actual(p_job_id, p_product_id);
end; $$;

-- Job/line scoped reservation from movements (reserve + release − pulls).
create or replace function public.inv_job_line_reserved_qty(
  p_job_id uuid,
  p_product_id uuid,
  p_line_id uuid default null
) returns numeric language sql stable security definer set search_path = public as $$
  select greatest(0, coalesce((
    select sum(
      case
        when kind = 'reserve' then qty
        when kind = 'release' then qty  -- negative
        when kind = 'pull' then -abs(qty)
        else 0
      end
    )
    from public.stock_movements
    where job_id = p_job_id
      and product_id = p_product_id
      and voided_at is null
      and kind in ('reserve', 'release', 'pull')
      and (p_line_id is null or line_id is not distinct from p_line_id)
  ), 0));
$$;

create or replace function public.inv_po_item_received_qty(p_po_item_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0)::numeric
  from public.stock_movements
  where po_item_id = p_po_item_id
    and kind = 'receive'
    and voided_at is null;
$$;

create or replace function public.inv_reconcile_product_value(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_on numeric;
  v_carry numeric;
  v_avg numeric;
  v_derived numeric;
begin
  perform public.accounting_require_roles(array['admin','office'], 'reconcile product inventory value');
  select on_hand, inventory_carrying_value, avg_unit_cost
  into v_on, v_carry, v_avg
  from public.products where id = p_product_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Product not found.');
  end if;
  v_on := coalesce(v_on, 0);
  v_carry := coalesce(v_carry, 0);
  if abs(v_on) < 0.00005 then
    if abs(v_carry) > 0.02 or v_avg is not null then
      return jsonb_build_object(
        'ok', false, 'code', 'INV_VALUE_DRIFT',
        'error', 'Zero on-hand must have zero carrying value and null avg.'
      );
    end if;
    return jsonb_build_object('ok', true, 'on_hand', v_on, 'carrying_value', v_carry, 'avg_unit_cost', v_avg);
  end if;
  v_derived := round(v_carry / v_on, 4);
  if v_avg is null or abs(coalesce(v_avg, 0) - v_derived) > 0.00015 then
    return jsonb_build_object(
      'ok', false, 'code', 'INV_VALUE_DRIFT',
      'error', 'avg_unit_cost does not reconcile to carrying_value/on_hand.',
      'avg', v_avg, 'derived', v_derived
    );
  end if;
  return jsonb_build_object('ok', true, 'on_hand', v_on, 'carrying_value', v_carry, 'avg_unit_cost', v_avg);
end; $$;

create or replace function public.inv_apply_value_effect(
  p_product_id uuid,
  p_qty_delta numeric,
  p_value_delta numeric,
  p_update_on_hand boolean,
  p_canonical_on_hand numeric default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_on numeric;
  v_carry numeric;
  v_new_on numeric;
  v_new_carry numeric;
  v_avg numeric;
  v_phys numeric;
begin
  select on_hand, inventory_carrying_value into v_on, v_carry
  from public.products where id = p_product_id for update;
  if not found then raise exception 'INV_PRODUCT_NOT_FOUND'; end if;

  -- Financial carrying value always moves with the movement economics.
  v_new_carry := round(coalesce(v_carry, 0) + coalesce(p_value_delta, 0), 2);

  if p_update_on_hand then
    v_new_on := round(coalesce(v_on, 0) + coalesce(p_qty_delta, 0), 4);
    if p_qty_delta < 0 and v_new_on < -0.00005 then
      raise exception 'INV_NEGATIVE_STOCK: insufficient on-hand (have %, need %).',
        coalesce(v_on, 0), abs(p_qty_delta);
    end if;
  else
    -- Rolled / deferred qty sync: do not mutate on_hand cache here.
    v_new_on := coalesce(v_on, 0);
  end if;

  -- Physical basis for average: explicit canonical qty when provided (rolled),
  -- else the on-hand we just computed (discrete).
  v_phys := coalesce(p_canonical_on_hand, case when p_update_on_hand then v_new_on else null end);

  if v_phys is not null then
    if abs(v_phys) < 0.00005 then
      v_phys := 0;
      v_new_carry := 0;
      v_avg := null;
    else
      if v_new_carry < -0.02 then
        -- Fail-closed; never interpolate carrying dollars (warehouse-reachable via outer RPCs).
        raise exception 'INV_NEGATIVE_VALUE: inventory valuation integrity check failed.'
          using errcode = 'P0001';
      end if;
      if v_new_carry < 0 then v_new_carry := 0; end if;
      v_avg := round(v_new_carry / v_phys, 4);
    end if;
  else
    -- Value-only update pending qty sync: keep prior avg temporarily; sync finalizes.
    if v_new_carry < -0.02 then
      raise exception 'INV_NEGATIVE_VALUE: inventory valuation integrity check failed.'
        using errcode = 'P0001';
    end if;
    if v_new_carry < 0 then v_new_carry := 0; end if;
    v_avg := (select avg_unit_cost from public.products where id = p_product_id);
  end if;

  update public.products
  set on_hand = case when p_update_on_hand then coalesce(v_phys, v_new_on) else on_hand end,
      inventory_carrying_value = v_new_carry,
      avg_unit_cost = case when v_phys is not null then v_avg else avg_unit_cost end,
      last_movement_at = now()
  where id = p_product_id;
end; $$;

create or replace function public.inv_record_outbox(
  p_source_type text,
  p_source_id uuid,
  p_event_kind text,
  p_payload jsonb,
  p_review boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.enqueue_accounting_outbox_safe(
    p_source_type, p_source_id, p_event_kind, p_payload, p_review
  );
end; $$;

create or replace function public.inv_sync_rolled_on_hand_safe(
  p_product_id uuid,
  p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_carry numeric;
  v_avg numeric;
begin
  -- PHYSICAL quantity synchronization ONLY.
  -- Must NOT rewrite inventory_carrying_value from on_hand × avg.
  -- Financial value changes flow exclusively through valued movements / value_delta.
  perform public.accounting_require_roles(
    array['admin','office','warehouse'], 'sync rolled on-hand'
  );
  perform public.inv_lock_product(p_product_id);
  v_total := round(public.inv_rolled_available(p_product_id), 4);
  select inventory_carrying_value into v_carry
  from public.products where id = p_product_id for update;

  if abs(v_total) < 0.00005 then
    v_total := 0;
    -- Zero physical stock: carrying must already be zero from movement economics.
    if abs(coalesce(v_carry, 0)) > 0.02 then
      -- Do not reveal carrying dollar amount to warehouse-accessible callers.
      raise exception 'INV_VALUE_DRIFT: rolled on-hand is 0 but carrying value remains non-zero.'
        using errcode = 'P0001';
    end if;
    v_carry := 0;
    v_avg := null;
  else
    v_avg := round(coalesce(v_carry, 0) / v_total, 4);
  end if;

  perform set_config('app.inventory_mutation', 'true', true);
  update public.products
  set on_hand = v_total,
      -- derive avg from EXISTING carrying value; do not invent/destroy value
      avg_unit_cost = v_avg,
      inventory_carrying_value = coalesce(v_carry, 0),
      last_movement_at = now()
  where id = p_product_id;
  perform set_config('app.inventory_mutation', 'false', true);
  -- Operational response only — never return carrying_value / avg_unit_cost here.
  return jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'on_hand', v_total
  );
end; $$;

-- Finalize rolled valuation after roll qty + value_delta are both applied.
create or replace function public.inv_finalize_rolled_valuation(
  p_product_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phys numeric;
  v_carry numeric;
  v_avg numeric;
begin
  perform public.inv_lock_product(p_product_id);
  v_phys := round(public.inv_rolled_available(p_product_id), 4);
  select inventory_carrying_value into v_carry
  from public.products where id = p_product_id for update;
  if abs(v_phys) < 0.00005 then
    v_phys := 0;
    v_carry := 0;
    v_avg := null;
  else
    if coalesce(v_carry, 0) < -0.02 then
      -- Nested via rolled warehouse mutations — do not disclose carrying amount.
      raise exception 'INV_NEGATIVE_VALUE: inventory valuation integrity check failed.'
        using errcode = 'P0001';
    end if;
    if coalesce(v_carry, 0) < 0 then v_carry := 0; end if;
    v_avg := round(v_carry / v_phys, 4);
  end if;
  perform set_config('app.inventory_mutation', 'true', true);
  update public.products
  set on_hand = v_phys,
      inventory_carrying_value = coalesce(v_carry, 0),
      avg_unit_cost = v_avg,
      last_movement_at = now()
  where id = p_product_id;
  perform set_config('app.inventory_mutation', 'false', true);
  return jsonb_build_object('ok', true, 'on_hand', v_phys, 'carrying_value', coalesce(v_carry, 0), 'avg_unit_cost', v_avg);
end; $$;

-- ===========================================================================
-- 3) Core mutation — inv_apply_movement (GUC + locks + value)
-- ===========================================================================

create or replace function public.inv_apply_movement(
  p_product_id uuid,
  p_signed_qty numeric,
  p_kind text,
  p_source_type text,
  p_unit_cost numeric default null,
  p_job_id uuid default null,
  p_customer_id uuid default null,
  p_note text default null,
  p_po_id uuid default null,
  p_po_item_id uuid default null,
  p_bill_id uuid default null,
  p_source_id uuid default null,
  p_roll_id uuid default null,
  p_line_id uuid default null,
  p_economic_date date default null,
  p_return_kind text default null,
  p_idempotency_key text default null,
  p_actor uuid default null,
  p_reversal_of uuid default null,
  p_update_on_hand boolean default true,
  p_update_reserved_delta numeric default null,
  p_value_delta numeric default null,
  p_check_negative boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_on numeric;
  v_res numeric;
  v_cost numeric;
  v_ext numeric;
  v_econ date;
  v_actor uuid;
  v_value numeric;
  v_kind text;
begin
  if p_kind not in ('receive', 'pull', 'adjust', 'return', 'reserve', 'release') then
    raise exception 'INV_KIND_INVALID: %', p_kind;
  end if;

  perform public.inv_lock_product(p_product_id);
  select on_hand, reserved, stock_kind into v_on, v_res, v_kind
  from public.products where id = p_product_id;
  if not found then raise exception 'INV_PRODUCT_NOT_FOUND'; end if;

  v_econ := coalesce(p_economic_date, (timezone('utc', now()))::date);
  v_actor := coalesce(p_actor, auth.uid());
  v_cost := p_unit_cost;
  if v_cost is not null then
    v_cost := public.inv_money_ok(v_cost, true);
  end if;
  v_ext := case when v_cost is null then null else round(abs(p_signed_qty) * v_cost, 2) end;
  v_value := coalesce(p_value_delta, case
    when p_kind in ('reserve', 'release') then 0
    when p_signed_qty > 0 then coalesce(v_ext, 0)
    when p_signed_qty < 0 then -coalesce(v_ext, 0)
    else 0
  end);

  -- Fail-closed negatives for on-hand reducing moves (discrete cache).
  if p_check_negative and p_update_on_hand and p_signed_qty < 0
     and (coalesce(v_on, 0) + p_signed_qty) < -0.00005 then
    raise exception 'INV_NEGATIVE_STOCK: insufficient on-hand (have %, need %).',
      coalesce(v_on, 0), abs(p_signed_qty);
  end if;
  if p_update_reserved_delta is not null
     and (coalesce(v_res, 0) + p_update_reserved_delta) < -0.00005 then
    raise exception 'INV_NEGATIVE_RESERVED: reserved cannot go negative.';
  end if;
  if coalesce(p_update_reserved_delta, 0) > 0
     and (coalesce(v_on, 0) - coalesce(v_res, 0)) + 0.00005 < p_update_reserved_delta then
    raise exception 'INV_OVER_RESERVE: available % < requested %.',
      (coalesce(v_on, 0) - coalesce(v_res, 0)), p_update_reserved_delta;
  end if;

  perform set_config('app.inventory_mutation', 'true', true);
  insert into public.stock_movements (
    product_id, qty, kind, job_id, customer_id, note, created_by,
    unit_cost, roll_id, line_id,
    economic_date, source_type, source_id, po_id, po_item_id, bill_id,
    extended_cost, return_kind, idempotency_key, reversal_of, value_delta
  ) values (
    p_product_id, p_signed_qty, p_kind, p_job_id, p_customer_id, public.inv_norm_text(p_note), v_actor,
    v_cost, p_roll_id, p_line_id,
    v_econ, p_source_type, p_source_id, p_po_id, p_po_item_id, p_bill_id,
    v_ext, p_return_kind, nullif(p_idempotency_key, ''), p_reversal_of, v_value
  ) returning id into v_id;

  if p_kind not in ('reserve', 'release') then
    perform public.inv_apply_value_effect(
      p_product_id, p_signed_qty, v_value, p_update_on_hand
    );
  elsif p_update_on_hand then
    update public.products
    set on_hand = round(coalesce(on_hand, 0) + p_signed_qty, 4),
        last_movement_at = now()
    where id = p_product_id;
  end if;

  if p_update_reserved_delta is not null then
    update public.products
    set reserved = greatest(0, round(coalesce(reserved, 0) + p_update_reserved_delta, 4))
    where id = p_product_id;
  end if;

  if p_reversal_of is not null then
    update public.stock_movements
    set reversed_by = v_id,
        voided_at = coalesce(voided_at, now()),
        void_reason = coalesce(void_reason, 'reversed')
    where id = p_reversal_of;
  end if;
  perform set_config('app.inventory_mutation', 'false', true);
  return v_id;
end; $$;

-- FIFO historical cost layers for a job return.
create or replace function public.inv_plan_job_return_allocations(
  p_job_id uuid,
  p_product_id uuid,
  p_qty numeric
) returns table (
  pull_movement_id uuid,
  alloc_qty numeric,
  unit_cost numeric,
  extended_cost numeric
) language plpgsql security definer set search_path = public as $$
declare
  v_need numeric := public.inv_qty_ok(p_qty, false);
  v_pull record;
  v_used numeric;
  v_remain numeric;
  v_take numeric;
begin
  for v_pull in
    select sm.id, abs(sm.qty) as pull_qty, coalesce(sm.unit_cost, 0) as uc, sm.created_at
    from public.stock_movements sm
    where sm.job_id = p_job_id
      and sm.product_id = p_product_id
      and sm.kind = 'pull'
      and sm.voided_at is null
    order by sm.created_at asc, sm.id asc
  loop
    select coalesce(sum(a.qty), 0) into v_used
    from public.inventory_return_allocations a
    join public.stock_movements r on r.id = a.return_movement_id
    where a.pull_movement_id = v_pull.id
      and r.voided_at is null;

    v_remain := v_pull.pull_qty - v_used;
    if v_remain <= 0.00005 then continue; end if;
    v_take := least(v_need, v_remain);
    pull_movement_id := v_pull.id;
    alloc_qty := round(v_take, 4);
    unit_cost := public.inv_money_ok(v_pull.uc, true);
    extended_cost := round(alloc_qty * unit_cost, 2);
    return next;
    v_need := round(v_need - v_take, 4);
    exit when v_need <= 0.00005;
  end loop;
  if v_need > 0.00005 then
    raise exception 'INV_RETURN_EXCEEDS_CONSUMED: insufficient historical pull layers (short %).', v_need;
  end if;
end; $$;

-- ===========================================================================
-- 4) Staff RPCs
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Staff RPCs — rolled physical + economic atomicity
-- ---------------------------------------------------------------------------

-- Drop prior overloads so unsafe signatures cannot remain callable.
drop function if exists public.receive_inventory_safe(uuid, numeric, numeric, text, uuid, uuid, date, uuid, text, uuid);
drop function if exists public.return_inventory_from_job_safe(uuid, numeric, uuid, text, date, text, uuid);
drop function if exists public.return_inventory_to_vendor_safe(uuid, numeric, text, uuid, text, date, text, uuid);
drop function if exists public.adjust_roll_inventory_safe(uuid, numeric, text, numeric, text, date, text, uuid);

create or replace function public.receive_inventory_safe(
  p_product_id uuid,
  p_qty numeric,
  p_unit_cost numeric default null,
  p_note text default null,
  p_po_id uuid default null,
  p_po_item_id uuid default null,
  p_economic_date date default null,
  p_job_id uuid default null,
  p_idempotency_key text default null,
  p_created_by uuid default null,
  p_roll_id uuid default null,
  p_create_roll boolean default false,
  p_roll_kind text default 'roll',
  p_roll_unit text default null,
  p_roll_width_ft numeric default null,
  p_roll_location text default null,
  p_source_roll_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_qty numeric; v_cost numeric; v_cost_override numeric; v_hash text; v_dup jsonb; v_id uuid;
  v_prod public.products%rowtype; v_src text; v_payload jsonb; v_review boolean := false;
  v_cost_override_used boolean := false;
  v_item public.po_items%rowtype; v_ordered numeric; v_already numeric;
  v_note text := public.inv_norm_text(p_note);
  v_econ date := coalesce(p_economic_date, (timezone('utc', now()))::date);
  v_roll_id uuid := p_roll_id;
  v_roll public.stock_rolls%rowtype;
  v_kind text;
  v_create boolean := coalesce(p_create_roll, false);
  v_roll_kind text := coalesce(nullif(p_roll_kind, ''), 'roll');
  v_unit text;
begin
  perform public.accounting_require_roles(array['admin','office','warehouse'], 'receive inventory');
  v_actor := public.accounting_actor_id(p_created_by);
  v_qty := public.inv_qty_ok(p_qty, false);
  -- Warehouse cannot supply valuation; admin/office override authorized only.
  begin
    v_cost_override := public.inv_authorize_unit_cost_override(p_unit_cost, v_actor, 'receive inventory');
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'INV_COST_OVERRIDE_FORBIDDEN');
  end;
  v_src := case when p_po_id is not null then 'po_receipt' else 'manual_receive' end;

  v_hash := public.inv_context_hash('receive_inventory', jsonb_build_object(
    'product_id', p_product_id, 'qty', v_qty, 'unit_cost', v_cost_override,
    'po_id', p_po_id, 'po_item_id', p_po_item_id, 'economic_date', v_econ,
    'job_id', p_job_id, 'note', v_note,
    'roll_id', v_roll_id, 'create_roll', v_create,
    'roll_kind', v_roll_kind, 'source_roll_id', p_source_roll_id,
    'roll_unit', p_roll_unit, 'roll_width_ft', p_roll_width_ft, 'roll_location', p_roll_location
  ));
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'receive_inventory', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  if p_job_id is not null then perform public.installer_labor_lock_job(p_job_id); end if;

  if p_po_id is not null then
    perform 1 from public.purchase_orders where id = p_po_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'Purchase order not found.');
    end if;
  end if;
  if p_po_item_id is not null then
    select * into v_item from public.po_items where id = p_po_item_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'PO item not found.', 'code', 'INV_PO_ITEM_NOT_FOUND');
    end if;
    if p_po_id is not null and v_item.po_id is distinct from p_po_id then
      return jsonb_build_object('ok', false, 'error', 'PO item does not belong to PO.', 'code', 'INV_PO_ITEM_MISMATCH');
    end if;
    if v_item.product_id is distinct from p_product_id then
      return jsonb_build_object('ok', false, 'error', 'PO item product mismatch.', 'code', 'INV_PO_PRODUCT_MISMATCH');
    end if;
    v_ordered := coalesce(v_item.quantity, 0);
    v_already := public.inv_po_item_received_qty(p_po_item_id);
    if v_already + v_qty > v_ordered + 0.00005 then
      return jsonb_build_object(
        'ok', false, 'code', 'INV_OVER_RECEIVE',
        'error', format('Cumulative receipts %s + %s exceed ordered %s.', v_already, v_qty, v_ordered)
      );
    end if;
    -- Canonical PO line cost is SoT unless admin/office override authorized.
    if v_cost_override is not null then
      v_cost := v_cost_override;
      v_cost_override_used := true;
    elsif v_item.unit_cost is not null then
      v_cost := public.inv_money_ok(v_item.unit_cost, true);
    end if;
  end if;

  -- Non-PO / no line cost yet: admin override or leave null for avg fallback after product lock.
  if p_po_item_id is null then
    v_cost := v_cost_override;
    v_cost_override_used := v_cost_override is not null;
  end if;

  perform public.inv_lock_product(p_product_id);
  select * into v_prod from public.products where id = p_product_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Product not found.'); end if;
  if not coalesce(v_prod.track_stock, false) then
    return public.inv_complete_action(nullif(p_idempotency_key, ''), 'receive_inventory', v_hash,
      jsonb_build_object('ok', true, 'skipped', true, 'reason', 'Product does not track stock.'));
  end if;
  v_kind := coalesce(v_prod.stock_kind, 'discrete');

  if v_kind = 'rolled' then
    if v_roll_id is null and not v_create then
      return jsonb_build_object(
        'ok', false, 'code', 'INV_ROLL_REQUIRED',
        'error', 'Rolled receipt requires p_roll_id or p_create_roll=true with physical roll details.'
      );
    end if;
    if v_create then
      if v_roll_kind not in ('roll', 'remnant') then
        return jsonb_build_object('ok', false, 'error', 'Invalid roll kind.', 'code', 'INV_ROLL_KIND');
      end if;
      v_unit := coalesce(nullif(p_roll_unit, ''), v_prod.unit, 'sqyd');
      insert into public.stock_rolls (
        product_id, kind, unit, width_ft, initial_qty, remaining_qty,
        location, status, usable, needs_shelving, source_roll_id, source_po_id, job_id, created_by
      ) values (
        p_product_id, v_roll_kind, v_unit, p_roll_width_ft, v_qty, v_qty,
        public.inv_norm_text(p_roll_location), 'available',
        case when v_roll_kind = 'remnant' then null else true end,
        v_roll_kind = 'remnant',
        p_source_roll_id, p_po_id, p_job_id, v_actor
      ) returning id into v_roll_id;
    else
      perform public.inv_lock_roll(v_roll_id);
      select * into v_roll from public.stock_rolls where id = v_roll_id for update;
      if not found or v_roll.product_id is distinct from p_product_id then
        return jsonb_build_object('ok', false, 'error', 'Roll not found for product.', 'code', 'INV_ROLL_NOT_FOUND');
      end if;
      if v_roll.status = 'scrapped' then
        return jsonb_build_object('ok', false, 'error', 'Cannot receive onto scrapped roll.', 'code', 'INV_ROLL_UNAVAILABLE');
      end if;
      update public.stock_rolls
      set remaining_qty = round(coalesce(remaining_qty, 0) + v_qty, 4),
          initial_qty = greatest(coalesce(initial_qty, 0), round(coalesce(remaining_qty, 0) + v_qty, 4)),
          status = 'available'
      where id = v_roll_id;
    end if;
  end if;

  v_id := public.inv_apply_movement(
    p_product_id, v_qty, 'receive', v_src,
    coalesce(v_cost, v_prod.avg_unit_cost),
    p_job_id, null, v_note, p_po_id, p_po_item_id, null, p_po_item_id,
    v_roll_id, null, v_econ, null, p_idempotency_key, v_actor, null,
    v_kind is distinct from 'rolled',
    null,
    case when coalesce(v_cost, v_prod.avg_unit_cost) is null then 0
         else round(v_qty * coalesce(v_cost, v_prod.avg_unit_cost), 2) end,
    true
  );

  if v_kind = 'rolled' then
    perform public.inv_finalize_rolled_valuation(p_product_id);
  end if;

  if v_cost is null then v_review := true; end if;
  v_payload := jsonb_build_object(
    'schemaVersion', 1, 'eventKind', 'inventory_receipt',
    'economicEventDate', v_econ::text, 'sourceType', 'stock_movement', 'sourceId', v_id,
    'productId', p_product_id, 'quantity', v_qty,
    'unitCost', coalesce(v_cost, v_prod.avg_unit_cost),
    'poId', p_po_id, 'poItemId', p_po_item_id, 'rollId', v_roll_id,
    'rebuildStrategy', 'immutable_outbox_snapshot'
  );
  perform public.inv_record_outbox('stock_movement', v_id, 'inventory_receipt', v_payload, v_review);
  perform public.accounting_audit_from_definer_safe(
    'inventory_received', 'stock_movement', v_id, v_econ, null,
    jsonb_build_object(
      'movementId', v_id, 'productId', p_product_id, 'qty', v_qty, 'rollId', v_roll_id,
      'costOverride', v_cost_override_used, 'unitCost', coalesce(v_cost, v_prod.avg_unit_cost)
    ),
    v_actor, 'audit:inventory_receive:' || v_id::text
  );
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'receive_inventory', v_hash,
    jsonb_build_object('ok', true, 'movement_id', v_id, 'roll_id', v_roll_id, 'duplicate', false));
end; $$;

create or replace function public.reserve_inventory_safe(
  p_product_id uuid, p_qty numeric, p_job_id uuid,
  p_line_id uuid default null, p_note text default null,
  p_idempotency_key text default null, p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_qty numeric; v_hash text; v_dup jsonb; v_id uuid;
  v_note text := public.inv_norm_text(p_note);
begin
  perform public.accounting_require_roles(array['admin','office','warehouse'], 'reserve inventory');
  v_actor := public.accounting_actor_id(p_created_by);
  v_qty := public.inv_qty_ok(p_qty, false);
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'error', 'job_id required for reserve.');
  end if;
  v_hash := public.inv_context_hash('reserve_inventory', jsonb_build_object(
    'product_id', p_product_id, 'qty', v_qty, 'job_id', p_job_id,
    'line_id', p_line_id, 'note', v_note
  ));
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'reserve_inventory', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  perform public.installer_labor_lock_job(p_job_id);
  v_id := public.inv_apply_movement(
    p_product_id, v_qty, 'reserve', 'job_reserve',
    null, p_job_id, null, coalesce(v_note, 'Reserved'),
    null, null, null, p_line_id, null, p_line_id, null, null,
    p_idempotency_key, v_actor, null, false, v_qty, 0, true
  );
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'reserve_inventory', v_hash,
    jsonb_build_object('ok', true, 'movement_id', v_id, 'duplicate', false));
end; $$;

create or replace function public.release_inventory_safe(
  p_product_id uuid, p_qty numeric, p_job_id uuid,
  p_line_id uuid default null, p_note text default null,
  p_idempotency_key text default null, p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_qty numeric; v_hash text; v_dup jsonb; v_id uuid; v_owned numeric;
  v_note text := public.inv_norm_text(p_note);
begin
  perform public.accounting_require_roles(array['admin','office','warehouse'], 'release inventory');
  v_actor := public.accounting_actor_id(p_created_by);
  v_qty := public.inv_qty_ok(p_qty, false);
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'error', 'job_id required for release.');
  end if;
  v_hash := public.inv_context_hash('release_inventory', jsonb_build_object(
    'product_id', p_product_id, 'qty', v_qty, 'job_id', p_job_id,
    'line_id', p_line_id, 'note', v_note
  ));
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'release_inventory', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  perform public.installer_labor_lock_job(p_job_id);
  perform public.inv_lock_product(p_product_id);
  v_owned := public.inv_job_line_reserved_qty(p_job_id, p_product_id, p_line_id);
  if v_qty > v_owned + 0.00005 then
    return jsonb_build_object(
      'ok', false, 'code', 'INV_RELEASE_EXCEEDS_JOB_RESERVED',
      'error', format('Job/line reserved %s < release %s.', v_owned, v_qty)
    );
  end if;

  v_id := public.inv_apply_movement(
    p_product_id, -v_qty, 'release', 'job_release',
    null, p_job_id, null, coalesce(v_note, 'Released'),
    null, null, null, p_line_id, null, p_line_id, null, null,
    p_idempotency_key, v_actor, null, false, -v_qty, 0, true
  );
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'release_inventory', v_hash,
    jsonb_build_object('ok', true, 'movement_id', v_id, 'duplicate', false));
end; $$;

create or replace function public.consume_inventory_safe(
  p_product_id uuid,
  p_qty numeric,
  p_job_id uuid,
  p_line_id uuid default null,
  p_note text default null,
  p_economic_date date default null,
  p_idempotency_key text default null,
  p_created_by uuid default null,
  p_release_reserved boolean default true,
  p_roll_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_qty numeric; v_hash text; v_dup jsonb; v_id uuid;
  v_avg numeric; v_kind text; v_update_oh boolean; v_rel numeric; v_owned numeric;
  v_roll public.stock_rolls%rowtype; v_rolled_avail numeric;
  v_payload jsonb; v_acct uuid; v_cogs uuid; v_review boolean := false;
  v_note text := public.inv_norm_text(p_note);
  v_econ date := coalesce(p_economic_date, (timezone('utc', now()))::date);
begin
  perform public.accounting_require_roles(array['admin','office','warehouse'], 'consume inventory');
  v_actor := public.accounting_actor_id(p_created_by);
  v_qty := public.inv_qty_ok(p_qty, false);
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'error', 'job_id required for consumption.');
  end if;
  v_hash := public.inv_context_hash('consume_inventory', jsonb_build_object(
    'product_id', p_product_id, 'qty', v_qty, 'job_id', p_job_id,
    'line_id', p_line_id, 'economic_date', v_econ,
    'release_reserved', p_release_reserved, 'roll_id', p_roll_id, 'note', v_note
  ));
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'consume_inventory', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  perform public.installer_labor_lock_job(p_job_id);
  perform public.inv_lock_product(p_product_id);
  select avg_unit_cost, stock_kind into v_avg, v_kind from public.products where id = p_product_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Product not found.'); end if;

  if coalesce(v_kind, 'discrete') = 'rolled' then
    if p_roll_id is null then
      return jsonb_build_object('ok', false, 'error', 'roll_id required for rolled consumption.', 'code', 'INV_ROLL_REQUIRED');
    end if;
    perform public.inv_lock_roll(p_roll_id);
    select * into v_roll from public.stock_rolls where id = p_roll_id for update;
    if not found or v_roll.product_id is distinct from p_product_id then
      return jsonb_build_object('ok', false, 'error', 'Roll not found for product.', 'code', 'INV_ROLL_NOT_FOUND');
    end if;
    if v_roll.status is distinct from 'available' then
      return jsonb_build_object('ok', false, 'error', 'Roll not available.', 'code', 'INV_ROLL_UNAVAILABLE');
    end if;
    if coalesce(v_roll.remaining_qty, 0) + 0.00005 < v_qty then
      return jsonb_build_object(
        'ok', false, 'code', 'INV_NEGATIVE_STOCK',
        'error', format('Rolled remaining %s < consume %s.', v_roll.remaining_qty, v_qty)
      );
    end if;
    update public.stock_rolls
    set remaining_qty = round(remaining_qty - v_qty, 4),
        status = case when round(remaining_qty - v_qty, 4) <= 0 then 'depleted' else status end
    where id = p_roll_id;
    v_update_oh := false;
  else
    v_update_oh := true;
  end if;

  v_owned := public.inv_job_line_reserved_qty(p_job_id, p_product_id, p_line_id);
  v_rel := case
    when p_release_reserved then least(v_qty, v_owned)
    else 0
  end;

  v_id := public.inv_apply_movement(
    p_product_id, -v_qty, 'pull', 'job_pull',
    v_avg, p_job_id, null, v_note, null, null, null, p_line_id,
    p_roll_id, p_line_id, v_econ, null, p_idempotency_key, v_actor, null,
    v_update_oh,
    case when v_rel > 0 then -v_rel else null end,
    -round(v_qty * coalesce(v_avg, 0), 2),
    true
  );

  if coalesce(v_kind, 'discrete') = 'rolled' then
    perform public.inv_finalize_rolled_valuation(p_product_id);
  end if;

  select account_id into v_acct from public.accounting_account_mappings where mapping_key = 'inventory_asset';
  select account_id into v_cogs from public.accounting_account_mappings where mapping_key = 'material_cogs';
  if v_acct is null or v_cogs is null or v_avg is null then v_review := true; end if;
  v_payload := jsonb_build_object(
    'schemaVersion', 1, 'eventKind', 'inventory_consumption',
    'economicEventDate', v_econ::text, 'sourceType', 'stock_movement', 'sourceId', v_id,
    'productId', p_product_id, 'jobId', p_job_id, 'quantity', v_qty,
    'unitCost', v_avg, 'amount', round(v_qty * coalesce(v_avg, 0), 2),
    'inventoryAccountId', v_acct, 'cogsAccountId', v_cogs,
    'rollId', p_roll_id, 'rebuildStrategy', 'immutable_outbox_snapshot'
  );
  perform public.inv_record_outbox('stock_movement', v_id, 'inventory_consumption', v_payload, v_review);
  perform public.accounting_audit_from_definer_safe(
    'inventory_consumed', 'stock_movement', v_id, v_econ, null,
    jsonb_build_object('movementId', v_id, 'productId', p_product_id, 'qty', v_qty, 'jobId', p_job_id),
    v_actor, 'audit:inventory_consume:' || v_id::text
  );
  -- Operational response: no unit_cost / valuation (warehouse-safe shared contract).
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'consume_inventory', v_hash,
    jsonb_build_object(
      'ok', true,
      'movement_id', v_id,
      'product_id', p_product_id,
      'job_id', p_job_id,
      'qty', v_qty,
      'roll_id', p_roll_id,
      'duplicate', false
    ));
end; $$;

create or replace function public.adjust_inventory_safe(
  p_product_id uuid,
  p_counted_on_hand numeric,
  p_reason text,
  p_unit_cost numeric default null,
  p_note text default null,
  p_economic_date date default null,
  p_idempotency_key text default null,
  p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_on numeric; v_delta numeric; v_hash text; v_dup jsonb; v_id uuid;
  v_cost numeric; v_cost_input numeric; v_kind text; v_payload jsonb; v_val numeric;
  v_counted numeric;
  v_reason text := public.inv_norm_text(p_reason);
  v_note text := public.inv_norm_text(p_note);
  v_econ date := coalesce(p_economic_date, (timezone('utc', now()))::date);
  v_result jsonb;
begin
  -- 1) role / actor / basic input
  perform public.accounting_require_roles(array['admin','office','warehouse'], 'adjust inventory');
  v_actor := public.accounting_actor_id(p_created_by);
  if v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'Adjustment reason is required.');
  end if;
  v_counted := public.inv_qty_ok(p_counted_on_hand, true);
  begin
    v_cost_input := public.inv_authorize_unit_cost_override(p_unit_cost, v_actor, 'adjust inventory');
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'INV_COST_OVERRIDE_FORBIDDEN');
  end;

  -- Context hash uses COUNTED quantity + authorized override (admin/office only).
  -- Do NOT include a pre-lock delta (stale) — physical-count semantics are "set to counted".
  v_hash := public.inv_context_hash('adjust_inventory', jsonb_build_object(
    'product_id', p_product_id,
    'counted', v_counted,
    'reason', v_reason,
    'unit_cost', v_cost_input,
    'economic_date', v_econ,
    'note', v_note
  ));

  -- 2) idempotency advisory (global order: IDEMPOTENCY before PRODUCT)
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'adjust_inventory', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  -- 3–5) canonical product lock, then stock_kind / locked on_hand
  perform public.inv_lock_product(p_product_id);
  select stock_kind, on_hand
  into v_kind, v_on
  from public.products
  where id = p_product_id
  for update;
  if not found then
    v_result := jsonb_build_object('ok', false, 'error', 'Product not found.');
    return public.inv_complete_action(nullif(p_idempotency_key, ''), 'adjust_inventory', v_hash, v_result);
  end if;

  -- 6) rolled fail-closed (durable idempotent result)
  if coalesce(v_kind, 'discrete') = 'rolled' then
    v_result := jsonb_build_object(
      'ok', false,
      'code', 'INV_ROLL_ADJUST_REQUIRES_ROLL_WORKFLOW',
      'error', 'Rolled products require adjust_roll_inventory_safe (per-roll count). Aggregate product adjust is blocked.'
    );
    return public.inv_complete_action(nullif(p_idempotency_key, ''), 'adjust_inventory', v_hash, v_result);
  end if;

  -- 7–8) delta ONLY from locked current on_hand
  v_delta := round(v_counted - coalesce(v_on, 0), 4);
  if v_delta = 0 then
    -- Zero-delta no-op: complete idempotency so exact replay returns this result forever.
    v_result := jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'No quantity change.',
      'counted', v_counted,
      'on_hand', coalesce(v_on, 0),
      'delta', 0,
      'duplicate', false
    );
    return public.inv_complete_action(nullif(p_idempotency_key, ''), 'adjust_inventory', v_hash, v_result);
  end if;

  -- 9) trusted unit cost (after lock; avg from locked product path)
  v_cost := coalesce(v_cost_input, public.inv_product_avg_cost_internal(p_product_id));
  v_val := case when v_cost is null then 0 else round(abs(v_delta) * v_cost, 2) * sign(v_delta) end;

  -- 10–11) apply locked delta atomically (movement already holds product lock again)
  v_id := public.inv_apply_movement(
    p_product_id, v_delta, 'adjust', 'adjust',
    v_cost, null, null, coalesce(v_note, v_reason),
    null, null, null, null, null, null, v_econ, null,
    p_idempotency_key, v_actor, null, true, null, v_val, true
  );
  v_payload := jsonb_build_object(
    'schemaVersion', 1, 'eventKind', 'inventory_adjustment',
    'economicEventDate', v_econ::text, 'sourceType', 'stock_movement', 'sourceId', v_id,
    'productId', p_product_id, 'quantityDelta', v_delta, 'counted', v_counted, 'reason', v_reason
  );
  perform public.inv_record_outbox('stock_movement', v_id, 'inventory_adjustment', v_payload, v_cost is null);
  perform public.accounting_audit_from_definer_safe(
    'inventory_adjusted', 'stock_movement', v_id, v_econ, v_reason,
    jsonb_build_object(
      'movementId', v_id, 'delta', v_delta, 'counted', v_counted,
      'costOverride', v_cost_input is not null, 'unitCost', v_cost
    ),
    v_actor, 'audit:inventory_adjust:' || v_id::text
  );
  v_result := jsonb_build_object(
    'ok', true, 'movement_id', v_id, 'delta', v_delta, 'counted', v_counted, 'duplicate', false
  );
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'adjust_inventory', v_hash, v_result);
end; $$;

-- Roll-specific physical count / adjust (canonical rolled adjustment workflow).
create or replace function public.adjust_roll_inventory_safe(
  p_roll_id uuid,
  p_counted_remaining numeric,
  p_reason text,
  p_unit_cost numeric default null,
  p_note text default null,
  p_economic_date date default null,
  p_idempotency_key text default null,
  p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_roll public.stock_rolls%rowtype; v_counted numeric; v_delta numeric;
  v_hash text; v_dup jsonb; v_id uuid; v_cost numeric; v_cost_input numeric; v_val numeric;
  v_prod_id uuid;
  v_reason text := public.inv_norm_text(p_reason);
  v_note text := public.inv_norm_text(p_note);
  v_econ date := coalesce(p_economic_date, (timezone('utc', now()))::date);
begin
  perform public.accounting_require_roles(array['admin','office','warehouse'], 'adjust roll inventory');
  v_actor := public.accounting_actor_id(p_created_by);
  if v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'Adjustment reason is required.');
  end if;
  v_counted := public.inv_qty_ok(p_counted_remaining, true);
  begin
    v_cost_input := public.inv_authorize_unit_cost_override(p_unit_cost, v_actor, 'adjust roll inventory');
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'INV_COST_OVERRIDE_FORBIDDEN');
  end;
  v_hash := public.inv_context_hash('adjust_roll_inventory', jsonb_build_object(
    'roll_id', p_roll_id, 'counted', v_counted, 'reason', v_reason,
    'unit_cost', v_cost_input, 'economic_date', v_econ, 'note', v_note
  ));
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'adjust_roll_inventory', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  select product_id into v_prod_id from public.stock_rolls where id = p_roll_id;
  if not found then
    return public.inv_complete_action(
      nullif(p_idempotency_key, ''), 'adjust_roll_inventory', v_hash,
      jsonb_build_object('ok', false, 'error', 'Roll not found.', 'code', 'INV_ROLL_NOT_FOUND')
    );
  end if;
  -- Lock order: PRODUCT then ROLL, then re-read under FOR UPDATE before delta.
  perform public.inv_lock_product(v_prod_id);
  perform public.inv_lock_roll(p_roll_id);
  select * into v_roll from public.stock_rolls where id = p_roll_id for update;
  if not found then
    return public.inv_complete_action(
      nullif(p_idempotency_key, ''), 'adjust_roll_inventory', v_hash,
      jsonb_build_object('ok', false, 'error', 'Roll not found.', 'code', 'INV_ROLL_NOT_FOUND')
    );
  end if;
  if v_roll.product_id is distinct from v_prod_id then
    raise exception 'INV_LOCK_RETRY: roll product identity drifted; retry.';
  end if;
  if v_roll.status = 'scrapped' then
    return public.inv_complete_action(
      nullif(p_idempotency_key, ''), 'adjust_roll_inventory', v_hash,
      jsonb_build_object('ok', false, 'error', 'Cannot adjust scrapped roll.', 'code', 'INV_ROLL_UNAVAILABLE')
    );
  end if;
  -- Delta ONLY from locked remaining_qty
  v_delta := round(v_counted - coalesce(v_roll.remaining_qty, 0), 4);
  if v_delta = 0 then
    return public.inv_complete_action(nullif(p_idempotency_key, ''), 'adjust_roll_inventory', v_hash,
      jsonb_build_object(
        'ok', true, 'skipped', true, 'reason', 'No quantity change.',
        'counted', v_counted, 'remaining', coalesce(v_roll.remaining_qty, 0), 'delta', 0
      ));
  end if;
  v_cost := coalesce(v_cost_input, public.inv_product_avg_cost_internal(v_roll.product_id));
  update public.stock_rolls
  set remaining_qty = v_counted,
      status = case when v_counted <= 0 then 'depleted' else 'available' end
  where id = p_roll_id;
  v_val := case when v_cost is null then 0 else round(abs(v_delta) * v_cost, 2) * sign(v_delta) end;
  v_id := public.inv_apply_movement(
    v_roll.product_id, v_delta, 'adjust', 'adjust',
    v_cost, null, null, coalesce(v_note, v_reason),
    null, null, null, null, p_roll_id, null, v_econ, null,
    p_idempotency_key, v_actor, null, false, null, v_val, true
  );
  perform public.inv_finalize_rolled_valuation(v_roll.product_id);
  perform public.inv_record_outbox(
    'stock_movement', v_id, 'inventory_adjustment',
    jsonb_build_object(
      'schemaVersion', 1, 'eventKind', 'inventory_adjustment',
      'sourceType', 'stock_movement', 'sourceId', v_id,
      'productId', v_roll.product_id, 'rollId', p_roll_id,
      'quantityDelta', v_delta, 'reason', v_reason
    ),
    v_cost is null
  );
  perform public.accounting_audit_from_definer_safe(
    'inventory_adjusted', 'stock_movement', v_id, v_econ, v_reason,
    jsonb_build_object(
      'movementId', v_id, 'rollId', p_roll_id, 'delta', v_delta,
      'costOverride', v_cost_input is not null, 'unitCost', v_cost
    ),
    v_actor, 'audit:inventory_roll_adjust:' || v_id::text
  );
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'adjust_roll_inventory', v_hash,
    jsonb_build_object('ok', true, 'movement_id', v_id, 'roll_id', p_roll_id, 'delta', v_delta, 'duplicate', false));
end; $$;

create or replace function public.return_inventory_from_job_safe(
  p_product_id uuid,
  p_qty numeric,
  p_job_id uuid,
  p_note text default null,
  p_economic_date date default null,
  p_idempotency_key text default null,
  p_created_by uuid default null,
  p_roll_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_qty numeric; v_hash text; v_dup jsonb; v_id uuid;
  v_net numeric; v_ext numeric := 0; v_uc numeric; v_kind text;
  v_allocs jsonb := '[]'::jsonb;
  r record;
  v_note text := public.inv_norm_text(p_note);
  v_econ date := coalesce(p_economic_date, (timezone('utc', now()))::date);
  v_roll public.stock_rolls%rowtype;
begin
  perform public.accounting_require_roles(array['admin','office','warehouse'], 'return inventory from job');
  v_actor := public.accounting_actor_id(p_created_by);
  v_qty := public.inv_qty_ok(p_qty, false);
  v_hash := public.inv_context_hash('return_inventory_from_job', jsonb_build_object(
    'product_id', p_product_id, 'qty', v_qty, 'job_id', p_job_id,
    'economic_date', v_econ, 'note', v_note, 'roll_id', p_roll_id
  ));
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'return_inventory_from_job', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  perform public.installer_labor_lock_job(p_job_id);
  perform public.inv_lock_product(p_product_id);
  select stock_kind into v_kind from public.products where id = p_product_id for update;
  if coalesce(v_kind, 'discrete') = 'rolled' then
    if p_roll_id is null then
      return jsonb_build_object(
        'ok', false, 'code', 'INV_ROLL_REQUIRED',
        'error', 'Rolled job return requires destination p_roll_id (existing roll/remnant).'
      );
    end if;
    perform public.inv_lock_roll(p_roll_id);
    select * into v_roll from public.stock_rolls where id = p_roll_id for update;
    if not found or v_roll.product_id is distinct from p_product_id then
      return jsonb_build_object('ok', false, 'error', 'Destination roll not found for product.', 'code', 'INV_ROLL_NOT_FOUND');
    end if;
    if v_roll.status = 'scrapped' then
      return jsonb_build_object('ok', false, 'error', 'Cannot return onto scrapped roll.', 'code', 'INV_ROLL_UNAVAILABLE');
    end if;
  end if;

  v_net := public.inv_job_net_returnable_qty(p_job_id, p_product_id);
  if v_qty > v_net + 0.00005 then
    return jsonb_build_object(
      'ok', false, 'code', 'INV_RETURN_EXCEEDS_CONSUMED',
      'error', format('Cannot return more than net returnable (%s).', v_net)
    );
  end if;

  for r in select * from public.inv_plan_job_return_allocations(p_job_id, p_product_id, v_qty)
  loop
    v_allocs := v_allocs || jsonb_build_array(jsonb_build_object(
      'pull_movement_id', r.pull_movement_id,
      'qty', r.alloc_qty,
      'unit_cost', r.unit_cost,
      'extended_cost', r.extended_cost
    ));
    v_ext := round(v_ext + r.extended_cost, 2);
  end loop;
  v_uc := case when v_qty > 0 then round(v_ext / v_qty, 4) else 0 end;

  if coalesce(v_kind, 'discrete') = 'rolled' then
    update public.stock_rolls
    set remaining_qty = round(coalesce(remaining_qty, 0) + v_qty, 4),
        status = 'available'
    where id = p_roll_id;
  end if;

  v_id := public.inv_apply_movement(
    p_product_id, v_qty, 'return', 'job_return',
    v_uc, p_job_id, null, v_note, null, null, null, null,
    p_roll_id, null, v_econ, 'job', p_idempotency_key, v_actor, null,
    coalesce(v_kind, 'discrete') is distinct from 'rolled',
    null, v_ext, true
  );

  if coalesce(v_kind, 'discrete') = 'rolled' then
    perform public.inv_finalize_rolled_valuation(p_product_id);
  end if;

  insert into public.inventory_return_allocations (return_movement_id, pull_movement_id, qty, unit_cost, extended_cost)
  select v_id,
         (e->>'pull_movement_id')::uuid,
         (e->>'qty')::numeric,
         (e->>'unit_cost')::numeric,
         (e->>'extended_cost')::numeric
  from jsonb_array_elements(v_allocs) e;

  perform public.inv_record_outbox(
    'stock_movement', v_id, 'inventory_return_job',
    jsonb_build_object(
      'schemaVersion', 1, 'eventKind', 'inventory_return_job',
      'sourceType', 'stock_movement', 'sourceId', v_id,
      'productId', p_product_id, 'jobId', p_job_id, 'rollId', p_roll_id,
      'quantity', v_qty, 'unitCost', v_uc, 'amount', v_ext,
      'allocation', 'fifo_historical_pull', 'layers', v_allocs
    ),
    false
  );
  perform public.accounting_audit_from_definer_safe(
    'inventory_returned_job', 'stock_movement', v_id, v_econ, null,
    jsonb_build_object('movementId', v_id, 'qty', v_qty, 'historicalAmount', v_ext, 'rollId', p_roll_id),
    v_actor, 'audit:inventory_job_return:' || v_id::text
  );
  -- Operational response: no unit_cost / extended_cost / FIFO layers (warehouse-safe).
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'return_inventory_from_job', v_hash,
    jsonb_build_object(
      'ok', true,
      'movement_id', v_id,
      'product_id', p_product_id,
      'job_id', p_job_id,
      'qty', v_qty,
      'roll_id', p_roll_id,
      'duplicate', false
    ));
end; $$;

create or replace function public.return_inventory_to_vendor_safe(
  p_product_id uuid,
  p_qty numeric,
  p_reason text,
  p_po_id uuid default null,
  p_note text default null,
  p_economic_date date default null,
  p_idempotency_key text default null,
  p_created_by uuid default null,
  p_roll_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_qty numeric; v_hash text; v_dup jsonb; v_id uuid; v_avg numeric; v_kind text;
  v_reason text := public.inv_norm_text(p_reason);
  v_note text := public.inv_norm_text(p_note);
  v_econ date := coalesce(p_economic_date, (timezone('utc', now()))::date);
  v_roll public.stock_rolls%rowtype;
begin
  perform public.accounting_require_roles(array['admin','office'], 'return inventory to vendor');
  v_actor := public.accounting_actor_id(p_created_by);
  if v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'Vendor return reason is required.');
  end if;
  v_qty := public.inv_qty_ok(p_qty, false);
  v_hash := public.inv_context_hash('return_inventory_to_vendor', jsonb_build_object(
    'product_id', p_product_id, 'qty', v_qty, 'po_id', p_po_id,
    'reason', v_reason, 'economic_date', v_econ, 'note', v_note, 'roll_id', p_roll_id
  ));
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'return_inventory_to_vendor', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  if p_po_id is not null then
    perform 1 from public.purchase_orders where id = p_po_id for update;
  end if;
  perform public.inv_lock_product(p_product_id);
  select avg_unit_cost, stock_kind into v_avg, v_kind from public.products where id = p_product_id for update;
  if coalesce(v_kind, 'discrete') = 'rolled' then
    if p_roll_id is null then
      return jsonb_build_object('ok', false, 'code', 'INV_ROLL_REQUIRED',
        'error', 'Rolled vendor return requires p_roll_id of the physical roll leaving the warehouse.');
    end if;
    perform public.inv_lock_roll(p_roll_id);
    select * into v_roll from public.stock_rolls where id = p_roll_id for update;
    if not found or v_roll.product_id is distinct from p_product_id then
      return jsonb_build_object('ok', false, 'error', 'Roll not found for product.', 'code', 'INV_ROLL_NOT_FOUND');
    end if;
    if v_roll.status is distinct from 'available' then
      return jsonb_build_object('ok', false, 'error', 'Roll not available.', 'code', 'INV_ROLL_UNAVAILABLE');
    end if;
    if coalesce(v_roll.remaining_qty, 0) + 0.00005 < v_qty then
      return jsonb_build_object('ok', false, 'code', 'INV_NEGATIVE_STOCK',
        'error', format('Roll remaining %s < vendor return %s.', v_roll.remaining_qty, v_qty));
    end if;
    update public.stock_rolls
    set remaining_qty = round(remaining_qty - v_qty, 4),
        status = case when round(remaining_qty - v_qty, 4) <= 0 then 'depleted' else status end
    where id = p_roll_id;
  end if;

  v_id := public.inv_apply_movement(
    p_product_id, -v_qty, 'return', 'vendor_return',
    v_avg, null, null, coalesce(v_note, v_reason),
    p_po_id, null, null, null, p_roll_id, null, v_econ, 'vendor',
    p_idempotency_key, v_actor, null,
    coalesce(v_kind, 'discrete') is distinct from 'rolled',
    null, -round(v_qty * coalesce(v_avg, 0), 2), true
  );
  if coalesce(v_kind, 'discrete') = 'rolled' then
    perform public.inv_finalize_rolled_valuation(p_product_id);
  end if;
  perform public.inv_record_outbox(
    'stock_movement', v_id, 'inventory_return_vendor',
    jsonb_build_object(
      'schemaVersion', 1, 'eventKind', 'inventory_return_vendor',
      'sourceType', 'stock_movement', 'sourceId', v_id,
      'productId', p_product_id, 'quantity', v_qty, 'unitCost', v_avg,
      'poId', p_po_id, 'rollId', p_roll_id, 'apCreditStatus', 'deferred_vendor_credit'
    ),
    true
  );
  perform public.accounting_audit_from_definer_safe(
    'inventory_returned_vendor', 'stock_movement', v_id, v_econ, v_reason,
    jsonb_build_object('movementId', v_id, 'apCredit', 'deferred', 'rollId', p_roll_id),
    v_actor, 'audit:inventory_vendor_return:' || v_id::text
  );
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'return_inventory_to_vendor', v_hash,
    jsonb_build_object('ok', true, 'movement_id', v_id, 'ap_credit', 'deferred', 'roll_id', p_roll_id, 'duplicate', false));
end; $$;

create or replace function public.reverse_inventory_movement_safe(
  p_movement_id uuid,
  p_reason text,
  p_idempotency_key text default null,
  p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_m public.stock_movements%rowtype; v_hash text; v_dup jsonb; v_id uuid;
  v_res_delta numeric := null; v_update_oh boolean; v_kind text; v_value numeric;
  v_event text; v_payload jsonb;
  v_reason text := public.inv_norm_text(p_reason);
  v_d_job uuid; v_d_po uuid; v_d_poi uuid; v_d_bill uuid; v_d_prod uuid; v_d_roll uuid;
  v_roll public.stock_rolls%rowtype;
  v_need numeric;
begin
  perform public.accounting_require_roles(array['admin','office'], 'reverse inventory movement');
  v_actor := public.accounting_actor_id(p_created_by);
  if v_reason is null then
    return jsonb_build_object('ok', false, 'error', 'Reversal reason is required.');
  end if;
  v_hash := public.inv_context_hash('reverse_inventory_movement', jsonb_build_object(
    'movement_id', p_movement_id, 'reason', v_reason
  ));
  begin
    v_dup := public.inv_begin_action(nullif(p_idempotency_key, ''), 'reverse_inventory_movement', v_hash);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'IDEMPOTENCY_CONFLICT');
  end;
  if v_dup is not null then return v_dup; end if;

  -- A) UNLOCKED discovery
  select job_id, po_id, po_item_id, bill_id, product_id, roll_id
  into v_d_job, v_d_po, v_d_poi, v_d_bill, v_d_prod, v_d_roll
  from public.stock_movements
  where id = p_movement_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Movement not found.');
  end if;

  -- B) GLOBAL LOCK ORDER
  if v_d_job is not null then
    perform public.installer_labor_lock_job(v_d_job);
  end if;
  if v_d_po is not null then
    perform 1 from public.purchase_orders where id = v_d_po for update;
  end if;
  if v_d_poi is not null then
    perform 1 from public.po_items where id = v_d_poi for update;
  end if;
  perform public.inv_lock_product(v_d_prod);
  if v_d_roll is not null then
    perform public.inv_lock_roll(v_d_roll);
  end if;
  if v_d_bill is not null then
    perform public.ap_lock_bill(v_d_bill);
  end if;

  -- C) MOVEMENT FOR UPDATE
  select * into v_m from public.stock_movements where id = p_movement_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Movement not found.');
  end if;

  -- D) Drift check
  if v_m.job_id is distinct from v_d_job
     or v_m.po_id is distinct from v_d_po
     or v_m.po_item_id is distinct from v_d_poi
     or v_m.bill_id is distinct from v_d_bill
     or v_m.product_id is distinct from v_d_prod
     or v_m.roll_id is distinct from v_d_roll then
    raise exception 'INV_LOCK_RETRY: movement lock-driving identity drifted; retry.';
  end if;

  if v_m.reversed_by is not null or v_m.voided_at is not null then
    return jsonb_build_object('ok', false, 'error', 'Movement already reversed.', 'code', 'ALREADY_REVERSED');
  end if;

  select stock_kind into v_kind from public.products where id = v_m.product_id;
  v_update_oh := v_m.kind not in ('reserve', 'release')
    and coalesce(v_kind, 'discrete') is distinct from 'rolled';

  if v_m.kind = 'reserve' then
    v_res_delta := -abs(v_m.qty);
  elsif v_m.kind = 'release' then
    v_res_delta := abs(v_m.qty);
  end if;

  v_value := -coalesce(v_m.value_delta, 0);

  -- Rolled physical inverse BEFORE economic reverse (same txn); fail closed if unsafe.
  if coalesce(v_kind, 'discrete') = 'rolled' then
    if v_m.roll_id is null and v_m.kind in ('receive', 'pull', 'return', 'adjust')
       and v_m.kind is distinct from 'reserve' and v_m.kind is distinct from 'release' then
      return jsonb_build_object(
        'ok', false, 'code', 'INV_REVERSAL_UNSAFE',
        'error', 'Rolled movement lacks roll_id provenance; cannot safely reverse physically.'
      );
    end if;
    if v_m.roll_id is not null then
      select * into v_roll from public.stock_rolls where id = v_m.roll_id for update;
      if not found then
        return jsonb_build_object('ok', false, 'code', 'INV_REVERSAL_UNSAFE',
          'error', 'Original roll missing; cannot reverse.');
      end if;
      v_need := abs(v_m.qty);
      if v_m.kind = 'receive' or (v_m.kind = 'return' and v_m.source_type = 'job_return')
         or (v_m.kind = 'adjust' and v_m.qty > 0) then
        -- Physical inverse removes qty previously added
        if coalesce(v_roll.remaining_qty, 0) + 0.00005 < v_need then
          return jsonb_build_object(
            'ok', false, 'code', 'INV_REVERSAL_UNSAFE',
            'error', format(
              'Dependent history: roll remaining %s < reversal qty %s. Use corrective workflow.',
              v_roll.remaining_qty, v_need
            )
          );
        end if;
        update public.stock_rolls
        set remaining_qty = round(remaining_qty - v_need, 4),
            status = case when round(remaining_qty - v_need, 4) <= 0 then 'depleted' else status end
        where id = v_m.roll_id;
      elsif v_m.kind = 'pull'
         or (v_m.kind = 'return' and v_m.source_type = 'vendor_return')
         or (v_m.kind = 'adjust' and v_m.qty < 0) then
        -- Physical inverse restores qty previously removed
        update public.stock_rolls
        set remaining_qty = round(coalesce(remaining_qty, 0) + v_need, 4),
            status = 'available'
        where id = v_m.roll_id;
      end if;
    end if;
  end if;

  v_id := public.inv_apply_movement(
    v_m.product_id, -v_m.qty, v_m.kind, 'reversal',
    v_m.unit_cost, v_m.job_id, v_m.customer_id, v_reason,
    v_m.po_id, v_m.po_item_id, v_m.bill_id, v_m.source_id,
    v_m.roll_id, v_m.line_id, (timezone('utc', now()))::date, v_m.return_kind,
    p_idempotency_key, v_actor, p_movement_id,
    v_update_oh, v_res_delta, v_value, true
  );

  if coalesce(v_kind, 'discrete') = 'rolled' then
    perform public.inv_finalize_rolled_valuation(v_m.product_id);
  end if;

  v_event := case
    when v_m.source_type in ('po_receipt', 'manual_receive') then 'inventory_receipt_reversal'
    when v_m.source_type = 'job_pull' then 'inventory_consumption_reversal'
    when v_m.source_type = 'adjust' then 'inventory_adjustment_reversal'
    when v_m.source_type = 'job_return' then 'inventory_return_job_reversal'
    when v_m.source_type = 'vendor_return' then 'inventory_return_vendor_reversal'
    else 'inventory_reversal'
  end;
  v_payload := jsonb_build_object(
    'schemaVersion', 1, 'eventKind', v_event,
    'sourceType', 'stock_movement', 'sourceId', v_id,
    'reversalOf', p_movement_id,
    'productId', v_m.product_id, 'quantity', abs(v_m.qty),
    'unitCost', v_m.unit_cost, 'valueDelta', v_value,
    'rollId', v_m.roll_id,
    'originalEventHint', v_m.source_type,
    'rebuildStrategy', 'immutable_outbox_snapshot'
  );
  perform public.inv_record_outbox('stock_movement', v_id, v_event, v_payload, false);
  perform public.accounting_audit_from_definer_safe(
    'inventory_reversed', 'stock_movement', v_id,
    (timezone('utc', now()))::date, v_reason,
    jsonb_build_object('movementId', v_id, 'reversalOf', p_movement_id, 'valueDelta', v_value, 'rollId', v_m.roll_id),
    v_actor, 'audit:inventory_reverse:' || v_id::text
  );
  return public.inv_complete_action(nullif(p_idempotency_key, ''), 'reverse_inventory_movement', v_hash,
    jsonb_build_object('ok', true, 'movement_id', v_id, 'reversal_of', p_movement_id, 'duplicate', false));
end; $$;

create or replace function public.inv_flag_receipt_ap_variance_safe(
  p_po_id uuid, p_bill_id uuid, p_created_by uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_mismatches int := 0;
begin
  perform public.accounting_require_roles(array['admin','office'], 'flag inventory AP variance');
  v_actor := public.accounting_actor_id(p_created_by);
  perform 1 from public.purchase_orders where id = p_po_id for update;
  perform public.ap_lock_bill(p_bill_id);
  update public.stock_movements sm
  set legacy_review_required = true
  where sm.po_id = p_po_id
    and sm.kind = 'receive'
    and sm.voided_at is null
    and exists (
      select 1 from public.bill_items bi
      join public.bills b on b.id = bi.bill_id
      where b.id = p_bill_id and b.po_id = p_po_id
        and sm.unit_cost is not null and bi.unit_cost is not null
        and round(bi.unit_cost, 2) is distinct from round(sm.unit_cost, 2)
    );
  get diagnostics v_mismatches = row_count;
  return jsonb_build_object(
    'ok', true, 'flagged_movements', v_mismatches,
    'variance_policy', 'review_required_no_historical_rewrite'
  );
end; $$;

-- Quantity-safe movement list for warehouse (no costs).
create or replace function public.inv_list_movements_ops(
  p_product_id uuid, p_limit int default 100
) returns setof public.stock_movements_ops
language plpgsql security definer set search_path = public as $$
begin
  perform public.accounting_require_roles(
    array['admin','office','warehouse'], 'list inventory movements ops'
  );
  return query
  select *
  from public.stock_movements_ops
  where product_id = p_product_id
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end; $$;

-- Financial movement list (admin/office only).
create or replace function public.inv_list_movements_financial(
  p_product_id uuid, p_limit int default 100
) returns setof public.stock_movements
language plpgsql security definer set search_path = public as $$
begin
  perform public.accounting_require_roles(
    array['admin','office'], 'list inventory movements financial'
  );
  return query
  select *
  from public.stock_movements
  where product_id = p_product_id
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end; $$;

create or replace function public.inv_product_avg_cost(p_product_id uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  perform public.accounting_require_roles(array['admin','office'], 'read inventory avg cost');
  return (select avg_unit_cost from public.products where id = p_product_id);
end; $$;

create or replace function public.inv_carrying_value(p_product_id uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  perform public.accounting_require_roles(array['admin','office'], 'read inventory carrying value');
  return (select coalesce(inventory_carrying_value, 0)::numeric from public.products where id = p_product_id);
end; $$;

create or replace function public.inv_on_hand_value(p_product_id uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  perform public.accounting_require_roles(array['admin','office'], 'read inventory on-hand value');
  return public.inv_carrying_value(p_product_id);
end; $$;

create or replace function public.inv_job_net_material_actual(
  p_job_id uuid, p_product_id uuid default null
) returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  perform public.accounting_require_roles(array['admin','office'], 'read job material actual');
  return round((
    coalesce((
      select sum(coalesce(extended_cost, round(abs(qty) * coalesce(unit_cost, 0), 2)))
      from public.stock_movements
      where job_id = p_job_id and kind = 'pull' and voided_at is null
        and (p_product_id is null or product_id = p_product_id)
    ), 0)
    -
    coalesce((
      select sum(coalesce(extended_cost, round(abs(qty) * coalesce(unit_cost, 0), 2)))
      from public.stock_movements
      where job_id = p_job_id and kind = 'return' and source_type = 'job_return'
        and voided_at is null
        and (p_product_id is null or product_id = p_product_id)
    ), 0)
  )::numeric, 2);
end; $$;

create or replace function public.inv_job_consumed_value(
  p_job_id uuid, p_product_id uuid default null
) returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  perform public.accounting_require_roles(array['admin','office'], 'read job consumed value');
  return public.inv_job_net_material_actual(p_job_id, p_product_id);
end; $$;

-- ===========================================================================
-- 5) Immutability + products economic field protection
-- ===========================================================================

create or replace function public.stock_movements_enforce_immutability()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('app.inventory_mutation', true) is distinct from 'true' then
      raise exception 'INV_IMMUTABLE: stock movement history cannot be deleted.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if current_setting('app.inventory_mutation', true) is distinct from 'true' then
      if new.product_id is distinct from old.product_id
         or new.qty is distinct from old.qty
         or new.kind is distinct from old.kind
         or new.unit_cost is distinct from old.unit_cost
         or new.extended_cost is distinct from old.extended_cost
         or new.value_delta is distinct from old.value_delta
         or new.economic_date is distinct from old.economic_date
         or new.source_type is distinct from old.source_type
         or new.source_id is distinct from old.source_id
         or new.po_id is distinct from old.po_id
         or new.po_item_id is distinct from old.po_item_id
         or new.bill_id is distinct from old.bill_id
         or new.job_id is distinct from old.job_id
         or new.customer_id is distinct from old.customer_id
         or new.roll_id is distinct from old.roll_id
         or new.line_id is distinct from old.line_id
         or new.return_kind is distinct from old.return_kind
         or new.idempotency_key is distinct from old.idempotency_key
         or new.reversal_of is distinct from old.reversal_of
         or new.created_by is distinct from old.created_by then
        raise exception 'INV_IMMUTABLE: economic stock movement fields are immutable.';
      end if;
      -- Allow only review/void bookkeeping without GUC when not via RPC:
      -- still require GUC for void fields except legacy_review_required.
      if (new.reversed_by is distinct from old.reversed_by
          or new.voided_at is distinct from old.voided_at
          or new.void_reason is distinct from old.void_reason)
         and current_setting('app.inventory_mutation', true) is distinct from 'true' then
        raise exception 'INV_IMMUTABLE: void/reversal bookkeeping requires trusted inventory mutation path.';
      end if;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists stock_movements_enforce_immutability on public.stock_movements;
create trigger stock_movements_enforce_immutability
  before update or delete on public.stock_movements
  for each row execute function public.stock_movements_enforce_immutability();

create or replace function public.products_protect_inventory_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.inventory_mutation', true) is distinct from 'true' then
    if new.on_hand is distinct from old.on_hand
       or new.reserved is distinct from old.reserved
       or new.avg_unit_cost is distinct from old.avg_unit_cost
       or new.inventory_carrying_value is distinct from old.inventory_carrying_value then
      raise exception 'INV_PRODUCT_PROTECTED: on_hand/reserved/avg_unit_cost/carrying_value require inventory mutation path.';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists products_protect_inventory_fields on public.products;
create trigger products_protect_inventory_fields
  before update on public.products
  for each row execute function public.products_protect_inventory_fields();

-- ===========================================================================
-- 6) Privileges / RLS / cost visibility
-- ===========================================================================

revoke insert, update, delete on public.stock_movements from authenticated;
revoke select on public.stock_movements from authenticated;
grant select, insert, update, delete on public.stock_movements to service_role;

-- Admin/office may SELECT raw financial rows; warehouse must use ops RPC/view.
drop policy if exists stock_movements_staff on public.stock_movements;
drop policy if exists stock_movements_admin_office_select on public.stock_movements;
drop policy if exists stock_movements_warehouse_qty_select on public.stock_movements;

alter table public.stock_movements enable row level security;

create policy stock_movements_admin_office_select on public.stock_movements
  for select to authenticated
  using (public.user_role(auth.uid()) in ('admin', 'office'));

-- Grant SELECT only after policy: warehouse has no matching policy → no raw rows.
grant select on public.stock_movements to authenticated;

revoke all on public.inventory_action_idempotency from public, anon, authenticated;
grant all on public.inventory_action_idempotency to service_role;

revoke all on public.inventory_return_allocations from public, anon, authenticated;
grant select on public.inventory_return_allocations to authenticated;
grant all on public.inventory_return_allocations to service_role;

alter table public.inventory_return_allocations enable row level security;
drop policy if exists inventory_return_allocations_admin_office on public.inventory_return_allocations;
create policy inventory_return_allocations_admin_office on public.inventory_return_allocations
  for select to authenticated
  using (public.user_role(auth.uid()) in ('admin', 'office'));

grant select on public.stock_movements_ops to authenticated;
-- Ops view uses security_invoker: warehouse still cannot read base table.
-- Therefore warehouse must use inv_list_movements_ops (SECURITY DEFINER).

do $$
declare
  r record;
  v_staff text[] := array[
    'receive_inventory_safe',
    'reserve_inventory_safe',
    'release_inventory_safe',
    'consume_inventory_safe',
    'adjust_inventory_safe',
    'adjust_roll_inventory_safe',
    'return_inventory_from_job_safe',
    'return_inventory_to_vendor_safe',
    'reverse_inventory_movement_safe',
    'inv_flag_receipt_ap_variance_safe',
    'inv_sync_rolled_on_hand_safe',
    'inv_list_movements_ops',
    'inv_list_movements_financial',
    'inv_on_hand',
    'inv_reserved',
    'inv_available',
    'inv_product_avg_cost',
    'inv_carrying_value',
    'inv_on_hand_value',
    'inv_job_consumed_qty',
    'inv_job_consumed_value',
    'inv_job_gross_consumed_qty',
    'inv_job_returned_qty',
    'inv_job_net_returnable_qty',
    'inv_job_net_material_actual',
    'inv_job_line_reserved_qty',
    'inv_po_item_received_qty',
    'inv_reconcile_product_value',
    'inv_rolled_available'
  ];
  -- Cost-bearing reads: admin/office only via role check inside function;
  -- still grant execute to authenticated (function enforces roles).
  v_internal text[] := array[
    'inv_text_is_nonfinite',
    'inv_norm_text',
    'inv_money_ok',
    'inv_qty_ok',
    'inv_context_hash',
    'inv_lock_idempotency',
    'inv_begin_action',
    'inv_complete_action',
    'inv_lock_product',
    'inv_lock_products_sorted',
    'inv_lock_roll',
    'inv_apply_value_effect',
    'inv_apply_movement',
    'inv_plan_job_return_allocations',
    'inv_record_outbox',
    'stock_movements_enforce_immutability',
    'products_protect_inventory_fields',
    'inv_product_avg_cost_internal',
    'inv_authorize_unit_cost_override'
  ];
  v_all text[];
  v_name text;
begin
  foreach v_name in array v_staff loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    ) then
      raise exception 'INV_ACL_MISSING_STAFF_RPC: %', v_name;
    end if;
  end loop;

  v_all := v_staff || v_internal;
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (v_all)
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

-- ===========================================================================
-- 7) Warehouse DB-level cost isolation (NOT UI)
-- ===========================================================================
-- products.material_rate / labor_rate = OUR COST (catalog), not customer sell.
-- clearance_price = clearance sell; still sensitive — omit from warehouse ops.
-- Warehouse has no products RLS policy (is_staff/sales only). Still revoke
-- broad table SELECT and cost/rate columns so JWT+PostgREST cannot retrieve them.

revoke select on table public.products from authenticated;

revoke select on table public.products from authenticated;

-- Re-grant every products column EXCEPT inventory valuation (avg/carrying).
-- Catalog cost fields (material_rate/labor_rate) remain for admin/office/sales via RLS.
-- Warehouse has NO products SELECT RLS policy (is_staff / sales only) — JWT warehouse
-- cannot read products rows at all; ops view/RPC also omit rate + valuation columns.
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
  into v_cols
  from pg_attribute a
  where a.attrelid = 'public.products'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname not in ('avg_unit_cost', 'inventory_carrying_value');
  if v_cols is null or length(v_cols) = 0 then
    raise exception 'INV_PRODUCTS_ACL: no grantable products columns found';
  end if;
  execute format('grant select (%s) on public.products to authenticated', v_cols);
end $$;

-- Belt-and-suspenders: valuation columns must stay revoked for authenticated.
revoke select (avg_unit_cost, inventory_carrying_value) on public.products from authenticated;

create or replace view public.products_inventory_ops
as
select
  id, name, category, unit, sku, manufacturer, style, color,
  supplier, supplier_id, notes, active, track_stock, on_hand, on_order, reorder_point,
  bin_location, stock_kind, reserved, clearance,
  last_movement_at, created_at, updated_at
from public.products;

comment on view public.products_inventory_ops is
  'Operational product fields for inventory/warehouse. Excludes avg_unit_cost, inventory_carrying_value, material_rate, labor_rate, clearance_price (internal cost / financial).';

grant select on public.products_inventory_ops to authenticated;

-- Admin/office/sales catalog cost+sell rates (SECURITY DEFINER; not warehouse).
create or replace function public.inv_get_product_catalog_costs(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_mat numeric; v_lab numeric; v_clr numeric; v_avg numeric; v_carry numeric;
begin
  perform public.accounting_require_roles(
    array['admin','office','sales_manager','salesman'], 'read product catalog costs'
  );
  select material_rate, labor_rate, clearance_price, avg_unit_cost, inventory_carrying_value
  into v_mat, v_lab, v_clr, v_avg, v_carry
  from public.products where id = p_product_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Product not found.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'material_rate', v_mat,
    'labor_rate', v_lab,
    'clearance_price', v_clr,
    'avg_unit_cost', v_avg,
    'inventory_carrying_value', v_carry
  );
end; $$;

-- Warehouse may read operational inventory products via this view path.
-- Raw products cost columns remain revoked for authenticated.

create or replace function public.inv_list_inventory_products_ops(
  p_search text default null,
  p_limit int default 500
) returns setof public.products_inventory_ops
language plpgsql security definer set search_path = public as $$
declare
  v_like text;
begin
  perform public.accounting_require_roles(
    array['admin','office','warehouse'], 'list inventory products ops'
  );
  v_like := nullif(btrim(coalesce(p_search, '')), '');
  return query
  select *
  from public.products_inventory_ops p
  where p.track_stock = true
    and (
      v_like is null
      or p.name ilike '%' || v_like || '%'
      or coalesce(p.sku, '') ilike '%' || v_like || '%'
      or coalesce(p.manufacturer, '') ilike '%' || v_like || '%'
    )
  order by p.name
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
end; $$;

create or replace function public.inv_get_product_valuation(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_avg numeric;
  v_carry numeric;
  v_on numeric;
begin
  perform public.accounting_require_roles(
    array['admin','office'], 'read product inventory valuation'
  );
  select avg_unit_cost, inventory_carrying_value, on_hand
  into v_avg, v_carry, v_on
  from public.products where id = p_product_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Product not found.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'on_hand', coalesce(v_on, 0),
    'avg_unit_cost', v_avg,
    'inventory_carrying_value', coalesce(v_carry, 0)
  );
end; $$;

-- Warehouse must not execute financial product valuation / avg-cost RPCs
-- (already enforced inside functions). Prove financial movement list is admin/office.

do $$
declare
  r record;
  v_extra text[] := array[
    'inv_finalize_rolled_valuation',
    'inv_list_inventory_products_ops',
    'inv_get_product_catalog_costs',
    'inv_get_product_valuation'
  ];
  v_name text;
begin
  foreach v_name in array v_extra loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    ) then
      raise exception 'INV_ACL_MISSING_STAFF_RPC: %', v_name;
    end if;
  end loop;
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (v_extra)
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    if r.proname = 'inv_finalize_rolled_valuation' then
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    else
      execute format('revoke all on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

comment on function public.inv_product_avg_cost(uuid) is
  'Financial cost read — SECURITY DEFINER; admin/office only. Warehouse cannot execute successfully.';
