-- Raise every stored material cost by 5%. Safe to run again: the marker row
-- stops a second pass, so costs cannot compound.
--
-- What moves (cents; a cost so small that 5% does not change the cent stays):
--   products.material_rate     our catalog material cost, when it is above 0
--   product_vendors.cost       each vendor unit cost, when it is above 0
--   addon_defaults.cost        saved material add-on cost (not a labor add-on)
--   room_defaults.material_cost saved material cost for a flooring type
--
-- A blank catalog cost stays blank. material_rate 0 with no vendor cost means
-- the price is missing, not free. An explicit vendor cost of 0 stays 0, and
-- that 0 still wins over material_rate when a quote is priced.
--
-- What stays:
--   install labor, including add-on rows marked labor
--   clearance shelf prices and other saved sell prices
--   inventory average cost and carrying value (stock already purchased)
--   quotes and orders already written
--
-- New quotes read the new cost. Sell on a new quote uses the same margin, so
-- the material price on a new quote rises with the cost. A quote already saved
-- keeps the cost it was written with.
-- Does not enable accounting.

create table if not exists public.catalog_cost_adjustments (
  id text primary key,
  factor numeric(8, 4) not null,
  applied_at timestamptz not null default now(),
  products_updated integer not null default 0,
  vendor_costs_updated integer not null default 0,
  addon_costs_updated integer not null default 0,
  room_costs_updated integer not null default 0
);

comment on table public.catalog_cost_adjustments is
  'One row per catalog cost change that must never run twice.';

alter table public.catalog_cost_adjustments enable row level security;
revoke all on table public.catalog_cost_adjustments from public, anon, authenticated;

do $$
declare
  v_products integer := 0;
  v_vendors integer := 0;
  v_addons integer := 0;
  v_rooms integer := 0;
begin
  if exists (
    select 1 from public.catalog_cost_adjustments where id = 'material-cost-plus-5'
  ) then
    raise notice 'Material cost +5%% already applied. No costs were changed.';
    return;
  end if;

  -- Record the quoting cost while the old number is still on the row.
  -- Vendor cost wins when one is recorded; otherwise the catalog material cost.
  insert into public.product_price_history (product_id, old_cost, new_cost, source)
  select
    p.id,
    src.old_cost,
    round(src.old_cost * 1.05, 2),
    'material-cost-plus-5'
  from public.products p
  cross join lateral (
    select coalesce(
      (
        select pv.cost
          from public.product_vendors pv
         where pv.product_id = p.id
           and pv.cost is not null
         order by pv.position asc, pv.created_at asc
         limit 1
      ),
      case when p.material_rate > 0 then p.material_rate else null end
    ) as old_cost
  ) src
  where src.old_cost > 0
    and round(src.old_cost * 1.05, 2) is distinct from src.old_cost;

  update public.product_vendors
     set cost = round(cost * 1.05, 2)
   where cost > 0
     and round(cost * 1.05, 2) is distinct from cost;
  get diagnostics v_vendors = row_count;

  update public.products
     set material_rate = round(material_rate * 1.05, 2)
   where material_rate > 0
     and round(material_rate * 1.05, 2) is distinct from material_rate;
  get diagnostics v_products = row_count;

  update public.addon_defaults
     set cost = round(cost * 1.05, 2)
   where labor is not true
     and cost > 0
     and round(cost * 1.05, 2) is distinct from cost;
  get diagnostics v_addons = row_count;

  update public.room_defaults
     set material_cost = round(material_cost * 1.05, 2)
   where material_cost > 0
     and round(material_cost * 1.05, 2) is distinct from material_cost;
  get diagnostics v_rooms = row_count;

  insert into public.catalog_cost_adjustments (
    id, factor, products_updated, vendor_costs_updated,
    addon_costs_updated, room_costs_updated
  ) values (
    'material-cost-plus-5', 1.0500, v_products, v_vendors, v_addons, v_rooms
  );

  raise notice 'Material costs +5%%: % catalog costs, % vendor costs, % add-on costs, % room costs.',
    v_products, v_vendors, v_addons, v_rooms;
end $$;
