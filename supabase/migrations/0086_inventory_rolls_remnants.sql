-- Floor King CRM — full inventory control: on-order state, item classification,
-- stock-replenishment POs, and rolled-goods (rolls + remnants). Idempotent.

-- 1) Products: on-order (PO placed, not arrived) + discrete/rolled classification
alter table public.products
  add column if not exists on_order   numeric not null default 0,
  add column if not exists stock_kind text not null default 'discrete'; -- discrete | rolled

-- Default rolled for measured units (safe: only flips items that clearly measure).
update public.products
  set stock_kind = 'rolled'
  where stock_kind = 'discrete'
    and lower(coalesce(unit,'')) in ('sqyd','sq yd','lnft','ln ft','yd');

-- 2) Purchase orders: a warehouse restock PO (no customer/estimate) is a stock PO.
alter table public.purchase_orders
  add column if not exists is_stock boolean not null default false;

-- Partial receipts: track how much of each line has actually arrived.
alter table public.po_items
  add column if not exists received_qty numeric not null default 0;

-- 3) Rolled goods — individual rolls AND remnants (offcuts) as their own stock.
create table if not exists public.stock_rolls (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products (id) on delete cascade,
  kind           text not null default 'roll',       -- roll | remnant
  unit           text not null default 'sqyd',       -- sqyd | lnft
  width_ft       numeric,                             -- carpet/broadloom roll width
  initial_qty    numeric not null default 0,
  remaining_qty  numeric not null default 0,
  location       text,                                -- searchable, e.g. "Rack 3, Bay B"
  status         text not null default 'available',   -- available | depleted | scrapped
  usable         boolean,                             -- remnants: null=undecided
  needs_shelving boolean not null default false,      -- new remnant awaiting location/call
  source_roll_id uuid references public.stock_rolls (id) on delete set null,
  source_po_id   uuid references public.purchase_orders (id) on delete set null,
  job_id         uuid references public.jobs (id) on delete set null, -- created by which job cut
  scrap_reason   text,
  note           text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists stock_rolls_product_idx on public.stock_rolls (product_id, status);
create index if not exists stock_rolls_shelving_idx on public.stock_rolls (needs_shelving) where needs_shelving;
create index if not exists stock_rolls_location_idx on public.stock_rolls (lower(location));

drop trigger if exists stock_rolls_set_updated_at on public.stock_rolls;
create trigger stock_rolls_set_updated_at
  before update on public.stock_rolls
  for each row execute function public.set_updated_at();

alter table public.stock_rolls enable row level security;
drop policy if exists stock_rolls_staff on public.stock_rolls;
create policy stock_rolls_staff on public.stock_rolls
  for all to authenticated
  using (public.is_staff() or public.my_role() = 'warehouse')
  with check (public.is_staff() or public.my_role() = 'warehouse');
grant select, insert, update, delete on public.stock_rolls to authenticated;

-- 4) Tie a stock movement to the specific roll/remnant it changed (audit trail).
alter table public.stock_movements
  add column if not exists roll_id uuid references public.stock_rolls (id) on delete set null;
