-- Phase L: page the remaining employee searches in the database.
-- Estimates, orders, purchase orders, service, tasks, and non-overdue invoices
-- were merging a few capped queries (about 200 rows) and slicing in the app.
-- These functions return one page of ids plus the real total. An empty page
-- still returns one row (id null, total_count set) so the app can clamp.
--
-- security invoker: row level security still applies. No business rows are
-- written. Accounting stays off. Enum columns are compared as text — passing
-- an enum into a text parameter fails at CREATE time (the 0478 lesson).
-- Safe to re-run: create or replace keeps these signatures, and the index
-- uses if not exists.

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

create or replace function public.po_queue_page(
  p_statuses text[] default null,
  p_source text default null,
  p_search text default null,
  p_po_number int default null,
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
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_total bigint;
begin
  if v_source = 'all' then
    v_source := null;
  end if;
  if v_search is not null and char_length(v_search) >= 2 then
    v_like := '%' || replace(replace(v_search, '%', ''), '_', '') || '%';
  else
    v_like := null;
  end if;

  select count(*) into v_total
  from public.purchase_orders po
  left join public.customers c on c.id = po.customer_id
  where po.is_stock is not true
    and (
      p_statuses is null
      or cardinality(p_statuses) = 0
      or po.status::text = any (p_statuses)
    )
    and (v_source is null or po.source_type = v_source)
    and (
      (
        v_like is not null
        and (
          po.supplier ilike v_like
          or po.notes ilike v_like
          or c.full_name ilike v_like
        )
      )
      or (p_po_number is not null and po.po_number = p_po_number)
    );

  return query
  select picked.id, v_total
  from (
    select po.id
    from public.purchase_orders po
    left join public.customers c on c.id = po.customer_id
    where po.is_stock is not true
      and (
        p_statuses is null
        or cardinality(p_statuses) = 0
        or po.status::text = any (p_statuses)
      )
      and (v_source is null or po.source_type = v_source)
      and (
        (
          v_like is not null
          and (
            po.supplier ilike v_like
            or po.notes ilike v_like
            or c.full_name ilike v_like
          )
        )
        or (p_po_number is not null and po.po_number = p_po_number)
      )
    order by po.created_at desc, po.id desc
    limit v_limit
    offset v_offset
  ) picked;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;

revoke all on function public.po_queue_page(text[], text, text, int, int, int) from public;
revoke all on function public.po_queue_page(text[], text, text, int, int, int) from anon;
grant execute on function public.po_queue_page(text[], text, text, int, int, int) to authenticated;
grant execute on function public.po_queue_page(text[], text, text, int, int, int) to service_role;

-- Job purchase-order queues always skip stock replenishment and sort by created_at.
create index if not exists purchase_orders_queue_idx
  on public.purchase_orders (created_at desc)
  where is_stock is not true;

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

-- Non-overdue invoice search. Overdue stays on invoice_overdue_page, which
-- uses invoice_open_ar_balance. This function does not compute balances.
create or replace function public.invoice_queue_page(
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
  from public.invoices i
  left join public.customers c on c.id = i.customer_id
  where (
      p_statuses is null
      or cardinality(p_statuses) = 0
      or i.status::text = any (p_statuses)
    )
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
    where (
        p_statuses is null
        or cardinality(p_statuses) = 0
        or i.status::text = any (p_statuses)
      )
      and (
        v_like is null
        or i.number ilike v_like
        or c.full_name ilike v_like
      )
    order by i.created_at desc, i.id desc
    limit v_limit
    offset v_offset
  ) picked;

  if not found then
    return query select null::uuid, v_total;
  end if;
end;
$$;

revoke all on function public.invoice_queue_page(text[], text, int, int) from public;
revoke all on function public.invoice_queue_page(text[], text, int, int) from anon;
grant execute on function public.invoice_queue_page(text[], text, int, int) to authenticated;
grant execute on function public.invoice_queue_page(text[], text, int, int) to service_role;
