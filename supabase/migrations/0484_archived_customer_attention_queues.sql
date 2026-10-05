-- Active operational queues skip archived customers.
-- customers.cancelled_at is the only archive flag. Same rule as
-- src/lib/customer-operational.ts. This does not update jobs, tasks,
-- callbacks, estimates, orders, invoices, or payments.
-- History stays: service resolved/cancelled/all, completed tasks,
-- estimate views other than sent/draft, and order browse or declined/cancelled.
-- Apply in the Supabase SQL editor. Does not enable accounting.
-- Safe to re-run: create or replace keeps the 0479 signatures.
-- Rollback: re-apply the function bodies from 0479_ops_search_page.sql.
-- No table rewrite. customers_cancelled_idx already exists (0044).


create or replace function public.estimate_queue_page(
  p_status text default null,
  p_sent_before timestamptz default null,
  p_mine uuid default null,
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
  from public.estimates e
  left join public.customers c on c.id = e.customer_id
  where (p_status is null or e.status::text = p_status)
    and (p_sent_before is null or e.sent_at < p_sent_before)
    and (p_mine is null or c.assigned_to = p_mine)
    and (
      p_status is null
      or p_status not in ('sent', 'draft')
      or c.cancelled_at is null
    )
    and (
      v_like is null
      or e.title ilike v_like
      or c.full_name ilike v_like
      or c.street ilike v_like
      or c.city ilike v_like
    );

  return query
  select picked.id, v_total
  from (
    select e.id
    from public.estimates e
    left join public.customers c on c.id = e.customer_id
    where (p_status is null or e.status::text = p_status)
      and (p_sent_before is null or e.sent_at < p_sent_before)
      and (p_mine is null or c.assigned_to = p_mine)
      and (
        p_status is null
        or p_status not in ('sent', 'draft')
        or c.cancelled_at is null
      )
      and (
        v_like is null
        or e.title ilike v_like
        or c.full_name ilike v_like
        or c.street ilike v_like
        or c.city ilike v_like
      )
    order by e.created_at desc, e.id desc
    limit v_limit
    offset v_offset
  ) picked;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;


revoke all on function public.estimate_queue_page(text, timestamptz, uuid, text, int, int) from public;
revoke all on function public.estimate_queue_page(text, timestamptz, uuid, text, int, int) from anon;
grant execute on function public.estimate_queue_page(text, timestamptz, uuid, text, int, int) to authenticated;
grant execute on function public.estimate_queue_page(text, timestamptz, uuid, text, int, int) to service_role;


create or replace function public.order_queue_page(
  p_statuses text[] default null,
  p_search text default null,
  p_phone_like text default null,
  p_digits text default null,
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
  from public.orders o
  left join public.customers c on c.id = o.customer_id
  left join public.jobs j on j.id = o.job_id
  where (
      p_statuses is null
      or cardinality(p_statuses) = 0
      or o.status = any (p_statuses)
    )
    and (
      p_statuses is null
      or cardinality(p_statuses) = 0
      or p_statuses && array['declined', 'cancelled']::text[]
      or c.cancelled_at is null
    )
    and (
      (
        v_like is not null
        and (
          o.contact_name ilike v_like
          or o.contact_email ilike v_like
          or o.contact_phone ilike v_like
          or o.notes ilike v_like
          or c.full_name ilike v_like
          or j.title ilike v_like
        )
      )
      or (p_phone_like is not null and o.contact_phone ilike p_phone_like)
      or (
        v_digits is not null
        and regexp_replace(coalesce(o.contact_phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
      )
    );

  return query
  select picked.id, v_total
  from (
    select o.id
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join public.jobs j on j.id = o.job_id
    where (
        p_statuses is null
        or cardinality(p_statuses) = 0
        or o.status = any (p_statuses)
      )
      and (
        p_statuses is null
        or cardinality(p_statuses) = 0
        or p_statuses && array['declined', 'cancelled']::text[]
        or c.cancelled_at is null
      )
      and (
        (
          v_like is not null
          and (
            o.contact_name ilike v_like
            or o.contact_email ilike v_like
            or o.contact_phone ilike v_like
            or o.notes ilike v_like
            or c.full_name ilike v_like
            or j.title ilike v_like
          )
        )
        or (p_phone_like is not null and o.contact_phone ilike p_phone_like)
        or (
          v_digits is not null
          and regexp_replace(coalesce(o.contact_phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
        )
      )
    order by o.created_at desc, o.id desc
    limit v_limit
    offset v_offset
  ) picked;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;


revoke all on function public.order_queue_page(text[], text, text, text, int, int) from public;
revoke all on function public.order_queue_page(text[], text, text, text, int, int) from anon;
grant execute on function public.order_queue_page(text[], text, text, text, int, int) to authenticated;
grant execute on function public.order_queue_page(text[], text, text, text, int, int) to service_role;


create or replace function public.service_queue_page(
  p_statuses text[] default null,
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
  from public.service_callbacks s
  left join public.customers c on c.id = s.customer_id
  left join public.jobs j on j.id = s.job_id
  where (
      p_statuses is null
      or cardinality(p_statuses) = 0
      or s.status = any (p_statuses)
    )
    and (
      p_statuses is null
      or cardinality(p_statuses) = 0
      or p_statuses && array['resolved', 'cancelled']::text[]
      or c.cancelled_at is null
    )
    and (
      v_like is null
      or s.description ilike v_like
      or c.full_name ilike v_like
      or c.street ilike v_like
      or c.city ilike v_like
      or j.title ilike v_like
      or j.site_street ilike v_like
      or j.site_city ilike v_like
    );

  return query
  select picked.id, v_total
  from (
    select s.id
    from public.service_callbacks s
    left join public.customers c on c.id = s.customer_id
    left join public.jobs j on j.id = s.job_id
    where (
        p_statuses is null
        or cardinality(p_statuses) = 0
        or s.status = any (p_statuses)
      )
      and (
        p_statuses is null
        or cardinality(p_statuses) = 0
        or p_statuses && array['resolved', 'cancelled']::text[]
        or c.cancelled_at is null
      )
      and (
        v_like is null
        or s.description ilike v_like
        or c.full_name ilike v_like
        or c.street ilike v_like
        or c.city ilike v_like
        or j.title ilike v_like
        or j.site_street ilike v_like
        or j.site_city ilike v_like
      )
    order by s.follow_up_at asc nulls last, s.id asc
    limit v_limit
    offset v_offset
  ) picked;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;


revoke all on function public.service_queue_page(text[], text, int, int) from public;
revoke all on function public.service_queue_page(text[], text, int, int) from anon;
grant execute on function public.service_queue_page(text[], text, int, int) to authenticated;
grant execute on function public.service_queue_page(text[], text, int, int) to service_role;


create or replace function public.task_queue_page(
  p_view text default 'open',
  p_user uuid default null,
  p_see_all boolean default false,
  p_now timestamptz default null,
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
  v_now timestamptz := coalesce(p_now, now());
  v_mine boolean := p_view = 'mine' or not coalesce(p_see_all, false);
  v_total bigint;
begin
  if v_search is not null and char_length(v_search) >= 2 then
    v_like := '%' || replace(replace(v_search, '%', ''), '_', '') || '%';
  else
    v_like := null;
  end if;

  select count(*) into v_total
  from public.office_tasks t
  left join public.customers c on c.id = t.customer_id
  left join public.profiles assignee on assignee.id = t.assigned_to
  where (not v_mine or t.assigned_to = p_user)
    and (
      case
        when p_view = 'completed' then t.status = 'completed'
        when p_view = 'overdue' then t.status in ('open', 'in_progress') and t.due_at < v_now
        else t.status in ('open', 'in_progress')
      end
    )
    and (
      p_view = 'completed'
      or t.customer_id is null
      or c.cancelled_at is null
    )
    and (
      v_like is null
      or t.title ilike v_like
      or t.description ilike v_like
      or c.full_name ilike v_like
      or (coalesce(p_see_all, false) and not v_mine and assignee.full_name ilike v_like)
    );

  return query
  select picked.id, v_total
  from (
    select t.id
    from public.office_tasks t
    left join public.customers c on c.id = t.customer_id
    left join public.profiles assignee on assignee.id = t.assigned_to
    where (not v_mine or t.assigned_to = p_user)
      and (
        case
          when p_view = 'completed' then t.status = 'completed'
          when p_view = 'overdue' then t.status in ('open', 'in_progress') and t.due_at < v_now
          else t.status in ('open', 'in_progress')
        end
      )
      and (
        p_view = 'completed'
        or t.customer_id is null
        or c.cancelled_at is null
      )
      and (
        v_like is null
        or t.title ilike v_like
        or t.description ilike v_like
        or c.full_name ilike v_like
        or (coalesce(p_see_all, false) and not v_mine and assignee.full_name ilike v_like)
      )
    order by t.due_at asc nulls last, t.id asc
    limit v_limit
    offset v_offset
  ) picked;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;


revoke all on function public.task_queue_page(text, uuid, boolean, timestamptz, text, int, int) from public;
revoke all on function public.task_queue_page(text, uuid, boolean, timestamptz, text, int, int) from anon;
grant execute on function public.task_queue_page(text, uuid, boolean, timestamptz, text, int, int) to authenticated;
grant execute on function public.task_queue_page(text, uuid, boolean, timestamptz, text, int, int) to service_role;

