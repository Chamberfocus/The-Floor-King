-- Floor King CRM — Phase 9: Workflow stages, owners & handoffs
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

-- Employee job title (for handoff search by title)
alter table public.profiles add column if not exists title text;

create table if not exists public.workflow_stages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  position      int not null default 0,
  color         text not null default 'zinc',
  default_owner uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table public.customers
  add column if not exists workflow_stage_id uuid references public.workflow_stages (id) on delete set null;
alter table public.customers
  add column if not exists workflow_owner_id uuid references auth.users (id) on delete set null;
create index if not exists customers_workflow_idx on public.customers (workflow_stage_id);
create index if not exists customers_workflow_owner_idx on public.customers (workflow_owner_id);

create table if not exists public.handoffs (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers (id) on delete cascade,
  from_stage_id uuid references public.workflow_stages (id) on delete set null,
  to_stage_id   uuid references public.workflow_stages (id) on delete set null,
  from_user     uuid references auth.users (id) on delete set null,
  to_user       uuid references auth.users (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists handoffs_customer_idx on public.handoffs (customer_id, created_at desc);

alter table public.workflow_stages enable row level security;
alter table public.handoffs enable row level security;

-- Stages: staff manage; everyone signed-in can read (owners/crew see stage names).
drop policy if exists workflow_stages_staff_all on public.workflow_stages;
create policy workflow_stages_staff_all on public.workflow_stages
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists workflow_stages_read on public.workflow_stages;
create policy workflow_stages_read on public.workflow_stages
  for select to authenticated using (true);

-- Handoffs: staff manage; a user can see handoffs to/from them.
drop policy if exists handoffs_staff_all on public.handoffs;
create policy handoffs_staff_all on public.handoffs
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists handoffs_mine on public.handoffs;
create policy handoffs_mine on public.handoffs
  for select to authenticated
  using (to_user = auth.uid() or from_user = auth.uid());

grant select, insert, update, delete on public.workflow_stages to authenticated;
grant select, insert, update, delete on public.handoffs to authenticated;

-- Seed the default lifecycle stages.
do $$ begin
  if not exists (select 1 from public.workflow_stages) then
    insert into public.workflow_stages (name, position, color) values
      ('New Lead', 10, 'blue'),
      ('Estimating', 20, 'amber'),
      ('Proposal Sent', 30, 'cyan'),
      ('Sold / Approved', 40, 'green'),
      ('Materials & Warehouse', 50, 'purple'),
      ('Scheduling', 60, 'indigo'),
      ('Installation', 70, 'teal'),
      ('Invoicing & Payment', 80, 'rose'),
      ('Complete', 90, 'zinc');
  end if;
end $$;
