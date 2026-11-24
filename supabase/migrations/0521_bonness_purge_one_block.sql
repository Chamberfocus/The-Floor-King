-- One statement. The SQL editor was cutting the earlier script off mid-function.
-- Keeps Bonness: the customer, the staff member, their jobs, and their client
-- orders. Deletes every other customer. Prices, staff logins, and stock
-- purchase orders stay.
-- If Bonness is not in the database, this stops and deletes nothing.

do $purge$
declare
  v_admin uuid;
  v_staff uuid[] := '{}'::uuid[];
  v_keep_customers uuid[] := '{}'::uuid[];
  v_keep_orders uuid[] := '{}'::uuid[];
  v_id uuid;
  v_result jsonb;
  v_deleted int := 0;
  v_orders_removed int := 0;
  v_supplier_hit boolean := false;
  v_near text;
begin
  select id into v_admin
  from public.profiles
  where role = 'admin'
  order by created_at
  limit 1;

  if v_admin is null then
    raise exception 'NO_ADMIN'
      using hint = 'No administrator profile. Nothing was deleted.';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text,
    true
  );

  if not public.is_admin() then
    raise exception 'ADMIN_CONTEXT'
      using hint = 'The SQL editor could not run as an administrator. Nothing was deleted.';
  end if;

  select coalesce(array_agg(p.id), '{}'::uuid[])
    into v_staff
  from public.profiles p
  where lower(coalesce(p.full_name, '')) like '%bonness%'
     or lower(coalesce(p.email, '')) like '%bonness%';

  select coalesce(array_agg(distinct id), '{}'::uuid[])
    into v_keep_customers
  from (
    select c.id
    from public.customers c
    where lower(coalesce(c.full_name, '')) like '%bonness%'
       or lower(coalesce(c.company, '')) like '%bonness%'
       or lower(coalesce(c.email, '')) like '%bonness%'
    union
    select j.customer_id
    from public.jobs j
    where j.customer_id is not null
      and (j.assigned_to = any (v_staff) or j.created_by = any (v_staff))
  ) people
  where id is not null;

  if to_regclass('public.orders') is not null then
    select coalesce(array_agg(o.id), '{}'::uuid[])
      into v_keep_orders
    from public.orders o
    where lower(coalesce(o.contact_name, '')) like '%bonness%'
       or lower(coalesce(o.contact_email, '')) like '%bonness%'
       or o.customer_id = any (v_keep_customers)
       or o.created_by = any (v_staff)
       or o.approved_by = any (v_staff);

    select coalesce(array_agg(distinct id), '{}'::uuid[])
      into v_keep_customers
    from (
      select unnest(v_keep_customers) as id
      union
      select o.customer_id
      from public.orders o
      where o.id = any (v_keep_orders)
        and o.customer_id is not null
    ) people
    where id is not null;
  end if;

  if to_regclass('public.purchase_orders') is not null then
    select coalesce(array_agg(distinct id), '{}'::uuid[])
      into v_keep_customers
    from (
      select unnest(v_keep_customers) as id
      union
      select po.customer_id
      from public.purchase_orders po
      where po.customer_id is not null
        and po.created_by = any (v_staff)
    ) people
    where id is not null;

    if to_regclass('public.suppliers') is not null then
      select exists (
        select 1
        from public.purchase_orders po
        left join public.suppliers s on s.id = po.supplier_id
        where lower(coalesce(po.supplier, '')) like '%bonness%'
           or lower(coalesce(s.name, '')) like '%bonness%'
      ) into v_supplier_hit;
    else
      select exists (
        select 1
        from public.purchase_orders po
        where lower(coalesce(po.supplier, '')) like '%bonness%'
      ) into v_supplier_hit;
    end if;
  end if;

  if cardinality(v_keep_customers) = 0
     and cardinality(v_keep_orders) = 0
     and not v_supplier_hit then
    select left(string_agg(label, ' | '), 600)
      into v_near
    from (
      select full_name as label
      from public.customers
      where full_name ilike '%john%' or full_name ilike '%bonn%'
      order by full_name
      limit 12
    ) names;

    if cardinality(v_staff) > 0 then
      raise exception 'BONNESS_HAS_NO_ORDERS'
        using hint = 'Bonness is on the staff list but has no jobs or client orders. Nothing was deleted.';
    end if;

    raise exception 'ORDERS_NOT_FOUND'
      using hint = coalesce(
        'Nothing was deleted. Similar names: ' || v_near,
        'Nothing was deleted. No customer, staff, order, or supplier contains Bonness.'
      );
  end if;

  if to_regclass('public.orders') is not null then
    delete from public.orders o
    where not (o.id = any (v_keep_orders));
    get diagnostics v_orders_removed = row_count;
  end if;

  for v_id in
    select c.id
    from public.customers c
    where not (c.id = any (v_keep_customers))
  loop
    v_result := public.delete_customer_clean(v_id);
    if coalesce(v_result->>'ok', '') <> 'true' then
      raise exception 'CUSTOMER_PURGE_FAILED: %', v_result
        using hint = 'The whole change was cancelled. Nothing was deleted.';
    end if;
    v_deleted := v_deleted + 1;
  end loop;

  raise notice 'kept_customers=% kept_orders=% removed_other_orders=% deleted_customers=%',
    cardinality(v_keep_customers),
    cardinality(v_keep_orders),
    v_orders_removed,
    v_deleted;
end
$purge$;
