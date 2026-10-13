-- Role checks on isolated staging. Always ends with ROLLBACK.
-- The crew profile role changes only inside this transaction.

begin;

do $role_identity$
begin
  if (select project_ref from public.floor_king_database_identity where id = 1)
     is distinct from 'lsrapxmkspocxeeakkcx' then
    raise exception 'LAUNCH_ASSERT: refusing tests outside staging';
  end if;
end
$role_identity$;

do $role_seed$
declare
  v_actor uuid;
  v_admin uuid;
  v_open uuid;
  v_assigned uuid;
begin
  select id into v_actor from auth.users where email = 'crew.test@clevelandfloorking.com';
  select id into v_admin from auth.users where email = 'karam@clevelandfloorking.com';
  if v_actor is null or v_admin is null then
    raise exception 'LAUNCH_ASSERT: synthetic staff users missing';
  end if;
  insert into public.customers (full_name)
  values ('Launch Role Unassigned')
  returning id into v_open;
  insert into public.customers (full_name, assigned_to)
  values ('Launch Role Assigned', v_actor)
  returning id into v_assigned;
  perform set_config('app.probe_actor', v_actor::text, true);
  perform set_config('app.probe_admin', v_admin::text, true);
  perform set_config('app.probe_open', v_open::text, true);
  perform set_config('app.probe_assigned', v_assigned::text, true);
end
$role_seed$;

-- salesman: own customers only, and no write to someone else's customer.
update public.profiles
set role = 'salesman'::public.user_role
where id = current_setting('app.probe_actor')::uuid;
select set_config(
  'request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('app.probe_actor'))::text,
  true
);
set local role authenticated;

do $salesman$
declare
  v_open uuid;
  v_assigned uuid;
  v_seen int;
  v_updated int;
begin
  v_open := current_setting('app.probe_open')::uuid;
  v_assigned := current_setting('app.probe_assigned')::uuid;
  select count(*) into v_seen from public.customers where id = v_open;
  if v_seen <> 0 then
    raise exception 'LAUNCH_ASSERT: salesman can read an unassigned customer';
  end if;
  select count(*) into v_seen from public.customers where id = v_assigned;
  if v_seen <> 1 then
    raise exception 'LAUNCH_ASSERT: salesman cannot read an assigned customer';
  end if;
  update public.customers set notes = 'salesman probe' where id = v_open;
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'LAUNCH_ASSERT: salesman updated an unassigned customer';
  end if;
end
$salesman$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles
set role = 'sales_manager'::public.user_role
where id = current_setting('app.probe_actor')::uuid;
select set_config(
  'request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('app.probe_actor'))::text,
  true
);
set local role authenticated;

do $sales_manager$
declare
  v_open uuid;
  v_updated int;
  v_seen int;
begin
  v_open := current_setting('app.probe_open')::uuid;
  select count(*) into v_seen from public.customers where id = v_open;
  if v_seen <> 1 then
    raise exception 'LAUNCH_ASSERT: sales manager cannot read a customer';
  end if;
  update public.customers set notes = 'manager probe' where id = v_open;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'LAUNCH_ASSERT: sales manager could not update a customer';
  end if;
end
$sales_manager$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles
set role = 'scheduler'::public.user_role
where id = current_setting('app.probe_actor')::uuid;
select set_config(
  'request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('app.probe_actor'))::text,
  true
);
set local role authenticated;

do $scheduler$
declare
  v_open uuid;
  v_seen int;
  v_updated int;
begin
  v_open := current_setting('app.probe_open')::uuid;
  select count(*) into v_seen from public.customers where id = v_open;
  if v_seen <> 1 then
    raise exception 'LAUNCH_ASSERT: scheduler cannot read a customer';
  end if;
  update public.customers set notes = 'scheduler probe' where id = v_open;
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'LAUNCH_ASSERT: scheduler updated a customer';
  end if;
end
$scheduler$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles
set role = 'warehouse'::public.user_role
where id = current_setting('app.probe_actor')::uuid;
select set_config(
  'request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('app.probe_actor'))::text,
  true
);
set local role authenticated;

do $warehouse$
declare
  v_open uuid;
  v_seen int;
  v_updated int;
begin
  v_open := current_setting('app.probe_open')::uuid;
  select count(*) into v_seen from public.customers where id = v_open;
  if v_seen <> 1 then
    raise exception 'LAUNCH_ASSERT: warehouse cannot read a customer';
  end if;
  update public.customers set notes = 'warehouse probe' where id = v_open;
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'LAUNCH_ASSERT: warehouse updated a customer';
  end if;
end
$warehouse$;

reset role;
select set_config(
  'request.jwt.claims',
  json_build_object('role', 'authenticated', 'sub', current_setting('app.probe_admin'))::text,
  true
);
set local role authenticated;

do $admin$
declare
  v_open uuid;
  v_seen int;
begin
  v_open := current_setting('app.probe_open')::uuid;
  select count(*) into v_seen from public.customers where id = v_open;
  if v_seen <> 1 then
    raise exception 'LAUNCH_ASSERT: admin cannot read a customer';
  end if;
end
$admin$;

reset role;
rollback;
