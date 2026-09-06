-- F7 launch integrity hardening (0178)
-- Scheduling exclusion, atomic estimate approval (live snapshot + portal trust),
-- approval idempotency, office_tasks field-level auth.
-- Safe to re-run. DOES NOT apply accounting activation.
-- Do NOT set posting_enabled / books_of_record / cutover / PITR flags.
-- DO NOT set posting_enabled
-- DO NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.
--
-- Lock order (must not reverse 0169–0177):
--   SCHEDULE: advisory(180, installer|crew hash) → set allow_job_schedule_mutation
--             → jobs FOR UPDATE (this job) → GiST EXCLUDE
--             Note: advisory(180) hash collisions only cause extra serialization
--             (never skip a lock / never allow a false-negative conflict).
--   APPROVAL: advisory(181, idempotency key hash) [when key provided]
--             → estimates FOR UPDATE → build live payload → insert snapshot
--             → update estimate → log_financial_audit_safe (exact-once by key)
--   TASKS:    RLS + column-protect trigger (no new advisory locks)
--   RECEIVING: unchanged 0176 order (PO → po_item → product); app uses delta qty
--
-- Scheduled inserts / assignee+date mutations MUST use schedule_job_install_safe
-- (or set app.allow_job_schedule_mutation). Direct INSERT with a schedule or
-- direct UPDATE of schedule columns is blocked by jobs_schedule_mutation_guard.
--
-- OWNER applies manually. Agent must NOT apply to production.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 0) Accounting safety precheck — refuse if flags flipped; never activate here.
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  if to_regclass('public.accounting_settings') is null then
    raise exception 'F7_0178_PRECHECK: accounting_settings missing — apply 0161–0177 first.';
  end if;
  select * into s from public.accounting_settings where id = 1;
  if not found then
    raise exception 'F7_0178_PRECHECK: accounting_settings row id=1 missing.';
  end if;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.inventory_posting_enabled, false)
     or coalesce(s.ap_posting_enabled, false)
     or coalesce(s.installer_posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or coalesce(s.opening_balances_entered, false)
     or coalesce(s.accountant_validated, false)
     or s.cutover_date is not null then
    raise exception
      'F7_0178_PRECHECK: accounting activation flags are not in the required OFF/NULL state. Aborting (no mutation of flags).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Installer / crew schedule exclusion (DB-enforced concurrency)
-- Inclusive daterange matches app dateRangesOverlap (end inclusive).
-- ---------------------------------------------------------------------------

-- 1a) Malformed ranges must be fixed before EXCLUDE can be added.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from public.jobs
  where scheduled_date is not null
    and scheduled_end is not null
    and scheduled_end < scheduled_date;

  if v_bad > 0 then
    raise exception
      'F7_0178_PRECHECK: % job(s) have scheduled_end < scheduled_date. Fix malformed ranges before applying.',
      v_bad;
  end if;
end $$;

-- 1b) Overlap precheck (existing conflicts block EXCLUDE create).
do $$
declare
  v_conflict_installer int;
  v_conflict_crew int;
begin
  select count(*) into v_conflict_installer
  from public.jobs a
  join public.jobs b
    on a.id < b.id
   and a.assigned_to is not null
   and a.assigned_to = b.assigned_to
   and a.scheduled_date is not null
   and b.scheduled_date is not null
   and a.status is distinct from 'cancelled'
   and b.status is distinct from 'cancelled'
   and daterange(a.scheduled_date, coalesce(a.scheduled_end, a.scheduled_date), '[]')
     && daterange(b.scheduled_date, coalesce(b.scheduled_end, b.scheduled_date), '[]');

  if v_conflict_installer > 0 then
    raise exception
      'F7_0178_PRECHECK: % overlapping active installer schedule pair(s) exist. Resolve before applying exclusion.',
      v_conflict_installer;
  end if;

  select count(*) into v_conflict_crew
  from public.jobs a
  join public.jobs b
    on a.id < b.id
   and a.assigned_crew_id is not null
   and a.assigned_crew_id = b.assigned_crew_id
   and a.scheduled_date is not null
   and b.scheduled_date is not null
   and a.status is distinct from 'cancelled'
   and b.status is distinct from 'cancelled'
   and daterange(a.scheduled_date, coalesce(a.scheduled_end, a.scheduled_date), '[]')
     && daterange(b.scheduled_date, coalesce(b.scheduled_end, b.scheduled_date), '[]');

  if v_conflict_crew > 0 then
    raise exception
      'F7_0178_PRECHECK: % overlapping active crew schedule pair(s) exist. Resolve before applying exclusion.',
      v_conflict_crew;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_installer_schedule_excl'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_installer_schedule_excl
      exclude using gist (
        assigned_to with =,
        daterange(scheduled_date, coalesce(scheduled_end, scheduled_date), '[]') with &&
      )
      where (
        assigned_to is not null
        and scheduled_date is not null
        and status is distinct from 'cancelled'
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_crew_schedule_excl'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_crew_schedule_excl
      exclude using gist (
        assigned_crew_id with =,
        daterange(scheduled_date, coalesce(scheduled_end, scheduled_date), '[]') with &&
      )
      where (
        assigned_crew_id is not null
        and scheduled_date is not null
        and status is distinct from 'cancelled'
      );
  end if;
end $$;

comment on constraint jobs_installer_schedule_excl on public.jobs is
  'F7/0178: concurrent same-installer overlapping inclusive date ranges cannot both commit.';
comment on constraint jobs_crew_schedule_excl on public.jobs is
  'F7/0178: concurrent same-crew overlapping inclusive date ranges cannot both commit.';

-- ---------------------------------------------------------------------------
-- 2) Schedule mutation guard — schedule/assign only via RPC (or allow flag)
-- ---------------------------------------------------------------------------
create or replace function public.jobs_schedule_mutation_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.allow_job_schedule_mutation', true) = 'true' then
    return new;
  end if;

  -- Unscheduled job create (board / claim pipeline).
  if tg_op = 'INSERT' and new.scheduled_date is null then
    return new;
  end if;

  -- Unassign / clear assignees without moving dates (claim-board helper path).
  if tg_op = 'UPDATE'
     and new.assigned_to is null
     and new.assigned_crew_id is null
     and new.scheduled_date is not distinct from old.scheduled_date
     and new.scheduled_end is not distinct from old.scheduled_end then
    return new;
  end if;

  -- Assign installer/crew while still undated (board assign before book).
  -- No schedule range ⇒ GiST EXCLUDE does not apply; allow without RPC.
  if tg_op = 'UPDATE'
     and old.scheduled_date is null
     and new.scheduled_date is null
     and old.scheduled_end is null
     and new.scheduled_end is null then
    return new;
  end if;

  -- Crew mirror sync for a login installer: dates + assigned_to unchanged.
  -- (bookInstall / assignInstaller attach install_crews row after schedule RPC.)
  if tg_op = 'UPDATE'
     and new.assigned_to is not null
     and new.assigned_to is not distinct from old.assigned_to
     and new.scheduled_date is not distinct from old.scheduled_date
     and new.scheduled_end is not distinct from old.scheduled_end then
    return new;
  end if;

  raise exception
    'JOB_SCHEDULE_VIA_RPC: scheduled inserts and schedule/assignee changes must use schedule_job_install_safe (or set app.allow_job_schedule_mutation).'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists jobs_schedule_mutation_guard on public.jobs;
create trigger jobs_schedule_mutation_guard
  before insert or update of assigned_to, assigned_crew_id, scheduled_date, scheduled_end
  on public.jobs
  for each row
  execute function public.jobs_schedule_mutation_guard();

revoke all on function public.jobs_schedule_mutation_guard() from public;
revoke all on function public.jobs_schedule_mutation_guard() from anon;
revoke all on function public.jobs_schedule_mutation_guard() from authenticated;
grant execute on function public.jobs_schedule_mutation_guard() to service_role;

comment on function public.jobs_schedule_mutation_guard() is
  'F7/0178: block direct schedule/assignee writes unless app.allow_job_schedule_mutation=true. Exceptions: unscheduled INSERT; UPDATE clearing both assignees with dates unchanged.';

-- ---------------------------------------------------------------------------
-- 3) schedule_job_install_safe — advisory serialize + row lock; EXCLUDE is SoT
-- Lock: advisory(180, hash) THEN allow flag THEN jobs FOR UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_job_install_safe(
  p_job_id uuid,
  p_scheduled_date date,
  p_scheduled_end date default null,
  p_assigned_to uuid default null,
  p_assigned_crew_id uuid default null,
  p_arrival_window text default null,
  p_set_arrival_window boolean default false,
  p_open_for_claim boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_jwt text := public.accounting_request_jwt_role();
  v_job public.jobs%rowtype;
  v_end date;
  v_lock_key int;
begin
  if p_job_id is null or p_scheduled_date is null then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_ARGS', 'error', 'job_id and scheduled_date are required.');
  end if;

  -- NULL end = single-day OK. Do NOT clamp inverted ranges — fail closed.
  if p_scheduled_end is not null and p_scheduled_end < p_scheduled_date then
    return jsonb_build_object(
      'ok', false,
      'code', 'SCHEDULE_INVALID_RANGE',
      'error', 'scheduled_end cannot be before scheduled_date.'
    );
  end if;
  v_end := p_scheduled_end;

  if p_assigned_to is not null and p_assigned_crew_id is not null then
    return jsonb_build_object(
      'ok', false, 'code', 'SCHEDULE_ASSIGNEE',
      'error', 'Assign either an installer or a crew, not both.'
    );
  end if;

  if v_uid is not null and v_jwt = 'authenticated' then
    v_role := coalesce(public.user_role(v_uid)::text, '');
    if v_role not in ('admin', 'office', 'sales_manager', 'salesman', 'scheduler') then
      return jsonb_build_object('ok', false, 'code', 'SCHEDULE_FORBIDDEN', 'error', 'Not authorized to schedule installs.');
    end if;
  elsif public.accounting_is_service_role() then
    null; -- trusted server actions
  else
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_AUTH', 'error', 'Authentication required.');
  end if;

  -- Serialize same installer/crew schedule mutations (defense in depth with EXCLUDE).
  -- Hash collisions only cause extra serialization — never skip locking.
  if p_assigned_to is not null then
    v_lock_key := hashtext(p_assigned_to::text);
    perform pg_advisory_xact_lock(180, v_lock_key);
  elsif p_assigned_crew_id is not null then
    v_lock_key := hashtext(p_assigned_crew_id::text);
    perform pg_advisory_xact_lock(180, v_lock_key);
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_JOB_NOT_FOUND', 'error', 'Job not found.');
  end if;
  if v_job.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'SCHEDULE_CANCELLED', 'error', 'Cannot schedule a cancelled job.');
  end if;

  perform set_config('app.allow_job_schedule_mutation', 'true', true);

  begin
    update public.jobs set
      assigned_to = p_assigned_to,
      assigned_crew_id = p_assigned_crew_id,
      scheduled_date = p_scheduled_date,
      scheduled_end = v_end,
      status = 'scheduled',
      open_for_claim = coalesce(p_open_for_claim, false),
      arrival_window = case
        when p_set_arrival_window then nullif(p_arrival_window, '')
        else arrival_window
      end,
      updated_at = now()
    where id = p_job_id;
  exception
    when exclusion_violation then
      perform set_config('app.allow_job_schedule_mutation', 'false', true);
      return jsonb_build_object(
        'ok', false,
        'code', 'SCHEDULE_CONFLICT',
        'error', 'The selected installer or crew is already booked on overlapping dates.'
      );
  end;

  perform set_config('app.allow_job_schedule_mutation', 'false', true);

  return jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'scheduled_date', p_scheduled_date,
    'scheduled_end', v_end,
    'assigned_to', p_assigned_to,
    'assigned_crew_id', p_assigned_crew_id
  );
end;
$$;

revoke all on function public.schedule_job_install_safe(
  uuid, date, date, uuid, uuid, text, boolean, boolean
) from public;
revoke all on function public.schedule_job_install_safe(
  uuid, date, date, uuid, uuid, text, boolean, boolean
) from anon;
grant execute on function public.schedule_job_install_safe(
  uuid, date, date, uuid, uuid, text, boolean, boolean
) to authenticated;
grant execute on function public.schedule_job_install_safe(
  uuid, date, date, uuid, uuid, text, boolean, boolean
) to service_role;

comment on function public.schedule_job_install_safe(uuid, date, date, uuid, uuid, text, boolean, boolean) is
  'F7/0178: atomic schedule update. Authoritative conflict = GiST EXCLUDE; advisory(180) serializes same assignee (hash collisions → extra serialization only). Sets app.allow_job_schedule_mutation.';

-- ---------------------------------------------------------------------------
-- 4) Approval commercial helpers — live DB snapshot (do not trust client payload)
-- Mirrors src/lib/estimate-calc.ts roughly; fail-closed / simple.
-- ---------------------------------------------------------------------------
create or replace function public.estimate_approval_num(p numeric)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
begin
  if p is null then return 0; end if;
  if p <> p then return 0; end if; -- NaN
  return p;
end;
$$;

create or replace function public.estimate_approval_is_count_unit(p_unit text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p_unit, '')), '') is null then false
    when lower(btrim(p_unit)) in ('sqft', 'sq ft', 'sf', 'sqyd', 'sq yd', 'sy', 'yd') then false
    when lower(btrim(p_unit)) like '%sq%ft%' or lower(btrim(p_unit)) like '%square%f%' then false
    when lower(btrim(p_unit)) like '%yd%' then false
    else true -- count-like (each/bag/lnft/…)
  end;
$$;

create or replace function public.estimate_approval_line_qty(
  p_unit text,
  p_quantity numeric,
  p_sqft numeric,
  p_length_in numeric,
  p_width_in numeric,
  p_measure_unit text default 'sqft'
) returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_area numeric;
  v_mu text := lower(coalesce(nullif(btrim(p_measure_unit), ''), 'sqft'));
begin
  if public.estimate_approval_is_count_unit(p_unit) then
    return public.estimate_approval_num(p_quantity);
  end if;

  v_area := public.estimate_approval_num(p_sqft);
  if v_area <= 0
     and public.estimate_approval_num(p_length_in) > 0
     and public.estimate_approval_num(p_width_in) > 0 then
    v_area := (public.estimate_approval_num(p_length_in) * public.estimate_approval_num(p_width_in)) / 144.0;
  end if;

  -- Label wins: unit sqyd / measure_unit sqyd → convert sqft total to sqyd.
  if v_area > 0 then
    if (p_unit is not null and lower(btrim(p_unit)) like '%yd%')
       or v_mu in ('sqyd', 'sy', 'yd') then
      if not (p_unit is not null and (
        lower(btrim(p_unit)) like '%sq%ft%'
        or lower(btrim(p_unit)) in ('sqft', 'sf', 'ft')
      )) then
        return round(v_area / 9.0, 4);
      end if;
    end if;
    return round(v_area, 4);
  end if;

  return public.estimate_approval_num(p_quantity);
end;
$$;

create or replace function public.estimate_approval_line_total(
  p_line_type text,
  p_category text,
  p_unit text,
  p_quantity numeric,
  p_sqft numeric,
  p_length_in numeric,
  p_width_in numeric,
  p_measure_unit text,
  p_material_rate numeric,
  p_labor_rate numeric,
  p_installed_rate numeric,
  p_flat_amount numeric,
  p_waste_pct numeric
) returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_qty numeric;
  v_waste numeric;
  v_labor_only boolean;
begin
  v_qty := public.estimate_approval_line_qty(
    p_unit, p_quantity, p_sqft, p_length_in, p_width_in, p_measure_unit
  );
  v_waste := 1 + (public.estimate_approval_num(p_waste_pct) / 100.0);
  v_labor_only := lower(coalesce(p_category, '')) = 'labor';

  case coalesce(p_line_type, '')
    when 'mat_labor' then
      return round(
        v_waste * (
          (case when v_labor_only then 0 else v_qty * public.estimate_approval_num(p_material_rate) end)
          + v_qty * public.estimate_approval_num(p_labor_rate)
        ),
        2
      );
    when 'installed' then
      return round(v_qty * public.estimate_approval_num(p_installed_rate) * v_waste, 2);
    when 'flat' then
      return round(public.estimate_approval_num(p_flat_amount), 2);
    else
      return 0;
  end case;
end;
$$;

create or replace function public.build_estimate_approval_payload_live(
  p_estimate_id uuid,
  p_option_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_est public.estimates%rowtype;
  v_opt public.estimate_options%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_line record;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_tax_rate numeric;
  v_disc_kind text;
  v_disc_val numeric;
  v_line_obj jsonb;
begin
  if p_estimate_id is null or p_option_id is null then
    raise exception 'APPROVAL_PAYLOAD_ARGS: estimate_id and option_id required.'
      using errcode = 'P0001';
  end if;

  select * into v_est from public.estimates where id = p_estimate_id;
  if not found then
    raise exception 'APPROVAL_NOT_FOUND: estimate missing.' using errcode = 'P0001';
  end if;

  select * into v_opt
  from public.estimate_options
  where id = p_option_id and estimate_id = p_estimate_id;
  if not found then
    raise exception 'APPROVAL_BAD_OPTION: option not on estimate.' using errcode = 'P0001';
  end if;

  for v_line in
    select *
    from public.estimate_line_items
    where option_id = p_option_id
    order by position asc, id asc
  loop
    v_line_total := public.estimate_approval_line_total(
      v_line.line_type::text,
      v_line.category::text,
      v_line.unit,
      v_line.quantity,
      v_line.sqft,
      v_line.length_in,
      v_line.width_in,
      v_line.measure_unit,
      v_line.material_rate,
      v_line.labor_rate,
      v_line.installed_rate,
      v_line.flat_amount,
      v_line.waste_pct
    );
    v_subtotal := v_subtotal + v_line_total;

    v_line_obj := jsonb_build_object(
      'id', v_line.id,
      'position', v_line.position,
      'room', v_line.room,
      'description', v_line.description,
      'note', v_line.note,
      'line_type', v_line.line_type,
      'category', v_line.category,
      'sqft', v_line.sqft,
      'length_in', v_line.length_in,
      'width_in', v_line.width_in,
      'measure_unit', v_line.measure_unit,
      'material_rate', v_line.material_rate,
      'labor_rate', v_line.labor_rate,
      'installed_rate', v_line.installed_rate,
      'flat_amount', v_line.flat_amount,
      'waste_pct', v_line.waste_pct,
      'product_id', v_line.product_id,
      'manufacturer', v_line.manufacturer,
      'style', v_line.style,
      'color', v_line.color,
      'item_no', v_line.item_no,
      'quantity', v_line.quantity,
      'unit', v_line.unit,
      'measurements', coalesce(v_line.measurements, 'null'::jsonb),
      'line_total', v_line_total
    );
    v_lines := v_lines || jsonb_build_array(v_line_obj);
  end loop;

  v_tax_rate := public.estimate_approval_num(v_est.tax_rate);
  v_disc_kind := case when v_est.discount_kind = 'percent' then 'percent' else 'amount' end;
  v_disc_val := public.estimate_approval_num(v_est.discount_value);

  if v_disc_val > 0 and v_subtotal > 0 then
    if v_disc_kind = 'percent' then
      v_discount := least(round((v_subtotal * v_disc_val) / 100.0, 2), v_subtotal);
    else
      v_discount := least(round(v_disc_val, 2), v_subtotal);
    end if;
  end if;

  v_tax := round((v_subtotal - v_discount) * (v_tax_rate / 100.0), 2);
  v_total := round((v_subtotal - v_discount) + v_tax, 2);
  v_subtotal := round(v_subtotal, 2);

  return jsonb_build_object(
    'schema_version', 1,
    'estimate_id', v_est.id,
    'customer_id', v_est.customer_id,
    'title', v_est.title,
    'presentation', coalesce(v_est.presentation, 'detailed'),
    'show_project_details', coalesce(v_est.show_project_details, true),
    'job_description', v_est.job_description,
    'notes', v_est.notes,
    'accepted_option_id', v_opt.id,
    'option', jsonb_build_object(
      'id', v_opt.id,
      'name', v_opt.name,
      'notes', v_opt.notes,
      'lines', v_lines
    ),
    'tax_rate', v_tax_rate,
    'discount_kind', v_disc_kind,
    'discount_value', v_disc_val,
    'discount_amount', v_discount,
    'subtotal', v_subtotal,
    'tax_amount', v_tax,
    'total', v_total
  );
end;
$$;

create or replace function public.estimate_approval_commercial_digest(p_payload jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select md5(
    coalesce(p_payload->>'accepted_option_id', '') || chr(31) ||
    coalesce(p_payload->>'tax_rate', '') || chr(31) ||
    coalesce(p_payload->>'discount_kind', '') || chr(31) ||
    coalesce(p_payload->>'discount_value', '') || chr(31) ||
    coalesce(p_payload->>'discount_amount', '') || chr(31) ||
    coalesce(p_payload->>'subtotal', '') || chr(31) ||
    coalesce(p_payload->>'tax_amount', '') || chr(31) ||
    coalesce(p_payload->>'total', '') || chr(31) ||
    coalesce((p_payload->'option'->'lines')::text, '[]')
  );
$$;

-- ---------------------------------------------------------------------------
-- 5) Approval idempotency (mirrors inventory_action_idempotency / inv_*)
-- ---------------------------------------------------------------------------
create table if not exists public.estimate_approval_idempotency (
  idempotency_key text not null,
  action text not null,
  context_hash text not null,
  result jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (idempotency_key),
  constraint estimate_approval_idempotency_status_check
    check (status in ('pending', 'completed'))
);

revoke all on table public.estimate_approval_idempotency from public, anon, authenticated;
grant all on table public.estimate_approval_idempotency to service_role;

create or replace function public.estimate_approval_lock_idempotency(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or btrim(p_key) = '' then return; end if;
  perform pg_advisory_xact_lock(
    181,
    ('x' || substr(md5(p_key), 1, 8))::bit(32)::int
  );
end;
$$;

create or replace function public.estimate_approval_begin_action(
  p_key text, p_action text, p_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.estimate_approval_idempotency%rowtype;
begin
  if p_key is null or btrim(p_key) = '' then
    return null;
  end if;
  perform public.estimate_approval_lock_idempotency(p_key);
  insert into public.estimate_approval_idempotency (idempotency_key, action, context_hash, status)
  values (p_key, p_action, p_hash, 'pending')
  on conflict (idempotency_key) do nothing;

  select * into v from public.estimate_approval_idempotency
  where idempotency_key = p_key for update;

  if v.action is distinct from p_action or v.context_hash is distinct from p_hash then
    raise exception 'IDEMPOTENCY_CONFLICT: key reused with different approval context.'
      using errcode = 'P0001';
  end if;
  if v.status = 'completed' then
    return coalesce(v.result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;
  return null; -- pending claim owned by this tx
end;
$$;

create or replace function public.estimate_approval_complete_action(
  p_key text, p_action text, p_hash text, p_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or btrim(p_key) = '' then
    return p_result;
  end if;
  update public.estimate_approval_idempotency
  set result = p_result,
      status = 'completed',
      completed_at = now()
  where idempotency_key = p_key
    and action = p_action
    and context_hash = p_hash
    and status = 'pending';
  return p_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) record_estimate_approval_safe — DROP old jsonb signature; live build only
-- ---------------------------------------------------------------------------
drop function if exists public.record_estimate_approval_safe(uuid, uuid, text, jsonb, uuid, uuid, text);

create or replace function public.record_estimate_approval_safe(
  p_estimate_id uuid,
  p_accepted_option_id uuid,
  p_approval_source text,
  p_approved_by_user_id uuid default null,
  p_approved_by_customer_id uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt text := public.accounting_request_jwt_role();
  v_role text;
  v_est public.estimates%rowtype;
  v_option_id uuid;
  v_next_version int;
  v_snap_id uuid;
  v_approved_at timestamptz := now();
  v_existing public.estimate_approval_snapshots%rowtype;
  v_portal_customer uuid;
  v_staff_actor uuid;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_payload jsonb;
  v_digest text;
  v_ctx_hash text;
  v_prior jsonb;
  v_result jsonb;
  v_action text := 'estimate_approve';
  v_audit_key text;
begin
  if p_estimate_id is null then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_ARGS', 'error', 'estimate_id required.');
  end if;
  if p_approval_source is null or p_approval_source not in ('staff', 'portal') then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_SOURCE', 'error', 'approval_source must be staff or portal.');
  end if;
  if v_key is not null and length(v_key) > 200 then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_IDEMPOTENCY_KEY', 'error', 'Idempotency key too long.');
  end if;

  -- ---- Actor / trust boundaries (before locks) ----
  if p_approval_source = 'portal' then
    -- Portal = Supabase Auth + my_customer_id(). NO opaque token. DENY service_role.
    if public.accounting_is_service_role() then
      return jsonb_build_object(
        'ok', false, 'code', 'APPROVAL_PORTAL_SERVICE_ROLE',
        'error', 'Portal approvals cannot use service_role.'
      );
    end if;
    if v_uid is null or v_jwt is distinct from 'authenticated' then
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_AUTH', 'error', 'Portal approval requires an authenticated customer session.');
    end if;
    v_portal_customer := public.my_customer_id();
    if v_portal_customer is null then
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_PORTAL_CUSTOMER', 'error', 'No customer linked to this account.');
    end if;
    -- Caller-supplied customer id is never proof; must match session or be omitted.
    if p_approved_by_customer_id is not null
       and p_approved_by_customer_id is distinct from v_portal_customer then
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_OWNERSHIP', 'error', 'That estimate is not available for approval.');
    end if;
  else
    -- staff
    if v_uid is not null and v_jwt = 'authenticated' then
      v_role := coalesce(public.user_role(v_uid)::text, '');
      if v_role not in ('admin', 'office', 'sales_manager', 'salesman') then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_FORBIDDEN', 'error', 'Not authorized to approve estimates.');
      end if;
      if p_approved_by_user_id is not null and p_approved_by_user_id is distinct from v_uid then
        return jsonb_build_object(
          'ok', false, 'code', 'APPROVAL_ACTOR_SPOOF',
          'error', 'Staff actor must match the authenticated user.'
        );
      end if;
      v_staff_actor := v_uid;
    elsif public.accounting_is_service_role() then
      if p_approved_by_user_id is null then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_ACTOR', 'error', 'Staff approval requires an actor user id.');
      end if;
      v_staff_actor := public.accounting_actor_id(p_approved_by_user_id);
      if v_staff_actor is null then
        return jsonb_build_object('ok', false, 'code', 'APPROVAL_ACTOR', 'error', 'Staff approval requires a valid actor user id.');
      end if;
      v_role := coalesce(public.user_role(v_staff_actor)::text, '');
      if v_role not in ('admin', 'office', 'sales_manager', 'salesman') then
        return jsonb_build_object(
          'ok', false, 'code', 'APPROVAL_FORBIDDEN',
          'error', 'Staff actor role is not authorized to approve estimates.'
        );
      end if;
    else
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_AUTH', 'error', 'Authentication required.');
    end if;
  end if;

  -- Idempotency advisory first when key present (lock order).
  if v_key is not null then
    perform public.estimate_approval_lock_idempotency(v_key);
  end if;

  -- Lock commercial row (authoritative TX boundary).
  select * into v_est from public.estimates where id = p_estimate_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_NOT_FOUND', 'error', 'Estimate not found.');
  end if;

  if p_approval_source = 'portal' then
    if v_est.customer_id is distinct from v_portal_customer then
      return jsonb_build_object('ok', false, 'code', 'APPROVAL_OWNERSHIP', 'error', 'That estimate is not available for approval.');
    end if;
  end if;

  v_option_id := coalesce(p_accepted_option_id, v_est.accepted_option_id);
  if v_option_id is null then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_NO_OPTION', 'error', 'No option to approve.');
  end if;

  if not exists (
    select 1 from public.estimate_options o
    where o.id = v_option_id and o.estimate_id = p_estimate_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'APPROVAL_BAD_OPTION', 'error', 'Accepted option not found on estimate.');
  end if;

  -- Authoritative commercial snapshot from LIVE DB (ignore any client payload).
  -- Never return sqlerrm to callers (portal must not see schema/SQL/cost).
  begin
    v_payload := public.build_estimate_approval_payload_live(p_estimate_id, v_option_id);
  exception when others then
    raise warning 'APPROVAL_PAYLOAD_BUILD internal: %', sqlerrm;
    return jsonb_build_object(
      'ok', false,
      'code', 'APPROVAL_PAYLOAD_BUILD',
      'error', 'Could not build the approval snapshot from the current estimate. Contact the office.'
    );
  end;
  v_digest := public.estimate_approval_commercial_digest(v_payload);

  v_ctx_hash := md5(
    v_action || chr(31) ||
    p_estimate_id::text || chr(31) ||
    v_option_id::text || chr(31) ||
    p_approval_source || chr(31) ||
    coalesce(v_staff_actor::text, '') || chr(31) ||
    coalesce(v_portal_customer::text, '') || chr(31) ||
    v_digest
  );

  if v_key is not null then
    begin
      v_prior := public.estimate_approval_begin_action(v_key, v_action, v_ctx_hash);
    exception
      when others then
        if sqlerrm like 'IDEMPOTENCY_CONFLICT%' then
          return jsonb_build_object(
            'ok', false,
            'code', 'IDEMPOTENCY_CONFLICT',
            'error', 'Idempotency key reused with a different approval context.'
          );
        end if;
        raise;
    end;
    if v_prior is not null then
      return v_prior;
    end if;
  end if;

  -- Idempotent retry: already approved, not stale, same commercial digest.
  if v_est.status = 'approved'
     and coalesce(v_est.approval_stale, false) = false
     and v_est.current_approval_snapshot_id is not null then
    select * into v_existing
    from public.estimate_approval_snapshots
    where id = v_est.current_approval_snapshot_id;

    if found
       and public.estimate_approval_commercial_digest(v_existing.payload) = v_digest
       and v_existing.accepted_option_id is not distinct from v_option_id
       and v_existing.approval_source = p_approval_source then
      v_result := jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'snapshot_id', v_existing.id,
        'version', v_existing.version,
        'estimate_id', p_estimate_id
      );
      -- No success audit on retry (exact-once via audit idempotency key too).
      if v_key is not null then
        perform public.estimate_approval_complete_action(v_key, v_action, v_ctx_hash, v_result);
      end if;
      return v_result;
    end if;

    -- Key already claimed for THIS context. Complete with a deterministic
    -- terminal result — never DELETE the claim (that would let the same key
    -- be reused later with a different commercial context).
    v_result := jsonb_build_object(
      'ok', false,
      'code', 'APPROVAL_STALE_OR_CONFLICT',
      'error', 'Estimate is already approved. Edit the commercial terms (marks stale) before re-approving.'
    );
    if v_key is not null then
      perform public.estimate_approval_complete_action(v_key, v_action, v_ctx_hash, v_result);
    end if;
    return v_result;
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.estimate_approval_snapshots
  where estimate_id = p_estimate_id;

  insert into public.estimate_approval_snapshots (
    estimate_id,
    version,
    accepted_option_id,
    approved_at,
    approval_source,
    approved_by_user_id,
    approved_by_customer_id,
    payload
  ) values (
    p_estimate_id,
    v_next_version,
    v_option_id,
    v_approved_at,
    p_approval_source,
    case when p_approval_source = 'staff' then v_staff_actor else null end,
    case when p_approval_source = 'portal' then v_portal_customer else null end,
    v_payload
  )
  returning id into v_snap_id;

  update public.estimates set
    status = 'approved',
    accepted_option_id = v_option_id,
    approved_at = v_approved_at,
    approval_source = p_approval_source,
    approved_by_user_id = case
      when p_approval_source = 'staff' then v_staff_actor
      else null
    end,
    approved_by_customer_id = case
      when p_approval_source = 'portal' then v_portal_customer
      else null
    end,
    current_approval_snapshot_id = v_snap_id,
    approval_stale = false,
    updated_at = now()
  where id = p_estimate_id;

  -- Exact-once success audit (only after first successful approval in this path).
  v_audit_key := coalesce(v_key, 'estimate_approved:' || v_snap_id::text);
  perform set_config('app.trusted_definer_audit', 'true', true);
  begin
    perform public.log_financial_audit_safe(
      'estimate_approved',
      'estimate',
      p_estimate_id,
      (v_approved_at at time zone 'America/New_York')::date,
      null,
      jsonb_build_object(
        'snapshot_id', v_snap_id,
        'version', v_next_version,
        'approval_source', p_approval_source,
        'accepted_option_id', v_option_id,
        'commercial_digest', v_digest,
        'total', v_payload->>'total'
      ),
      case when p_approval_source = 'staff' then v_staff_actor else null end,
      v_audit_key
    );
  exception when others then
    perform set_config('app.trusted_definer_audit', 'false', true);
    raise;
  end;
  perform set_config('app.trusted_definer_audit', 'false', true);

  v_result := jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'snapshot_id', v_snap_id,
    'version', v_next_version,
    'estimate_id', p_estimate_id,
    'approved_at', v_approved_at
  );

  if v_key is not null then
    perform public.estimate_approval_complete_action(v_key, v_action, v_ctx_hash, v_result);
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) office_tasks RLS + field-level protect + revoke DELETE
-- ---------------------------------------------------------------------------
drop policy if exists office_tasks_staff_all on public.office_tasks;
drop policy if exists office_tasks_select on public.office_tasks;
drop policy if exists office_tasks_insert on public.office_tasks;
drop policy if exists office_tasks_update on public.office_tasks;
drop policy if exists office_tasks_delete on public.office_tasks;

-- Task management roles: admin | office | sales_manager (F2 assign/cancel policy).
-- public.is_staff() is admin|office only (0001) — do NOT treat it as "any employee".
-- Ordinary assignees (salesman/scheduler/warehouse/crew) may SELECT own rows
-- and UPDATE only via the column-protect trigger (complete self-service).
create policy office_tasks_select on public.office_tasks
  for select to authenticated
  using (
    public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager')
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  );

create policy office_tasks_insert on public.office_tasks
  for insert to authenticated
  with check (
    public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager')
  );

create policy office_tasks_update on public.office_tasks
  for update to authenticated
  using (
    public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager')
    or assigned_to = auth.uid()
  )
  with check (
    public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager')
    or assigned_to = auth.uid()
  );

create or replace function public.office_tasks_protect_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_manager boolean;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if public.accounting_is_service_role() then
    return new;
  end if;

  -- Explicit F2 management roles — not is_staff() (admin|office only, but
  -- must stay aligned if is_staff ever changes; salesman is NOT a manager).
  v_role := coalesce(public.user_role(v_uid)::text, '');
  v_manager := v_role in ('admin', 'office', 'sales_manager');

  if v_manager then
    return new;
  end if;

  -- Assignee may ONLY change status (open/in_progress → completed),
  -- completed_at, completed_by, updated_at.
  if old.assigned_to is distinct from v_uid then
    raise exception 'TASK_FORBIDDEN: only the assignee or a manager may update this task.'
      using errcode = 'P0001';
  end if;

  if new.assigned_to is distinct from old.assigned_to
     or new.created_by is distinct from old.created_by
     or new.customer_id is distinct from old.customer_id
     or new.job_id is distinct from old.job_id
     or new.estimate_id is distinct from old.estimate_id
     or new.title is distinct from old.title
     or new.priority is distinct from old.priority
     or new.due_at is distinct from old.due_at
     or new.source is distinct from old.source
     or new.source_key is distinct from old.source_key
     or new.description is distinct from old.description then
    raise exception
      'TASK_FIELD_FORBIDDEN: assignees may only complete tasks (status/completed_*), not change assignment or content.'
      using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if not (
      old.status in ('open', 'in_progress')
      and new.status = 'completed'
    ) then
      raise exception
        'TASK_STATUS_FORBIDDEN: assignees may only move open/in_progress tasks to completed.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists office_tasks_protect_columns on public.office_tasks;
create trigger office_tasks_protect_columns
  before update on public.office_tasks
  for each row
  execute function public.office_tasks_protect_columns();

revoke delete on public.office_tasks from authenticated;
revoke delete on public.office_tasks from public;
revoke delete on public.office_tasks from anon;

-- ---------------------------------------------------------------------------
-- 8) ACL sweep — helpers internal; RPCs authenticated + service_role
-- ---------------------------------------------------------------------------
revoke all on function public.estimate_approval_num(numeric) from public, anon, authenticated;
grant execute on function public.estimate_approval_num(numeric) to service_role;

revoke all on function public.estimate_approval_is_count_unit(text) from public, anon, authenticated;
grant execute on function public.estimate_approval_is_count_unit(text) to service_role;

revoke all on function public.estimate_approval_line_qty(text, numeric, numeric, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.estimate_approval_line_qty(text, numeric, numeric, numeric, numeric, text)
  to service_role;

revoke all on function public.estimate_approval_line_total(
  text, text, text, numeric, numeric, numeric, numeric, text,
  numeric, numeric, numeric, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.estimate_approval_line_total(
  text, text, text, numeric, numeric, numeric, numeric, text,
  numeric, numeric, numeric, numeric, numeric
) to service_role;

revoke all on function public.build_estimate_approval_payload_live(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.build_estimate_approval_payload_live(uuid, uuid)
  to service_role;

revoke all on function public.estimate_approval_commercial_digest(jsonb)
  from public, anon, authenticated;
grant execute on function public.estimate_approval_commercial_digest(jsonb)
  to service_role;

revoke all on function public.estimate_approval_lock_idempotency(text)
  from public, anon, authenticated;
grant execute on function public.estimate_approval_lock_idempotency(text)
  to service_role;

revoke all on function public.estimate_approval_begin_action(text, text, text)
  from public, anon, authenticated;
grant execute on function public.estimate_approval_begin_action(text, text, text)
  to service_role;

revoke all on function public.estimate_approval_complete_action(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.estimate_approval_complete_action(text, text, text, jsonb)
  to service_role;

revoke all on function public.office_tasks_protect_columns() from public, anon, authenticated;
grant execute on function public.office_tasks_protect_columns() to service_role;

revoke all on function public.record_estimate_approval_safe(
  uuid, uuid, text, uuid, uuid, text
) from public;
revoke all on function public.record_estimate_approval_safe(
  uuid, uuid, text, uuid, uuid, text
) from anon;
grant execute on function public.record_estimate_approval_safe(
  uuid, uuid, text, uuid, uuid, text
) to authenticated;
grant execute on function public.record_estimate_approval_safe(
  uuid, uuid, text, uuid, uuid, text
) to service_role;

comment on function public.record_estimate_approval_safe(uuid, uuid, text, uuid, uuid, text) is
  'F7/0178: atomic live-built approval snapshot + estimate status. Portal via my_customer_id only (no service_role). Staff actor = auth.uid() or validated service_role actor. Idempotency advisory(181).';

comment on function public.build_estimate_approval_payload_live(uuid, uuid) is
  'F7/0178: authoritative approval payload from live estimate/option/lines (ignore client jsonb).';

comment on table public.estimate_approval_idempotency is
  'F7/0178: approval idempotency keys; context_hash includes commercial_digest. Locked via advisory(181).';

-- ---------------------------------------------------------------------------
-- 9) Final accounting safety — still OFF (no flag writes)
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  select * into s from public.accounting_settings where id = 1;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or s.cutover_date is not null then
    raise exception 'F7_0178_POSTCHECK: accounting flags must remain OFF/NULL.';
  end if;
end $$;
