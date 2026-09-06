-- Step 6: immutable approval snapshots + approval audit + transactional line apply.
-- Safe to re-run. Does NOT backfill historical approval totals.

-- 1) Approval audit columns on estimates ------------------------------------
alter table public.estimates
  add column if not exists approved_at timestamptz,
  add column if not exists approval_source text,
  add column if not exists approved_by_user_id uuid references auth.users (id) on delete set null,
  add column if not exists approved_by_customer_id uuid references public.customers (id) on delete set null,
  add column if not exists current_approval_snapshot_id uuid,
  add column if not exists approval_stale boolean not null default false;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'estimates_approval_source_check'
  ) then
    alter table public.estimates
      add constraint estimates_approval_source_check
      check (approval_source is null or approval_source in ('staff', 'portal'));
  end if;
end $$;

comment on column public.estimates.approved_at is
  'When the current commercial approval was recorded. Null for legacy approved rows without audit.';
comment on column public.estimates.approval_stale is
  'True when live commercial content changed materially after the latest approval snapshot; needs reapproval.';

-- 2) Immutable approval snapshots -------------------------------------------
create table if not exists public.estimate_approval_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  estimate_id             uuid not null references public.estimates (id) on delete cascade,
  version                 int not null,
  accepted_option_id      uuid, -- historical reference; may no longer exist
  approved_at             timestamptz not null default now(),
  approval_source         text not null check (approval_source in ('staff', 'portal')),
  approved_by_user_id     uuid references auth.users (id) on delete set null,
  approved_by_customer_id uuid references public.customers (id) on delete set null,
  -- Full reconstructable customer-facing commercial payload (jsonb).
  -- Application never updates this column after insert.
  payload                 jsonb not null,
  created_at              timestamptz not null default now(),
  unique (estimate_id, version)
);

create index if not exists estimate_approval_snapshots_estimate_idx
  on public.estimate_approval_snapshots (estimate_id, version desc);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'estimates_current_approval_snapshot_fk'
  ) then
    alter table public.estimates
      add constraint estimates_current_approval_snapshot_fk
      foreign key (current_approval_snapshot_id)
      references public.estimate_approval_snapshots (id) on delete set null;
  end if;
end $$;

alter table public.estimate_approval_snapshots enable row level security;

-- Append-only for normal CRM operation: staff/portal may SELECT + INSERT.
-- No UPDATE/DELETE policies — PostgREST denies those for authenticated roles.
-- Service role bypasses RLS; triggers still block mutation/deletion.
drop policy if exists estimate_approval_snapshots_staff_all
  on public.estimate_approval_snapshots;
drop policy if exists estimate_approval_snapshots_staff_select
  on public.estimate_approval_snapshots;
drop policy if exists estimate_approval_snapshots_staff_insert
  on public.estimate_approval_snapshots;
create policy estimate_approval_snapshots_staff_select
  on public.estimate_approval_snapshots
  for select
  using (public.is_staff());
create policy estimate_approval_snapshots_staff_insert
  on public.estimate_approval_snapshots
  for insert
  with check (public.is_staff());

drop policy if exists estimate_approval_snapshots_portal_select
  on public.estimate_approval_snapshots;
create policy estimate_approval_snapshots_portal_select
  on public.estimate_approval_snapshots
  for select
  using (public.mine_estimate(estimate_id));

-- Block UPDATEs that would mutate historical payload / version identity.
create or replace function public.prevent_approval_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.estimate_id is distinct from old.estimate_id
       or new.version is distinct from old.version
       or new.payload is distinct from old.payload
       or new.accepted_option_id is distinct from old.accepted_option_id
       or new.approved_at is distinct from old.approved_at
       or new.approval_source is distinct from old.approval_source
       or new.approved_by_user_id is distinct from old.approved_by_user_id
       or new.approved_by_customer_id is distinct from old.approved_by_customer_id
    then
      raise exception 'estimate_approval_snapshots are immutable';
    end if;
  elsif tg_op = 'DELETE' then
    raise exception 'estimate_approval_snapshots are append-only; delete is not allowed';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists estimate_approval_snapshots_immutable
  on public.estimate_approval_snapshots;
create trigger estimate_approval_snapshots_immutable
  before update on public.estimate_approval_snapshots
  for each row execute function public.prevent_approval_snapshot_mutation();

drop trigger if exists estimate_approval_snapshots_no_delete
  on public.estimate_approval_snapshots;
create trigger estimate_approval_snapshots_no_delete
  before delete on public.estimate_approval_snapshots
  for each row execute function public.prevent_approval_snapshot_mutation();

-- 3) Atomic option line apply (Step 5 ownership + all-or-nothing) ------------
-- p_updates: [{ "id": "uuid", "row": { ...column values } }]
-- p_inserts: [{ ...column values including option_id/position }]
-- p_delete_ids: uuid[]
create or replace function public.apply_estimate_option_lines(
  p_option_id uuid,
  p_updates jsonb,
  p_inserts jsonb,
  p_delete_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  upd jsonb;
  ins jsonb;
  del_id uuid;
  row_id uuid;
  n_upd int := 0;
  n_ins int := 0;
  n_del int := 0;
  owned int;
begin
  if not public.is_staff() then
    raise exception 'not authorized';
  end if;

  if p_option_id is null then
    raise exception 'option_id required';
  end if;

  -- Deletes first within the same transaction (FK stock SET NULL as today).
  if p_delete_ids is not null then
    foreach del_id in array p_delete_ids loop
      select count(*) into owned
        from public.estimate_line_items
       where id = del_id and option_id = p_option_id;
      if owned = 0 then
        raise exception 'line id does not belong to option';
      end if;
      delete from public.estimate_line_items
       where id = del_id and option_id = p_option_id;
      n_del := n_del + 1;
    end loop;
  end if;

  if p_updates is not null then
    for upd in select * from jsonb_array_elements(p_updates) loop
      row_id := nullif(upd->>'id', '')::uuid;
      if row_id is null then
        raise exception 'update missing id';
      end if;
      select count(*) into owned
        from public.estimate_line_items
       where id = row_id and option_id = p_option_id;
      if owned = 0 then
        raise exception 'line id does not belong to option';
      end if;

      update public.estimate_line_items set
        position               = coalesce((upd->'row'->>'position')::int, position),
        room                   = nullif(upd->'row'->>'room', ''),
        description            = coalesce(upd->'row'->>'description', description),
        note                   = nullif(upd->'row'->>'note', ''),
        line_type              = coalesce((upd->'row'->>'line_type')::public.line_type, line_type),
        category               = case
                                   when upd->'row' ? 'category' and nullif(upd->'row'->>'category','') is null then null
                                   when nullif(upd->'row'->>'category','') is not null
                                     then (upd->'row'->>'category')::public.product_category
                                   else category
                                 end,
        sqft                   = nullif(upd->'row'->>'sqft', '')::numeric,
        length_in              = nullif(upd->'row'->>'length_in', '')::numeric,
        width_in               = nullif(upd->'row'->>'width_in', '')::numeric,
        measure_unit           = coalesce(nullif(upd->'row'->>'measure_unit', ''), measure_unit),
        material_rate          = nullif(upd->'row'->>'material_rate', '')::numeric,
        labor_rate             = nullif(upd->'row'->>'labor_rate', '')::numeric,
        installed_rate         = nullif(upd->'row'->>'installed_rate', '')::numeric,
        flat_amount            = nullif(upd->'row'->>'flat_amount', '')::numeric,
        waste_pct              = coalesce(nullif(upd->'row'->>'waste_pct', '')::numeric, 0),
        product_id             = nullif(upd->'row'->>'product_id', '')::uuid,
        manufacturer           = nullif(upd->'row'->>'manufacturer', ''),
        style                  = nullif(upd->'row'->>'style', ''),
        color                  = nullif(upd->'row'->>'color', ''),
        item_no                = nullif(upd->'row'->>'item_no', ''),
        material_cost          = nullif(upd->'row'->>'material_cost', '')::numeric,
        labor_cost             = nullif(upd->'row'->>'labor_cost', '')::numeric,
        quantity               = nullif(upd->'row'->>'quantity', '')::numeric,
        unit                   = nullif(upd->'row'->>'unit', ''),
        from_stock             = coalesce((upd->'row'->>'from_stock')::boolean, false),
        margin_pct             = nullif(upd->'row'->>'margin_pct', '')::numeric,
        order_as_roll          = coalesce((upd->'row'->>'order_as_roll')::boolean, false),
        roll_width_ft          = nullif(upd->'row'->>'roll_width_ft', '')::numeric,
        sqft_per_box           = nullif(upd->'row'->>'sqft_per_box', '')::numeric,
        is_fill                = coalesce((upd->'row'->>'is_fill')::boolean, false),
        is_optional            = coalesce((upd->'row'->>'is_optional')::boolean, false),
        coverage_sqft          = nullif(upd->'row'->>'coverage_sqft', '')::numeric,
        coverage_thickness_in  = nullif(upd->'row'->>'coverage_thickness_in', '')::numeric,
        prep_thickness_in      = nullif(upd->'row'->>'prep_thickness_in', '')::numeric,
        prep_key               = nullif(upd->'row'->>'prep_key', ''),
        measurements           = case
                                   when upd->'row'->'measurements' is null then null
                                   when jsonb_typeof(upd->'row'->'measurements') = 'null' then null
                                   else upd->'row'->'measurements'
                                 end
      where id = row_id and option_id = p_option_id;
      n_upd := n_upd + 1;
    end loop;
  end if;

  if p_inserts is not null then
    for ins in select * from jsonb_array_elements(p_inserts) loop
      insert into public.estimate_line_items (
        option_id, position, room, description, note, line_type, category,
        sqft, length_in, width_in, measure_unit,
        material_rate, labor_rate, installed_rate, flat_amount, waste_pct,
        product_id, manufacturer, style, color, item_no,
        material_cost, labor_cost, quantity, unit, from_stock, margin_pct,
        order_as_roll, roll_width_ft, sqft_per_box, is_fill, is_optional,
        coverage_sqft, coverage_thickness_in, prep_thickness_in, prep_key,
        measurements
      ) values (
        p_option_id,
        coalesce((ins->>'position')::int, 0),
        nullif(ins->>'room', ''),
        coalesce(ins->>'description', ''),
        nullif(ins->>'note', ''),
        coalesce((ins->>'line_type')::public.line_type, 'mat_labor'),
        case
          when nullif(ins->>'category', '') is null then null
          else (ins->>'category')::public.product_category
        end,
        nullif(ins->>'sqft', '')::numeric,
        nullif(ins->>'length_in', '')::numeric,
        nullif(ins->>'width_in', '')::numeric,
        coalesce(nullif(ins->>'measure_unit', ''), 'sqft'),
        nullif(ins->>'material_rate', '')::numeric,
        nullif(ins->>'labor_rate', '')::numeric,
        nullif(ins->>'installed_rate', '')::numeric,
        nullif(ins->>'flat_amount', '')::numeric,
        coalesce(nullif(ins->>'waste_pct', '')::numeric, 0),
        nullif(ins->>'product_id', '')::uuid,
        nullif(ins->>'manufacturer', ''),
        nullif(ins->>'style', ''),
        nullif(ins->>'color', ''),
        nullif(ins->>'item_no', ''),
        nullif(ins->>'material_cost', '')::numeric,
        nullif(ins->>'labor_cost', '')::numeric,
        nullif(ins->>'quantity', '')::numeric,
        nullif(ins->>'unit', ''),
        coalesce((ins->>'from_stock')::boolean, false),
        nullif(ins->>'margin_pct', '')::numeric,
        coalesce((ins->>'order_as_roll')::boolean, false),
        nullif(ins->>'roll_width_ft', '')::numeric,
        nullif(ins->>'sqft_per_box', '')::numeric,
        coalesce((ins->>'is_fill')::boolean, false),
        coalesce((ins->>'is_optional')::boolean, false),
        nullif(ins->>'coverage_sqft', '')::numeric,
        nullif(ins->>'coverage_thickness_in', '')::numeric,
        nullif(ins->>'prep_thickness_in', '')::numeric,
        nullif(ins->>'prep_key', ''),
        case
          when ins->'measurements' is null then null
          when jsonb_typeof(ins->'measurements') = 'null' then null
          else ins->'measurements'
        end
      );
      n_ins := n_ins + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'updated', n_upd,
    'inserted', n_ins,
    'deleted', n_del
  );
end;
$$;

revoke all on function public.apply_estimate_option_lines(uuid, jsonb, jsonb, uuid[]) from public;
grant execute on function public.apply_estimate_option_lines(uuid, jsonb, jsonb, uuid[]) to authenticated;

-- Legacy approved estimates: leave approved_at / snapshots NULL.
-- Do not fabricate historical totals.
