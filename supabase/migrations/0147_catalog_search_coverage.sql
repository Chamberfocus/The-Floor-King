-- Floor King — catalog search that rewards matching MORE of what you typed.
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- WHAT'S WRONG TODAY (0143)
--
-- 0143 fixed the empty-result problem: strict all-tokens matching first, then a
-- fuzzy fallback so a search never comes back blank. The fallback is where it
-- falls down. It accepts a row if ANY single token appears, then ranks by
-- similarity between the whole query STRING and the product name. Measured on
-- the live catalog:
--
--   "shaw coretec"      → Mohawk "Coral Shores" first. It contains neither
--                         word; it just happens to look like the typed string.
--   "gold coast acacia" → "LW PLANK Gold Coast" (2 of 3 words) outranks
--                         "CORETEC ORIGINALS ... GOLD COAST ACACIA" (3 of 3).
--   "8lb pad"           → "VIBRANT MOP PAD" first, ahead of every padding.
--   "carpett pad"       → nothing usable at all: one typo and both words are
--                         effectively abandoned.
--
-- Nothing counts HOW MANY of the typed words were found, so a 1-of-3 match can
-- beat a 3-of-3 one.
--
-- THE FIX
--
-- Score every row by how much of the query it accounts for — a word found in
-- the NAME is worth more than one found elsewhere, and a word that is merely
-- CLOSE (a typo) still earns something rather than nothing. Rows matching every
-- word sort above everything else, so a precise search stays precise, and a
-- loose one degrades by how much it actually matched instead of by how the
-- letters happen to line up.
--
-- NOTE ON CATEGORY
--
-- "carpet", "pad" and "trim" are how people search, but they live only in the
-- category column — which is why "8lb pad" had to reach past every padding to
-- find a mop. Category is NOT added to the generated search_text column:
-- category is the product_category enum, and an enum-to-text cast is only
-- STABLE (labels can be renamed), so Postgres rejects it in a generated
-- expression — "generation expression is not immutable". It is folded in here
-- at query time instead, which needs no table rewrite.

create extension if not exists pg_trgm;

create index if not exists products_search_trgm_idx
  on public.products using gin (search_text gin_trgm_ops);

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

  -- Punctuation is how people type, not how catalogs are written: "t-mold"
  -- should find "T MOLDING". Split on anything that isn't a letter, digit,
  -- fraction slash or decimal point, and drop the empties.
  toks := array_remove(regexp_split_to_array(lower(q), '[^a-z0-9/.]+'), '');
  n := coalesce(array_length(toks, 1), 0);
  if n = 0 then
    return query
      select * from public.products p
       where (not active_only or p.active)
         and (include_labor or p.category is distinct from 'labor')
       order by p.name
       limit lim;
    return;
  end if;

  return query
  with base as (
    select
      p,
      lower(p.name) as nm,
      -- Everything worth matching, category included.
      lower(p.search_text || ' ' || coalesce(p.category::text, '')) as hay
    from public.products p
    where (not active_only or p.active)
      and (include_labor or p.category is distinct from 'labor')
  ),
  scored as (
    select
      b.p,
      b.nm,
      /**
       * What this row accounts for, word by word.
       *
       * position() rather than LIKE: a token is matched LITERALLY, so "1/2",
       * "3/4" and "50%" mean themselves instead of being read as wildcards.
       * The CASE stops at the first hit, so the expensive fuzzy comparison
       * only runs for words that weren't found outright.
       */
      (select coalesce(sum(
         case
           when position(t in b.nm) > 0 then 4
           when position(t in b.hay) > 0 then 3
           -- Close enough to be a typo. Short words are excluded: at three
           -- characters almost everything is "similar" to everything.
           when length(t) >= 4
                and word_similarity(t, b.hay) >= 0.6 then 2
           else 0
         end), 0)
       from unnest(toks) t) as score,
      (select count(*) from unnest(toks) t
        where position(t in b.hay) > 0
           or (length(t) >= 4 and word_similarity(t, b.hay) >= 0.6)
      ) as hits
    from base b
  )
  select (s.p).*
    from scored s
   where s.score > 0
   order by
     -- Everything you typed was found: those come first, always.
     (s.hits = n) desc,
     -- Then by how much of it was found, and how well.
     s.score desc,
     -- Then the closest name, so the most on-the-nose one leads its group.
     similarity(s.nm, lower(q)) desc,
     (s.p).name
   limit lim;
end;
$$;

grant execute on function public.search_products(text, int, boolean, boolean) to authenticated;

analyze public.products;

-- Check it:
--   select name, manufacturer from public.search_products('shaw coretec', 5);
--   select name, manufacturer from public.search_products('gold coast acacia', 5);
--   select name, manufacturer from public.search_products('carpett pad', 5);
