-- Floor King CRM — client-submitted carpet orders (cash-and-carry / pickup).
-- A client (portal trade account OR a public link) submits an order; the owner
-- approves it; approval creates a cash-and-carry job that flows into the
-- warehouse cut → stage → ready-for-pickup flow. Safe to re-run.

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid references public.customers (id) on delete set null, -- set for portal accounts
  contact_name  text,
  contact_phone text,
  contact_email text,
  status        text not null default 'submitted', -- submitted | approved | declined | cancelled
  source        text not null default 'public',    -- 'portal' | 'public'
  notes         text,
  decline_reason text,
  job_id        uuid references public.jobs (id) on delete set null, -- the job created on approval
  created_by    uuid references auth.users (id) on delete set null,
  approved_by   uuid references auth.users (id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists orders_customer_idx on public.orders (customer_id);

create table if not exists public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  product_id  uuid references public.products (id) on delete set null, -- if picked from catalog
  position    int not null default 0,
  description text not null default '',
  color       text,
  style       text,
  quantity    numeric(12, 2),
  unit        text not null default 'sq yd',
  cut_notes   text
);
create index if not exists order_items_order_idx on public.order_items (order_id, position);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Staff: full access.
drop policy if exists orders_staff_all on public.orders;
create policy orders_staff_all on public.orders
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists order_items_staff_all on public.order_items;
create policy order_items_staff_all on public.order_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Portal customers: read/create their own orders.
drop policy if exists orders_own_read on public.orders;
create policy orders_own_read on public.orders
  for select to authenticated using (customer_id = public.my_customer_id());
drop policy if exists orders_own_insert on public.orders;
create policy orders_own_insert on public.orders
  for insert to authenticated with check (customer_id = public.my_customer_id());
drop policy if exists order_items_own on public.order_items;
create policy order_items_own on public.order_items
  for all to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = public.my_customer_id()))
  with check (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = public.my_customer_id()));

grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- Realtime: the owner's Orders queue updates the moment a client submits one.
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;
