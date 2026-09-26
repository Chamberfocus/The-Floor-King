-- Operational queues page in the database.
-- Does not change invoice idempotency, payment/deposit RPCs, approval snapshots,
-- or accounting flags. Does not write customer or job rows.
-- Apply in the Supabase SQL editor before deploying the app change. Do not run
-- this file from the app.

-- Same rule as src/lib/job-scope.ts isMaterialLine.
-- A purchase order is not an input. A deposit is not an input.
create or replace function public.line_is_material(
  p_line_type text,
  p_category text,
  p_product_id uuid,
  p_manufacturer text,
  p_color text,
  p_sqft_per_box numeric,
  p_roll_width_ft numeric
) returns boolean
language sql
immutable
as $$
  select case
    when p_line_type = 'flat' then false
    when lower(coalesce(p_category, '')) = 'labor' then false
    when lower(coalesce(p_category, '')) in (
      'carpet', 'lvp', 'hardwood', 'laminate', 'tile', 'vinyl', 'underlayment', 'trim'
    ) then true
    else (
      p_product_id is not null
      or nullif(btrim(coalesce(p_manufacturer, '')), '') is not null
      or nullif(btrim(coalesce(p_color, '')), '') is not null
      or coalesce(p_sqft_per_box, 0) <> 0
      or coalesce(p_roll_width_ft, 0) <> 0
    )
  end;
$$;

create or replace function public.job_has_material_need(p_job_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.job_line_items l
    where l.job_id = p_job_id
      and public.line_is_material(
        l.line_type,
        l.category,
        l.product_id,
        l.manufacturer,
        l.color,
        l.sqft_per_box,
        l.roll_width_ft
      )
  );
$$;

revoke all on function public.line_is_material(text, text, uuid, text, text, numeric, numeric) from public;
revoke all on function public.line_is_material(text, text, uuid, text, text, numeric, numeric) from anon;
grant execute on function public.line_is_material(text, text, uuid, text, text, numeric, numeric) to authenticated;
grant execute on function public.line_is_material(text, text, uuid, text, text, numeric, numeric) to service_role;

revoke all on function public.job_has_material_need(uuid) from public;
revoke all on function public.job_has_material_need(uuid) from anon;
grant execute on function public.job_has_material_need(uuid) to authenticated;
grant execute on function public.job_has_material_need(uuid) to service_role;

-- One page of jobs for a queue. security invoker so jobs/customers RLS still applies.
-- total_count is the full match count. An empty page still returns one row with a null id.
create or replace function public.job_queue_page(
  p_queue text,
  p_search text default null,
  p_phone_like text default null,
  p_digits text default null,
  p_mine uuid default null,
  p_assigned uuid default null,
  p_crew_ids uuid[] default null,
  p_keep_pickup boolean default false,
  p_limit int default 40,
  p_offset int default 0
) returns table (id uuid, total_count bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 80);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_digits text := nullif(regexp_replace(coalesce(p_digits, ''), '\D', '', 'g'), '');
  v_total bigint;
begin
  if v_search is not null and char_length(v_search) >= 2 then
    v_like := '%' || replace(replace(v_search, '%', ''), '_', '') || '%';
  else
    v_like := null;
  end if;
  if v_digits is null or char_length(v_digits) < 7 then
    v_digits := null;
  end if;

  select count(*) into v_total
  from public.jobs j
  left join public.customers c on c.id = j.customer_id
  where (
      p_keep_pickup
      or j.delivery_type is null
      or j.delivery_type <> 'cash_carry'
    )
    and (
      case p_queue
        when 'material' then
          j.status in ('unscheduled', 'scheduled', 'in_progress')
          and j.warehouse_ready_at is null
          and public.job_has_material_need(j.id)
        when 'ready' then
          j.status = 'unscheduled'
          and j.scheduled_date is null
          and (
            j.warehouse_ready_at is not null
            or not public.job_has_material_need(j.id)
          )
        when 'service' then
          j.status in ('unscheduled', 'scheduled', 'in_progress')
          and exists (
            select 1 from public.service_callbacks s
            where s.job_id = j.id
              and s.status in ('open', 'scheduled', 'in_progress', 'waiting')
          )
        when 'open' then j.status in ('unscheduled', 'scheduled', 'in_progress')
        when 'scheduled' then j.status = 'scheduled'
        when 'installing' then j.status = 'in_progress'
        when 'completed' then j.status = 'completed'
        when 'all' then true
        when 'warehouse_active' then
          j.status in ('unscheduled', 'scheduled', 'in_progress')
          and (
            j.warehouse_status is null
            or j.warehouse_status not in ('staged', 'out_for_delivery', 'delivered', 'picked_up')
          )
        when 'warehouse_staged' then
          j.status in ('unscheduled', 'scheduled', 'in_progress')
          and j.warehouse_status in ('staged', 'out_for_delivery', 'delivered', 'picked_up')
        when 'scheduler_ready' then
          j.status = 'unscheduled'
          and j.scheduled_date is null
          and (
            j.warehouse_ready_at is not null
            or not public.job_has_material_need(j.id)
          )
        when 'scheduler_booked' then
          j.scheduled_date is not null
          and j.status in ('scheduled', 'in_progress')
        else false
      end
    )
    and (
      p_mine is null
      or j.assigned_to = p_mine
      or exists (
        select 1 from public.customers mc
        where mc.id = j.customer_id
          and (mc.assigned_to = p_mine or mc.workflow_owner_id = p_mine)
      )
    )
    and (
      p_assigned is null
      or j.assigned_to = p_assigned
      or (p_crew_ids is not null and j.assigned_crew_id = any (p_crew_ids))
    )
    and (
      v_like is null
      or j.title ilike v_like
      or j.site_street ilike v_like
      or j.site_city ilike v_like
      or j.site_state ilike v_like
      or j.staging_location ilike v_like
      or c.full_name ilike v_like
      or c.street ilike v_like
      or c.city ilike v_like
      or (p_phone_like is not null and c.phone ilike p_phone_like)
      or (
        v_digits is not null
        and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
      )
    );

  return query
  select picked.id, v_total
  from (
    select j.id
    from public.jobs j
    left join public.customers c on c.id = j.customer_id
    where (
        p_keep_pickup
        or j.delivery_type is null
        or j.delivery_type <> 'cash_carry'
      )
      and (
        case p_queue
          when 'material' then
            j.status in ('unscheduled', 'scheduled', 'in_progress')
            and j.warehouse_ready_at is null
            and public.job_has_material_need(j.id)
          when 'ready' then
            j.status = 'unscheduled'
            and j.scheduled_date is null
            and (
              j.warehouse_ready_at is not null
              or not public.job_has_material_need(j.id)
            )
          when 'service' then
            j.status in ('unscheduled', 'scheduled', 'in_progress')
            and exists (
              select 1 from public.service_callbacks s
              where s.job_id = j.id
                and s.status in ('open', 'scheduled', 'in_progress', 'waiting')
            )
          when 'open' then j.status in ('unscheduled', 'scheduled', 'in_progress')
          when 'scheduled' then j.status = 'scheduled'
          when 'installing' then j.status = 'in_progress'
          when 'completed' then j.status = 'completed'
          when 'all' then true
          when 'warehouse_active' then
            j.status in ('unscheduled', 'scheduled', 'in_progress')
            and (
              j.warehouse_status is null
              or j.warehouse_status not in ('staged', 'out_for_delivery', 'delivered', 'picked_up')
            )
          when 'warehouse_staged' then
            j.status in ('unscheduled', 'scheduled', 'in_progress')
            and j.warehouse_status in ('staged', 'out_for_delivery', 'delivered', 'picked_up')
          when 'scheduler_ready' then
            j.status = 'unscheduled'
            and j.scheduled_date is null
            and (
              j.warehouse_ready_at is not null
              or not public.job_has_material_need(j.id)
            )
          when 'scheduler_booked' then
            j.scheduled_date is not null
            and j.status in ('scheduled', 'in_progress')
          else false
        end
      )
      and (
        p_mine is null
        or j.assigned_to = p_mine
        or exists (
          select 1 from public.customers mc
          where mc.id = j.customer_id
            and (mc.assigned_to = p_mine or mc.workflow_owner_id = p_mine)
        )
      )
      and (
        p_assigned is null
        or j.assigned_to = p_assigned
        or (p_crew_ids is not null and j.assigned_crew_id = any (p_crew_ids))
      )
      and (
        v_like is null
        or j.title ilike v_like
        or j.site_street ilike v_like
        or j.site_city ilike v_like
        or j.site_state ilike v_like
        or j.staging_location ilike v_like
        or c.full_name ilike v_like
        or c.street ilike v_like
        or c.city ilike v_like
        or (p_phone_like is not null and c.phone ilike p_phone_like)
        or (
          v_digits is not null
          and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
        )
      )
    order by
      case
        when p_queue = 'warehouse_active' and j.warehouse_submitted_at is not null then 0
        when p_queue = 'warehouse_active' then 1
        else 0
      end,
      case
        when p_queue in ('scheduler_booked', 'warehouse_active', 'warehouse_staged') then j.scheduled_date
      end asc nulls last,
      j.created_at desc
    limit v_limit
    offset v_offset
  ) picked;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;

revoke all on function public.job_queue_page(text, text, text, text, uuid, uuid, uuid[], boolean, int, int) from public;
revoke all on function public.job_queue_page(text, text, text, text, uuid, uuid, uuid[], boolean, int, int) from anon;
grant execute on function public.job_queue_page(text, text, text, text, uuid, uuid, uuid[], boolean, int, int) to authenticated;
grant execute on function public.job_queue_page(text, text, text, text, uuid, uuid, uuid[], boolean, int, int) to service_role;

-- Customer search page. Identity fields plus a job title / site or invoice number.
-- Does not return rows the caller's customers RLS would hide.
create or replace function public.customer_queue_page(
  p_search text,
  p_phone_like text default null,
  p_digits text default null,
  p_cancelled text default 'any',
  p_stage_ids uuid[] default null,
  p_exclude_stage_ids uuid[] default null,
  p_assigned uuid default null,
  p_unassigned boolean default false,
  p_stuck boolean default false,
  p_limit int default 40,
  p_offset int default 0
) returns table (id uuid, total_count bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 80);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_digits text := nullif(regexp_replace(coalesce(p_digits, ''), '\D', '', 'g'), '');
  v_total bigint;
begin
  if v_search is null or char_length(v_search) < 1 then
    v_like := null;
  else
    v_like := '%' || replace(replace(v_search, '%', ''), '_', '') || '%';
  end if;
  if v_digits is null or char_length(v_digits) < 7 then
    v_digits := null;
  end if;

  with matched as (
    select c.id, c.updated_at
    from public.customers c
    where (
        case p_cancelled
          when 'only' then c.cancelled_at is not null
          when 'exclude' then c.cancelled_at is null
          else true
        end
      )
      and (
        p_stage_ids is null
        or cardinality(p_stage_ids) = 0
        or c.workflow_stage_id = any (p_stage_ids)
      )
      and (
        p_exclude_stage_ids is null
        or cardinality(p_exclude_stage_ids) = 0
        or c.workflow_stage_id is null
        or not (c.workflow_stage_id = any (p_exclude_stage_ids))
      )
      and (
        case
          when p_unassigned then c.assigned_to is null
          when p_assigned is not null then c.assigned_to = p_assigned
          else true
        end
      )
      and (
        not p_stuck
        or (c.next_action_due is not null and c.next_action_due < now())
      )
      and (
        v_like is null
        or c.full_name ilike v_like
        or c.company ilike v_like
        or c.email ilike v_like
        or c.phone ilike v_like
        or c.street ilike v_like
        or c.city ilike v_like
        or c.zip ilike v_like
        or (p_phone_like is not null and c.phone ilike p_phone_like)
        or (
          v_digits is not null
          and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
        )
        or exists (
          select 1 from public.jobs j
          where j.customer_id = c.id
            and (
              j.title ilike v_like
              or j.site_street ilike v_like
              or j.site_city ilike v_like
              or j.site_zip ilike v_like
            )
        )
        or exists (
          select 1 from public.invoices i
          where i.customer_id = c.id
            and i.number ilike v_like
        )
      )
  )
  select count(*) into v_total from matched;

  return query
  with matched as (
    select c.id, c.updated_at
    from public.customers c
    where (
        case p_cancelled
          when 'only' then c.cancelled_at is not null
          when 'exclude' then c.cancelled_at is null
          else true
        end
      )
      and (
        p_stage_ids is null
        or cardinality(p_stage_ids) = 0
        or c.workflow_stage_id = any (p_stage_ids)
      )
      and (
        p_exclude_stage_ids is null
        or cardinality(p_exclude_stage_ids) = 0
        or c.workflow_stage_id is null
        or not (c.workflow_stage_id = any (p_exclude_stage_ids))
      )
      and (
        case
          when p_unassigned then c.assigned_to is null
          when p_assigned is not null then c.assigned_to = p_assigned
          else true
        end
      )
      and (
        not p_stuck
        or (c.next_action_due is not null and c.next_action_due < now())
      )
      and (
        v_like is null
        or c.full_name ilike v_like
        or c.company ilike v_like
        or c.email ilike v_like
        or c.phone ilike v_like
        or c.street ilike v_like
        or c.city ilike v_like
        or c.zip ilike v_like
        or (p_phone_like is not null and c.phone ilike p_phone_like)
        or (
          v_digits is not null
          and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
        )
        or exists (
          select 1 from public.jobs j
          where j.customer_id = c.id
            and (
              j.title ilike v_like
              or j.site_street ilike v_like
              or j.site_city ilike v_like
              or j.site_zip ilike v_like
            )
        )
        or exists (
          select 1 from public.invoices i
          where i.customer_id = c.id
            and i.number ilike v_like
        )
      )
  )
  select m.id, v_total
  from matched m
  order by m.updated_at desc
  limit v_limit
  offset v_offset;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;

revoke all on function public.customer_queue_page(text, text, text, text, uuid[], uuid[], uuid, boolean, boolean, int, int) from public;
revoke all on function public.customer_queue_page(text, text, text, text, uuid[], uuid[], uuid, boolean, boolean, int, int) from anon;
grant execute on function public.customer_queue_page(text, text, text, text, uuid[], uuid[], uuid, boolean, boolean, int, int) to authenticated;
grant execute on function public.customer_queue_page(text, text, text, text, uuid[], uuid[], uuid, boolean, boolean, int, int) to service_role;

-- Overdue page. Balance is public.invoice_open_ar_balance (canonical open AR).
-- Threshold 0.5 matches the list rule already used on the invoices page.
create or replace function public.invoice_overdue_page(
  p_today date,
  p_search text default null,
  p_limit int default 40,
  p_offset int default 0
) returns table (id uuid, total_count bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 80);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_total bigint;
begin
  if v_search is not null and char_length(v_search) >= 2 then
    v_like := '%' || replace(replace(v_search, '%', ''), '_', '') || '%';
  else
    v_like := null;
  end if;

  select count(*) into v_total
  from public.invoices i
  left join public.customers c on c.id = i.customer_id
  where i.status in ('sent', 'partial')
    and i.status <> 'void'
    and i.due_date is not null
    and i.due_date < p_today
    and public.invoice_open_ar_balance(i.id) > 0.5
    and (
      v_like is null
      or i.number ilike v_like
      or c.full_name ilike v_like
    );

  return query
  select picked.id, v_total
  from (
    select i.id
    from public.invoices i
    left join public.customers c on c.id = i.customer_id
    where i.status in ('sent', 'partial')
      and i.status <> 'void'
      and i.due_date is not null
      and i.due_date < p_today
      and public.invoice_open_ar_balance(i.id) > 0.5
      and (
        v_like is null
        or i.number ilike v_like
        or c.full_name ilike v_like
      )
    order by i.due_date asc, i.created_at asc
    limit v_limit
    offset v_offset
  ) picked;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;

revoke all on function public.invoice_overdue_page(date, text, int, int) from public;
revoke all on function public.invoice_overdue_page(date, text, int, int) from anon;
grant execute on function public.invoice_overdue_page(date, text, int, int) to authenticated;
grant execute on function public.invoice_overdue_page(date, text, int, int) to service_role;

-- Supports the overdue filter (status + due date) before the balance function runs.
create index if not exists invoices_open_due_idx
  on public.invoices (due_date, created_at)
  where status in ('sent', 'partial');

-- Ready-to-schedule and unscheduled scans.
create index if not exists jobs_unscheduled_created_idx
  on public.jobs (created_at desc)
  where status = 'unscheduled';

-- Warehouse and scheduler active-job scans. Does not include completed history.
create index if not exists jobs_active_schedule_idx
  on public.jobs (scheduled_date, created_at desc)
  where status in ('unscheduled', 'scheduled', 'in_progress');

create index if not exists customers_updated_at_idx
  on public.customers (updated_at desc);
