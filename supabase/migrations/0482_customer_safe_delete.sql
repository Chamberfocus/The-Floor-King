-- 0482_customer_safe_delete.sql
-- Customer-only archive/delete support, intentionally independent of 0480.
-- Installing this migration does not modify existing customer rows.
--
-- Archive/restore uses the existing customers.cancelled_at/cancel_reason columns.
-- Permanent delete is administrator-only and succeeds ONLY when the customer has
-- no rows in ANY foreign-key relationship pointing at customers(id). Unknown
-- dependencies therefore block deletion instead of cascading or detaching data.

create table if not exists public.customer_delete_audit (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  deleted_by uuid not null references auth.users(id),
  deleted_at timestamptz not null default now()
);

alter table public.customer_delete_audit enable row level security;

drop policy if exists customer_delete_audit_admin_read on public.customer_delete_audit;
create policy customer_delete_audit_admin_read
  on public.customer_delete_audit
  for select
  to authenticated
  using (public.is_admin());

revoke all on public.customer_delete_audit from public, anon, authenticated;
grant select on public.customer_delete_audit to authenticated;

create or replace function public.customer_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.allow_customer_delete', true) <> 'on' or not public.is_admin() then
    raise exception 'Customer delete must use the administrator safe-delete workflow.';
  end if;
  return old;
end;
$$;

revoke all on function public.customer_delete_guard() from public, anon, authenticated;

drop trigger if exists customers_safe_delete_guard on public.customers;
create trigger customers_safe_delete_guard
  before delete on public.customers
  for each row execute function public.customer_delete_guard();

create or replace function public.customer_delete_impact(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_has boolean;
  v_blockers text[] := array[]::text[];
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  for r in
    select
      n.nspname as child_schema,
      c.relname as child_table,
      a.attname as child_column,
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
      v_blockers := array_append(
        v_blockers,
        format('%I.%I (unsupported foreign key)', r.child_schema, r.child_table)
      );
      continue;
    end if;

    execute format(
      'select exists(select 1 from %I.%I where %I = $1)',
      r.child_schema,
      r.child_table,
      r.child_column
    )
    into v_has
    using p_customer_id;

    if v_has then
      v_blockers := array_append(
        v_blockers,
        format('%I.%I.%I', r.child_schema, r.child_table, r.child_column)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'can_delete', coalesce(array_length(v_blockers, 1), 0) = 0,
    'blockers', to_jsonb(v_blockers)
  );
end;
$$;

revoke all on function public.customer_delete_impact(uuid) from public, anon;
grant execute on function public.customer_delete_impact(uuid) to authenticated;

create or replace function public.delete_customer_if_unused(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_impact jsonb;
  v_can_delete boolean;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;

  v_impact := public.customer_delete_impact(p_customer_id);
  v_can_delete := coalesce((v_impact->>'can_delete')::boolean, false);

  if not v_can_delete then
    return jsonb_build_object(
      'ok', false,
      'error', 'has_dependencies',
      'blockers', coalesce(v_impact->'blockers', '[]'::jsonb)
    );
  end if;

  insert into public.customer_delete_audit (customer_id, deleted_by)
  values (p_customer_id, auth.uid());

  perform set_config('app.allow_customer_delete', 'on', true);
  delete from public.customers where id = p_customer_id;

  return jsonb_build_object('ok', true, 'deleted', true);
end;
$$;

revoke all on function public.delete_customer_if_unused(uuid) from public, anon;
grant execute on function public.delete_customer_if_unused(uuid) to authenticated;
