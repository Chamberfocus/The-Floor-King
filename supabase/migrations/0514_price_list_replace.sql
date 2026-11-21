-- Turn off duplicate catalog products. Keeps the newest priced copy.
-- Run in the Supabase SQL editor. Idempotent.
-- Does not delete rows. Does not change the price on the copy that stays.
-- Does NOT enable accounting.

begin;

with ranked as (
  select
    id,
    row_number() over (
      partition by lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
      order by
        (coalesce(material_rate, 0) > 0) desc,
        updated_at desc nulls last,
        created_at desc,
        id
    ) as n
  from public.products
  where active is distinct from false
    and category is distinct from 'labor'
    and coalesce(trim(name), '') <> ''
)
update public.products
   set active = false,
       updated_at = now()
 where id in (select id from ranked where n > 1);

with ranked as (
  select
    id,
    row_number() over (
      partition by
        lower(trim(coalesce(manufacturer, ''))),
        lower(trim(style)),
        lower(trim(color)),
        lower(trim(coalesce(unit, ''))),
        category
      order by
        (coalesce(material_rate, 0) > 0) desc,
        updated_at desc nulls last,
        created_at desc,
        id
    ) as n
  from public.products
  where active is distinct from false
    and category is distinct from 'labor'
    and coalesce(trim(style), '') <> ''
    and coalesce(trim(color), '') <> ''
)
update public.products
   set active = false,
       updated_at = now()
 where id in (select id from ranked where n > 1);

commit;
