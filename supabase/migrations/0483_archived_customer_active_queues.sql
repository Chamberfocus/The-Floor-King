-- Archived customers leave active operational queues.
-- customers.cancelled_at is the archive flag. This does not update jobs,
-- invoices, payments, or history. completed and all still return those rows.
-- Apply in the Supabase SQL editor before deploying the app change.
-- Does not enable accounting. Does not change invoice, payment, or deposit RPCs.
-- Safe to re-run: create or replace with the same signature as 0478.

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
      p_queue in ('completed', 'all')
      or c.cancelled_at is null
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
        p_queue in ('completed', 'all')
        or c.cancelled_at is null
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

