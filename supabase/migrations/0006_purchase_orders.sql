-- Floor King CRM — Phase 2.5: Purchase Orders
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'po_status') then
    create type public.po_status as enum ('draft', 'ordered', 'received', 'cancelled');
  end if;
end $$;

create table if not exists public.purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null,
  job_id      uuid references public.jobs (id) on delete set null,
  supplier    text,
  status      public.po_status not null default 'draft',
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists po_customer_idx
  on public.purchase_orders (customer_id, created_at desc);

create table if not exists public.po_items (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references public.purchase_orders (id) on delete cascade,
  product_id  uuid references public.products (id) on delete set null,
  position    int not null default 0,
  description text not null default '',
  quantity    numeric(12, 2),
  unit        text not null default 'sqft',
  unit_cost   numeric(12, 2)
);
create index if not exists po_items_po_idx on public.po_items (po_id, position);

drop trigger if exists purchase_orders_set_updated_at on public.purchase_orders;
create trigger purchase_orders_set_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

alter table public.purchase_orders enable row level security;
alter table public.po_items enable row level security;

drop policy if exists purchase_orders_staff_all on public.purchase_orders;
create policy purchase_orders_staff_all on public.purchase_orders
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists po_items_staff_all on public.po_items;
create policy po_items_staff_all on public.po_items
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.po_items to authenticated;
