-- Make the bulk import HONEST about what it did: instead of a single opaque
-- count, report how many products were newly inserted, how many existing rows
-- were actually changed, and how many matched but were left unchanged. This is
-- what lets the importer show "N new · M updated · K unchanged" so a price
-- overwrite is never silent.
--
-- Return type changes (int -> jsonb), so drop the old signature first.
-- Idempotent: safe to re-run.
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
begin
  if not public.is_staff() then
    raise exception 'not authorized';
  end if;

  for it in select * from jsonb_array_elements(items) loop
    if coalesce(nullif(trim(it->>'name'), ''), '') = '' then
      continue;
    end if;

    existing_id := null;
    if do_update then
      select id into existing_id
        from public.products
        where lower(name) = lower(it->>'name')
        limit 1;
    end if;

    if existing_id is not null then
      -- Only write when something actually differs, so we can tell an update
      -- (price/attrs changed) apart from a no-op (identical row re-imported).
      update public.products p set
        material_rate = coalesce((it->>'material_rate')::numeric, p.material_rate),
        labor_rate    = coalesce((it->>'labor_rate')::numeric, p.labor_rate),
        manufacturer  = coalesce(nullif(it->>'manufacturer', ''), p.manufacturer),
        style         = coalesce(nullif(it->>'style', ''), p.style),
        color         = coalesce(nullif(it->>'color', ''), p.color),
        unit          = coalesce(nullif(it->>'unit', ''), p.unit),
        category      = coalesce(nullif(it->>'category', '')::public.product_category, p.category),
        updated_at    = now()
      where p.id = existing_id
        and (
          p.material_rate is distinct from coalesce((it->>'material_rate')::numeric, p.material_rate)
          or p.labor_rate is distinct from coalesce((it->>'labor_rate')::numeric, p.labor_rate)
          or p.manufacturer is distinct from coalesce(nullif(it->>'manufacturer', ''), p.manufacturer)
          or p.style      is distinct from coalesce(nullif(it->>'style', ''), p.style)
          or p.color      is distinct from coalesce(nullif(it->>'color', ''), p.color)
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
        (name, category, unit, material_rate, labor_rate, sku, manufacturer, style, color, notes)
      values (
        it->>'name',
        coalesce(nullif(it->>'category', '')::public.product_category, 'other'),
        coalesce(nullif(it->>'unit', ''), 'sqft'),
        coalesce((it->>'material_rate')::numeric, 0),
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
