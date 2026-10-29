-- Catalog search also matches notes, where a color number is kept.
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- search_text already holds name, manufacturer, style, color, sku, and
-- supplier. A color number that sits beside a color name is stored in notes
-- ("Color # 00712") so the color name stays clean. 0187 never read notes, so
-- typing that number found nothing.
--
-- This does not rewrite products and does not change the generated search_text
-- column. Notes are folded into the search haystack at query time.
-- Does not enable accounting. Does not read avg_unit_cost or
-- inventory_carrying_value (still projected as NULL, same as 0187).

create extension if not exists pg_trgm;

create or replace function public.search_products(
  q text,
  lim int default 50,
  include_labor boolean default false,
  active_only boolean default true
)
returns setof public.products
language plpgsql
stable
as $$
declare
  toks text[];
  n    int;
  cols text;
begin
  -- Never SELECT revoked valuation columns (0176). Project them as NULL so the
  -- return type remains setof public.products without reading those fields.
  select string_agg(
    case
      when a.attname in ('avg_unit_cost', 'inventory_carrying_value') then
        format('null::%s as %I', format_type(a.atttypid, a.atttypmod), a.attname)
      else format('p.%I', a.attname)
    end,
    ', ' order by a.attnum
  )
  into cols
  from pg_attribute a
  where a.attrelid = 'public.products'::regclass
    and a.attnum > 0
    and not a.attisdropped;

  if cols is null or length(cols) = 0 then
    raise exception '0503_SEARCH: no products columns to project';
  end if;

  q := trim(coalesce(q, ''));
  if q = '' then
    return query execute format(
      $sql$
        select %s
          from public.products p
         where ($1 is not true or p.active)
           and ($2 is true or p.category is distinct from 'labor')
         order by p.name
         limit $3
      $sql$, cols)
      using active_only, include_labor, lim;
    return;
  end if;

  toks := array_remove(regexp_split_to_array(lower(q), '[^a-z0-9/.]+'), '');
  n := coalesce(array_length(toks, 1), 0);
  if n = 0 then
    return query execute format(
      $sql$
        select %s
          from public.products p
         where ($1 is not true or p.active)
           and ($2 is true or p.category is distinct from 'labor')
         order by p.name
         limit $3
      $sql$, cols)
      using active_only, include_labor, lim;
    return;
  end if;

  return query execute format(
    $sql$
    with base as (
      select
        %s,
        lower(p.name) as _nm,
        lower(
          coalesce(p.search_text, '') || ' ' ||
          coalesce(p.notes, '') || ' ' ||
          coalesce(p.style, '') || ' ' ||
          coalesce(p.color, '') || ' ' ||
          coalesce(p.sku, '') || ' ' ||
          coalesce(p.category::text, '')
        ) as _hay
      from public.products p
      where ($1 is not true or p.active)
        and ($2 is true or p.category is distinct from 'labor')
    ),
    scored as (
      select
        b.*,
        (select coalesce(sum(
           case
             when position(t in b._nm) > 0 then 4
             when position(t in b._hay) > 0 then 3
             when length(t) >= 4
                  and word_similarity(t, b._hay) >= 0.6 then 2
             else 0
           end), 0)
         from unnest($4::text[]) t) as _score,
        (select count(*) from unnest($4::text[]) t
          where position(t in b._hay) > 0
             or (length(t) >= 4 and word_similarity(t, b._hay) >= 0.6)
        ) as _hits
      from base b
    )
    select %s
      from scored s
     where s._score > 0
     order by
       (s._hits = $5) desc,
       s._score desc,
       similarity(s._nm, lower($6)) desc,
       s.name
     limit $3
    $sql$,
    cols,
    (
      select string_agg(format('s.%I', a.attname), ', ' order by a.attnum)
      from pg_attribute a
      where a.attrelid = 'public.products'::regclass
        and a.attnum > 0
        and not a.attisdropped
    )
  )
  using active_only, include_labor, lim, toks, n, q;
end;
$$;

comment on function public.search_products(text, int, boolean, boolean) is
  '0503: catalog search includes notes (color numbers) plus style, color, and sku. Does not read avg_unit_cost / inventory_carrying_value.';

revoke all on function public.search_products(text, int, boolean, boolean) from public;
revoke all on function public.search_products(text, int, boolean, boolean) from anon;
grant execute on function public.search_products(text, int, boolean, boolean) to authenticated;
grant execute on function public.search_products(text, int, boolean, boolean) to service_role;
