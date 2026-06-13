-- Fast bulk import: insert (and optionally update-by-name) many products in a
-- single call, so re-importing a price list updates prices instead of making
-- duplicates. Staff-only.
create or replace function public.import_products(items jsonb, do_update boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  n int := 0;
  existing_id uuid;
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
      update public.products set
        material_rate = coalesce((it->>'material_rate')::numeric, material_rate),
        labor_rate    = coalesce((it->>'labor_rate')::numeric, labor_rate),
        manufacturer  = coalesce(nullif(it->>'manufacturer', ''), manufacturer),
        style         = coalesce(nullif(it->>'style', ''), style),
        color         = coalesce(nullif(it->>'color', ''), color),
        unit          = coalesce(nullif(it->>'unit', ''), unit),
        category      = coalesce(nullif(it->>'category', '')::public.product_category, category),
        updated_at    = now()
      where id = existing_id;
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
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
