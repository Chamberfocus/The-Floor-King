-- What a manufacturer or distributor last told us about an item we sell.
-- Mill stock is not our warehouse on_hand. A price file never changes a cost
-- by itself. Does not enable accounting. Does not turn posting on.

create table if not exists public.supplier_item_facts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  supplier_sku text not null,
  available_qty numeric(14, 3),
  available_uom text,
  roll_width_ft numeric(10, 3),
  roll_length_ft numeric(10, 3),
  description text,
  spec_url text,
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  unique (supplier_id, supplier_sku)
);

create index if not exists supplier_item_facts_sku_idx
  on public.supplier_item_facts (supplier_sku);

comment on table public.supplier_item_facts is
  'Latest mill or distributor stock, roll size, and spec link for a SKU we sell. Separate from products.on_hand.';

alter table public.supplier_item_facts enable row level security;

-- Sales and warehouse can read mill availability. They cannot write it.
drop policy if exists supplier_item_facts_read on public.supplier_item_facts;
create policy supplier_item_facts_read on public.supplier_item_facts
  for select to authenticated
  using (
    public.user_role(auth.uid())::text in (
      'admin', 'office', 'sales_manager', 'salesman', 'scheduler', 'warehouse'
    )
  );

-- Only the office saves what a mill sent. A feed still cannot change a cost.
drop policy if exists supplier_item_facts_write on public.supplier_item_facts;
create policy supplier_item_facts_write on public.supplier_item_facts
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select, insert, update, delete on public.supplier_item_facts to authenticated;
