-- Fresh start for customer records.
-- The first pass looked for the words "John" and "Bonness" together and found
-- neither, so it deleted nothing.
-- This pass keeps anyone whose name, email, or supplier contains Bonness,
-- including a staff member stored that way, and the jobs and client orders
-- tied to that person. Every other customer is deleted.
--
-- Catalog, prices, staff logins, and stock purchase orders with no customer
-- are left alone.
-- If Bonness is still not in the database, the error lists similar names and
-- deletes nothing.

create or replace function public.customer_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The SQL editor has no signed-in user. A purge started there may finish
  -- only while both flags are on, and only for that transaction.
  if current_setting('app.customer_purge', true) = 'on'
     and current_setting('app.allow_customer_delete', true) = 'on'
     and auth.uid() is null then
    return old;
  end if;
  if current_setting('app.allow_customer_delete', true) <> 'on' or not public.is_admin() then
    raise exception 'Customer delete must use the administrator safe-delete workflow.';
  end if;
  return old;
end;
$$;

revoke all on function public.customer_delete_guard() from public, anon, authenticated;

create or replace function public.name_has_bonness(p_value text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_value, '')) like '%bonness%';
$$;

revoke all on function public.name_has_bonness(text) from public, anon, authenticated;

create or replace function public.delete_customer_clean(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_files jsonb := '[]'::jsonb;
  v_pass int;
  v_deleted int;
  v_row_count int;
  v_actor uuid;
begin
  if auth.uid() is null then
    if current_setting('app.customer_purge', true) is distinct from 'on' then
      return jsonb_build_object('ok', false, 'error', 'not_authorized');
    end if;
  elsif not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;

  if to_regclass('public.documents') is not null then
    select coalesce(
      jsonb_agg(jsonb_build_object('bucket', 'documents', 'path', d.path))
        filter (where d.path is not null and length(btrim(d.path)) > 0),
      '[]'::jsonb
    )
      into v_files
    from public.documents d
    where d.customer_id = p_customer_id;
  end if;

  if to_regclass('public.job_files') is not null and to_regclass('public.jobs') is not null then
    select v_files || coalesce(
      jsonb_agg(jsonb_build_object('bucket', 'job-files', 'path', f.path))
        filter (where f.path is not null and length(btrim(f.path)) > 0),
      '[]'::jsonb
    )
      into v_files
    from public.job_files f
    join public.jobs j on j.id = f.job_id
    where j.customer_id = p_customer_id;
  end if;

  perform set_config('app.customer_purge', 'on', true);
  perform set_config('app.allow_customer_delete', 'on', true);

  for r in
    select
      n.nspname as child_schema,
      c.relname as child_table,
      a.attname as child_column,
      a.attnotnull as not_null,
      array_length(con.conkey, 1) as child_key_count,
      array_length(con.confkey, 1) as parent_key_count,
      pa.attname as parent_column
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = con.conrelid
     and a.attnum = con.conkey[1]
    join pg_attribute pa
      on pa.attrelid = con.confrelid
     and pa.attnum = con.confkey[1]
    where con.contype = 'f'
      and con.confrelid = 'public.customers'::regclass
  loop
    if r.child_key_count <> 1 or r.parent_key_count <> 1 or r.parent_column <> 'id' then
      raise exception 'CUSTOMER_DELETE_UNSUPPORTED'
        using hint = format('%I.%I', r.child_schema, r.child_table);
    end if;
    if not r.not_null and r.child_schema = 'public' then
      execute format(
        'update %I.%I set %I = null where %I = $1',
        r.child_schema, r.child_table, r.child_column, r.child_column
      )
      using p_customer_id;
    end if;
  end loop;

  if to_regclass('public.job_commission_payment_lines') is not null
     and to_regclass('public.job_commission_ledger') is not null
     and to_regclass('public.jobs') is not null then
    delete from public.job_commission_payment_lines
    where ledger_id in (
      select l.id
      from public.job_commission_ledger l
      join public.jobs j on j.id = l.job_id
      where j.customer_id = p_customer_id
    );
  end if;

  if to_regclass('public.refunds') is not null then
    delete from public.refunds where customer_id = p_customer_id;
  end if;

  if to_regclass('public.credit_applications') is not null
     and to_regclass('public.credit_memos') is not null
     and to_regclass('public.invoices') is not null then
    delete from public.credit_applications
    where credit_memo_id in (
        select id from public.credit_memos where customer_id = p_customer_id
      )
       or invoice_id in (
        select id from public.invoices where customer_id = p_customer_id
      );
  end if;

  if to_regclass('public.credit_memos') is not null then
    delete from public.credit_memos where customer_id = p_customer_id;
  end if;

  if to_regclass('public.customer_deposit_applications') is not null
     and to_regclass('public.customer_deposits') is not null
     and to_regclass('public.invoices') is not null then
    delete from public.customer_deposit_applications
    where deposit_id in (
        select id from public.customer_deposits where customer_id = p_customer_id
      )
       or invoice_id in (
        select id from public.invoices where customer_id = p_customer_id
      );
  end if;

  if to_regclass('public.customer_deposits') is not null then
    delete from public.customer_deposits where customer_id = p_customer_id;
  end if;

  if to_regclass('public.service_callbacks') is not null then
    delete from public.service_callbacks where customer_id = p_customer_id;
  end if;

  if to_regclass('public.opening_ar_items') is not null then
    delete from public.opening_ar_items where customer_id = p_customer_id;
  end if;

  for v_pass in 1..8 loop
    v_deleted := 0;
    for r in
      select n.nspname as child_schema, c.relname as child_table, a.attname as child_column
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a
        on a.attrelid = con.conrelid
       and a.attnum = con.conkey[1]
       and a.attnotnull
      join pg_attribute pa
        on pa.attrelid = con.confrelid
       and pa.attnum = con.confkey[1]
      where con.contype = 'f'
        and con.confrelid = 'public.customers'::regclass
        and array_length(con.conkey, 1) = 1
        and array_length(con.confkey, 1) = 1
        and pa.attname = 'id'
        and n.nspname = 'public'
        and c.relname <> 'customers'
    loop
      begin
        execute format(
          'delete from %I.%I where %I = $1',
          r.child_schema, r.child_table, r.child_column
        )
        using p_customer_id;
        get diagnostics v_row_count = row_count;
        v_deleted := v_deleted + v_row_count;
      exception
        when others then
          if v_pass = 8 then
            raise;
          end if;
      end;
    end loop;
    exit when v_deleted = 0;
  end loop;

  v_actor := auth.uid();
  if v_actor is null then
    select id into v_actor
    from public.profiles
    where role = 'admin'
    order by created_at
    limit 1;
  end if;
  if v_actor is not null then
    insert into public.customer_delete_audit (customer_id, deleted_by)
    values (p_customer_id, v_actor);
  end if;

  delete from public.customers where id = p_customer_id;

  return jsonb_build_object(
    'ok', true,
    'deleted', true,
    'files', coalesce(v_files, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.delete_customer_clean(uuid) from public, anon;
grant execute on function public.delete_customer_clean(uuid) to authenticated;

create or replace function public.purge_customers_keep_named_orders(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_staff uuid[] := '{}'::uuid[];
  v_keep_customers uuid[] := '{}'::uuid[];
  v_keep_orders uuid[] := '{}'::uuid[];
  v_keep_jobs uuid[] := '{}'::uuid[];
  v_home uuid;
  v_id uuid;
  v_result jsonb;
  v_deleted int := 0;
  v_orders_removed int := 0;
  v_supplier_hit boolean := false;
  v_near text;
begin
  if auth.uid() is not null then
    raise exception 'PURGE_SQL_EDITOR_ONLY'
      using hint = 'Run this from the Supabase SQL editor.';
  end if;
  if lower(coalesce(p_name, '')) not like '%bonness%' then
    raise exception 'PURGE_NAME_REQUIRED'
      using hint = 'This wipe keeps the Bonness orders.';
  end if;

  select coalesce(array_agg(p.id), '{}'::uuid[])
    into v_staff
  from public.profiles p
  where public.name_has_bonness(p.full_name)
     or public.name_has_bonness(p.email);

  select coalesce(array_agg(distinct id), '{}'::uuid[])
    into v_keep_customers
  from (
    select c.id
    from public.customers c
    where public.name_has_bonness(c.full_name)
       or public.name_has_bonness(c.company)
       or public.name_has_bonness(c.email)
    union
    select j.customer_id
    from public.jobs j
    where j.customer_id is not null
      and (j.assigned_to = any (v_staff) or j.created_by = any (v_staff))
  ) people
  where id is not null;

  select coalesce(array_agg(o.id), '{}'::uuid[])
    into v_keep_orders
  from public.orders o
  where public.name_has_bonness(o.contact_name)
     or public.name_has_bonness(o.contact_email)
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

  select coalesce(array_agg(o.id), '{}'::uuid[])
    into v_keep_orders
  from public.orders o
  where public.name_has_bonness(o.contact_name)
     or public.name_has_bonness(o.contact_email)
     or o.customer_id = any (v_keep_customers)
     or o.created_by = any (v_staff)
     or o.approved_by = any (v_staff);

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
      where public.name_has_bonness(po.supplier)
         or public.name_has_bonness(s.name)
    ) into v_supplier_hit;
  else
    select exists (
      select 1
      from public.purchase_orders po
      where public.name_has_bonness(po.supplier)
    ) into v_supplier_hit;
  end if;

  if cardinality(v_keep_customers) = 0
     and cardinality(v_keep_orders) = 0
     and not v_supplier_hit then
    select left(string_agg(label, ' | '), 600)
      into v_near
    from (
      select 'customer ' || full_name as label
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

  select id into v_home
  from public.customers
  where id = any (v_keep_customers)
  order by created_at
  limit 1;

  select coalesce(array_agg(distinct o.job_id), '{}'::uuid[])
    into v_keep_jobs
  from public.orders o
  where o.id = any (v_keep_orders)
    and o.job_id is not null;

  if v_home is not null and cardinality(v_keep_jobs) > 0 then
    update public.jobs
       set customer_id = v_home
     where id = any (v_keep_jobs)
       and not (customer_id = any (v_keep_customers));
  end if;

  if to_regclass('public.orders') is not null then
    delete from public.orders
    where not (id = any (v_keep_orders));
    get diagnostics v_orders_removed = row_count;
  end if;

  begin
    delete from auth.users
    where id in (
      select p.id
      from public.profiles p
      where p.role = 'customer'
        and p.customer_id is not null
        and not (p.customer_id = any (v_keep_customers))
    );
  exception
    when others then
      raise notice 'Portal logins were left in place: %', sqlerrm;
  end;

  perform set_config('app.customer_purge', 'on', true);
  perform set_config('app.allow_customer_delete', 'on', true);

  for v_id in
    select c.id
    from public.customers c
    where not (c.id = any (v_keep_customers))
  loop
    v_result := public.delete_customer_clean(v_id);
    if coalesce(v_result->>'ok', 'false') <> 'true' then
      raise exception 'CUSTOMER_PURGE_FAILED: %', v_result;
    end if;
    v_deleted := v_deleted + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'kept_customers', cardinality(v_keep_customers),
    'kept_orders', cardinality(v_keep_orders),
    'removed_other_orders', v_orders_removed,
    'deleted_customers', v_deleted
  );
end;
$$;

revoke all on function public.purge_customers_keep_named_orders(text) from public, anon, authenticated;

select public.purge_customers_keep_named_orders('John Bonness');
