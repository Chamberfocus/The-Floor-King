-- Floor King CRM — initial schema (Phase 0)
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is safe to re-run.

-- 1) Roles -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'office', 'crew', 'customer');
  end if;
end
$$;

-- 2) Profiles (one row per auth user) ----------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  phone       text,
  role        public.user_role not null default 'customer',
  created_at  timestamptz not null default now()
);

-- 3) Helper functions (SECURITY DEFINER avoids RLS recursion) -----------------
create or replace function public.user_role(uid uuid)
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = uid;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_role(auth.uid()) in ('admin', 'office');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_role(auth.uid()) = 'admin';
$$;

-- 4) Auto-create a profile whenever a new auth user is created ----------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'customer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) Prevent users from escalating their own role ----------------------------
-- (Role changes are allowed for admins, or via the service role / SQL editor
--  where there is no authenticated user.)
create or replace function public.prevent_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_no_role_escalation on public.profiles;
create trigger profiles_no_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- 6) Row-Level Security ------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own_or_staff" on public.profiles;
create policy "profiles_select_own_or_staff"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id or public.is_staff());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;

-- 7) After creating your own user, promote yourself to admin -----------------
-- Run this once (replace the email if needed):
--   update public.profiles set role = 'admin'
--   where email = 'karam@clevelandfloorking.com';
