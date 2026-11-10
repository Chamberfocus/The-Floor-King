-- Floor King — keep the roll price from a mill price sheet.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- A carpet or sheet-vinyl price book prices a CUT (what we pay to cut a piece
-- off the roll) and, when the mill bothers, a full ROLL. The cut price stays
-- products.material_rate — that is the catalog cost estimates and purchase
-- orders use. The roll price is a second number, not a second product.
--
-- 0176 revoked table SELECT on products and re-granted columns one by one, so
-- a column added later is invisible until it is granted here.

alter table public.products
  add column if not exists roll_rate numeric;

comment on column public.products.roll_rate is
  'Full-roll unit cost when a mill prices a roll separately from a cut. Null when the sheet has one price. Estimates use material_rate (the cut), not this.';

grant select (roll_rate) on public.products to authenticated;

-- import_products learns the roll price, and a re-import can refresh the style
-- number and the notes (where a color number is kept). Return shape is unchanged.
drop function if exists public.import_products(jsonb, boolean);

create or replace function public.import_products(items jsonb, do_update boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  existing_id uuid;
  inserted int := 0;
  updated int := 0;
  unchanged int := 0;
  touched int := 0;
  next_roll numeric;
begin
  if not public.is_staff() then
    raise exception 'not authorized';
  end if;

  for it in select * from jsonb_array_elements(items) loop
    if coalesce(nullif(trim(it->>'name'), ''), '') = '' then
      continue;
    end if;

    next_roll := null;
    if it ? 'roll_rate' and nullif(it->>'roll_rate', '') is not null then
      next_roll := (it->>'roll_rate')::numeric;
    end if;

    existing_id := null;
    if do_update then
      select id into existing_id
        from public.products
        where lower(name) = lower(it->>'name')
        limit 1;
    end if;

    if existing_id is not null then
      update public.products p set
        material_rate = coalesce((it->>'material_rate')::numeric, p.material_rate),
        roll_rate     = coalesce(next_roll, p.roll_rate),
        labor_rate    = coalesce((it->>'labor_rate')::numeric, p.labor_rate),
        manufacturer  = coalesce(nullif(it->>'manufacturer', ''), p.manufacturer),
        style         = coalesce(nullif(it->>'style', ''), p.style),
        color         = coalesce(nullif(it->>'color', ''), p.color),
        sku           = coalesce(nullif(it->>'sku', ''), p.sku),
        notes         = coalesce(nullif(it->>'notes', ''), p.notes),
        unit          = coalesce(nullif(it->>'unit', ''), p.unit),
        category      = coalesce(nullif(it->>'category', '')::public.product_category, p.category),
        updated_at    = now()
      where p.id = existing_id
        and (
          p.material_rate is distinct from coalesce((it->>'material_rate')::numeric, p.material_rate)
          or p.roll_rate  is distinct from coalesce(next_roll, p.roll_rate)
          or p.labor_rate is distinct from coalesce((it->>'labor_rate')::numeric, p.labor_rate)
          or p.manufacturer is distinct from coalesce(nullif(it->>'manufacturer', ''), p.manufacturer)
          or p.style      is distinct from coalesce(nullif(it->>'style', ''), p.style)
          or p.color      is distinct from coalesce(nullif(it->>'color', ''), p.color)
          or p.sku        is distinct from coalesce(nullif(it->>'sku', ''), p.sku)
          or p.notes      is distinct from coalesce(nullif(it->>'notes', ''), p.notes)
          or p.unit       is distinct from coalesce(nullif(it->>'unit', ''), p.unit)
          or p.category   is distinct from coalesce(nullif(it->>'category', '')::public.product_category, p.category)
        );
      get diagnostics touched = row_count;
      if touched > 0 then
        updated := updated + 1;
      else
        unchanged := unchanged + 1;
      end if;
    else
      insert into public.products
        (name, category, unit, material_rate, roll_rate, labor_rate, sku, manufacturer, style, color, notes)
      values (
        it->>'name',
        coalesce(nullif(it->>'category', '')::public.product_category, 'other'),
        coalesce(nullif(it->>'unit', ''), 'sqft'),
        coalesce((it->>'material_rate')::numeric, 0),
        next_roll,
        coalesce((it->>'labor_rate')::numeric, 0),
        nullif(it->>'sku', ''),
        nullif(it->>'manufacturer', ''),
        nullif(it->>'style', ''),
        nullif(it->>'color', ''),
        nullif(it->>'notes', '')
      );
      inserted := inserted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', inserted,
    'updated', updated,
    'unchanged', unchanged,
    'total', inserted + updated + unchanged
  );
end $$;
