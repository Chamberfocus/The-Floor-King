-- Floor King CRM — Phase 1: Customers, Leads pipeline, Activities
-- Run in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

-- 1) Enums -------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_stage') then
    create type public.lead_stage as enum
      ('new', 'contacted', 'estimate_scheduled', 'quoted', 'won', 'lost');
  end if;
  if not exists (select 1 from pg_type where typname = 'lead_source') then
    create type public.lead_source as enum
      ('referral', 'google', 'website', 'angi', 'facebook', 'repeat', 'walk_in', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'activity_type') then
    create type public.activity_type as enum
      ('note', 'call', 'text', 'email', 'stage_change', 'system');
  end if;
end $$;

-- 2) Customers (every lead and customer is a row here) -----------------------
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  company      text,
  email        text,
  phone        text,
  street       text,
  city         text,
  state        text,
  zip          text,
  stage        public.lead_stage not null default 'new',
  source       public.lead_source,
  notes        text,
  assigned_to  uuid references auth.users (id) on delete set null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists customers_stage_idx on public.customers (stage);
create index if not exists customers_created_at_idx on public.customers (created_at desc);
create index if not exists customers_name_idx on public.customers (lower(full_name));

-- 3) Activities (timeline of notes / calls / stage changes) ------------------
create table if not exists public.activities (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  type         public.activity_type not null default 'note',
  body         text,
  created_at   timestamptz not null default now()
);

create index if not exists activities_customer_idx
  on public.activities (customer_id, created_at desc);

-- 4) Keep updated_at fresh ---------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- 5) Row-Level Security ------------------------------------------------------
alter table public.customers  enable row level security;
alter table public.activities enable row level security;

-- Staff (admin/office): full access.
drop policy if exists customers_staff_all on public.customers;
create policy customers_staff_all on public.customers
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Field crew: read-only (they need customer/site info on the job).
drop policy if exists customers_crew_read on public.customers;
create policy customers_crew_read on public.customers
  for select to authenticated
  using (public.user_role(auth.uid()) = 'crew');

drop policy if exists activities_staff_all on public.activities;
create policy activities_staff_all on public.activities
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists activities_crew_read on public.activities;
create policy activities_crew_read on public.activities
  for select to authenticated
  using (public.user_role(auth.uid()) = 'crew');

grant select, insert, update, delete on public.customers  to authenticated;
grant select, insert, update, delete on public.activities to authenticated;
