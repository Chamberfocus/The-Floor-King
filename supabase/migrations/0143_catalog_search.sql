-- Floor King — catalog search that finds things and finds them fast.
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- WHAT'S WRONG TODAY
--
-- The picker ORs an ILIKE across six columns for every token, pulls back up to
-- 400 rows, and ranks them in JavaScript. Measured against the live catalog of
-- 13,574 products:
--
--   "shaw"        418ms
--   "dreamweaver" 426ms   (266 results, ordered alphabetically before ranking)
--   "cushion"       0 results
--   "1/2 8lb"       0 results
--   "anso nylon"    0 results
--   "rev wood"      0 results
--
-- The zeros are the real damage. Multiple tokens are ANDed and each must appear
-- as a literal substring, so a search only works if you type a fragment of the
-- product's own name in the right order. "cushion" finds nothing because the
-- catalog says "padding". "1/2 8lb" — the exact search asked for months ago —
-- finds nothing because no single field contains both.
--
-- THE FIX
--
-- One indexed text column holding everything worth matching, trigram-indexed,
-- and ranking done in Postgres where the index can be used. Strict matching
-- first (all tokens present, so a precise search stays precise); if that finds
-- nothing, fall back to fuzzy similarity instead of showing an empty list.

create extension if not exists pg_trgm;

-- 1 · Everything searchable, in one column -----------------------------------
-- Generated, so it can never drift from the row it describes.
alter table public.products
  add column if not exists search_text text
  generated always as (
    coalesce(name, '') || ' ' ||
    coalesce(manufacturer, '') || ' ' ||
    coalesce(style, '') || ' ' ||
    coalesce(color, '') || ' ' ||
    coalesce(sku, '') || ' ' ||
    coalesce(supplier, '')
  ) stored;

create index if not exists products_search_trgm_idx
  on public.products using gin (search_text gin_trgm_ops);

-- 2 · The search ------------------------------------------------------------
-- Ranks in SQL so the best match is first out of the database, not the
-- alphabetically-first 400 re-sorted afterwards.
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
  hits int;
begin
  q := trim(coalesce(q, ''));
  if q = '' then
    return query
      select * from public.products p
       where (not active_only or p.active)
         and (include_labor or p.category is distinct from 'labor')
       order by p.name
       limit lim;
    return;
  end if;

  toks := regexp_split_to_array(lower(q), '\s+');

  -- Strict: every token appears somewhere in the row. Ordered by how close the
  -- NAME is to what was typed, so "shaw" leads with the Shaw-branded items
  -- rather than whatever starts with A.
  return query
    select * from public.products p
     where (not active_only or p.active)
       and (include_labor or p.category is distinct from 'labor')
       and (select bool_and(lower(p.search_text) like '%' || t || '%') from unnest(toks) t)
     order by
       similarity(lower(p.name), lower(q)) desc,
       similarity(lower(p.search_text), lower(q)) desc,
       p.name
     limit lim;

  get diagnostics hits = row_count;
  if hits > 0 then
    return;
  end if;

  -- Nothing matched every token. Rather than an empty list — which is what
  -- "cushion" and "1/2 8lb" produce today — show the closest things there are.
  return query
    select * from public.products p
     where (not active_only or p.active)
       and (include_labor or p.category is distinct from 'labor')
       and (
         similarity(lower(p.search_text), lower(q)) > 0.12
         or (select bool_or(lower(p.search_text) like '%' || t || '%') from unnest(toks) t)
       )
     order by
       similarity(lower(p.name), lower(q)) desc,
       similarity(lower(p.search_text), lower(q)) desc,
       p.name
     limit lim;
end;
$$;

grant execute on function public.search_products(text, int, boolean, boolean) to authenticated;

analyze public.products;

-- Check it:
--   select name, manufacturer from public.search_products('cushion', 5);
--   select name, manufacturer from public.search_products('1/2 8lb', 5);
--   select name, manufacturer from public.search_products('shaw', 5);
