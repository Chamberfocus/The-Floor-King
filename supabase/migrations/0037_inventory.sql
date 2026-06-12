-- Inventory control: per-product stock + a movement ledger (single warehouse).

alter table public.products
  add column if not exists track_stock   boolean not null default false,
  add column if not exists on_hand       numeric not null default 0,
  add column if not exists reorder_point numeric not null default 0,
  add column if not exists bin_location  text;

-- Every change to stock is recorded here (receive, pull, adjust, return).
create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  qty         numeric not null,            -- + adds stock, - removes stock
  kind        text not null,               -- receive | pull | adjust | return
  job_id      uuid references public.jobs (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists stock_movements_product_idx
  on public.stock_movements (product_id, created_at desc);

alter table public.stock_movements enable row level security;
drop policy if exists stock_movements_staff on public.stock_movements;
create policy stock_movements_staff on public.stock_movements
  for all using (public.is_staff()) with check (public.is_staff());
