-- Aged-stock detection + clearance pricing.

alter table public.products
  add column if not exists clearance        boolean not null default false,
  add column if not exists clearance_price  numeric,
  add column if not exists last_movement_at timestamptz;

-- Anchor aging on the most recent stock movement, else when the product was made.
update public.products p
  set last_movement_at = coalesce(
    (select max(m.created_at) from public.stock_movements m where m.product_id = p.id),
    p.created_at
  )
  where last_movement_at is null;
