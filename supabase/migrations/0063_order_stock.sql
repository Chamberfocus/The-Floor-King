-- Floor King CRM — order stock signal + invoice link.
-- The warehouse flags whether an incoming order is in stock (fast, before you
-- approve); you relay it to the customer; and you can invoice from an approved
-- order. Safe to re-run.

alter table public.orders
  add column if not exists stock_status text not null default 'unknown', -- unknown | in_stock | out_of_stock | partial
  add column if not exists stock_note   text,
  add column if not exists stock_checked_by uuid references auth.users (id) on delete set null,
  add column if not exists stock_checked_at timestamptz,
  add column if not exists customer_stock_notified_at timestamptz,
  add column if not exists invoice_id   uuid references public.invoices (id) on delete set null;

-- Warehouse needs to SEE incoming orders to flag stock (the stock update itself
-- is done by a role-guarded server action on the admin client, so no broad
-- write grant is needed here).
drop policy if exists orders_warehouse_read on public.orders;
create policy orders_warehouse_read on public.orders
  for select to authenticated
  using (public.user_role(auth.uid())::text = 'warehouse');

drop policy if exists order_items_warehouse_read on public.order_items;
create policy order_items_warehouse_read on public.order_items
  for select to authenticated
  using (public.user_role(auth.uid())::text = 'warehouse');
