-- Floor King — product search that finds the item you typed.
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- WHAT WAS GOING WRONG
--
-- search_products scored every row by how much the whole query string
-- looked like the name. "shaw coretec" could lose to a name that merely looked similar,
-- "8lb pad" lost to a mop, and "cushion" missed the padding catalog because
-- those rows say underlayment. It also read slowly: the fuzzy comparison ran
-- on all 13k products.
--
-- WHAT THIS DOES
--
-- search_products_smart keeps the 0187 rule: avg_unit_cost and
-- inventory_carrying_value are projected as NULL and never read.
-- Each typed word is expanded (1/2 ↔ 0.5, 8lb ↔ 8 lb, pad ↔ underlayment,
-- coretech ↔ coretec) and matched literally. Rows that contain every word
-- sort first. The trigram index limits the scan to rows that actually contain
-- a needle. Does NOT enable accounting. Does not change a price.
--
-- The app calls search_products_smart and, until this file is applied, runs
-- the same plan in TypeScript. search_products is pointed at the new function
-- so the SQL editor and any older caller get the same ranking.

create extension if not exists pg_trgm;

create index if not exists products_search_trgm_idx
  on public.products using gin (search_text gin_trgm_ops);

create or replace function public.search_products_smart(
  q text,
  lim int default 50,
  include_labor boolean default false,
  active_only boolean default true,
  categories text[] default null
)
returns setof public.products
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  cols text;
  out_cols text;
  raw text;
  toks text[] := '{}';
  needles text[] := '{}';
  owners int[] := '{}';
  tok_cats text[] := '{}';
  all_cats text[] := '{}';
  patterns text[] := '{}';
  extra text[];
  n int := 0;
  i int := 0;
  d int;
  t text;
  needle text;
  cat text;
  num text;
  pad_search boolean := false;
  kept text[] := '{}';
begin
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

  select string_agg(format('s.%I', a.attname), ', ' order by a.attnum)
  into out_cols
  from pg_attribute a
  where a.attrelid = 'public.products'::regclass
    and a.attnum > 0
    and not a.attisdropped;

  if cols is null or out_cols is null then
    raise exception '0495_SEARCH: no products columns to project';
  end if;

  lim := least(greatest(coalesce(lim, 50), 1), 400);

  raw := lower(btrim(coalesce(q, '')));
  raw := regexp_replace(raw, '\mrevo[\s-]?woods?\M', ' revwood ', 'g');
  raw := regexp_replace(raw, '\mrev[\s-]?woods?\M', ' revwood ', 'g');
  raw := regexp_replace(raw, '\mcore[\s-]?tec\M', ' coretec ', 'g');
  raw := regexp_replace(raw, '\mt[\s-]?mould(?:ing)?s?\M', ' tmold ', 'g');
  raw := regexp_replace(raw, '\mt[\s-]?mold(?:ing)?s?\M', ' tmold ', 'g');
  raw := regexp_replace(raw, '\mquarter[\s-]?rounds?\M', ' quarterround ', 'g');
  raw := regexp_replace(raw, '\mqtr[\s-]?rounds?\M', ' quarterround ', 'g');
  raw := regexp_replace(raw, '\mend[\s-]?caps?\M', ' endcap ', 'g');
  raw := regexp_replace(raw, '\mj[\s-]?channels?\M', ' jchannel ', 'g');
  raw := regexp_replace(raw, '\mstair[\s-]?nose\M', ' stairnose ', 'g');

  if raw = '' then
    return query execute format(
      'select %s from public.products p
        where ($1 is not true or p.active)
          and ($2 is true or p.category is distinct from ''labor'')
          and ($3::text[] is null or cardinality($3::text[]) = 0 or p.category::text = any($3::text[]))
        order by p.name
        limit $4',
      cols
    )
    using active_only, include_labor, categories, lim;
    return;
  end if;

  toks := array_remove(regexp_split_to_array(raw, '[^a-z0-9/#.-]+'), '');
  if toks && array['pad','pads','padding','cushion','cushions','rebond','underlay','underlayment']::text[] then
    pad_search := true;
  end if;
  foreach t in array toks loop
    if pad_search and t = any(array['carpet','carpets','carpett']) then
      continue;
    end if;
    kept := kept || t;
  end loop;
  toks := kept;
  n := coalesce(array_length(toks, 1), 0);
  if n = 0 then
    return query execute format(
      'select %s from public.products p
        where ($1 is not true or p.active)
          and ($2 is true or p.category is distinct from ''labor'')
          and ($3::text[] is null or cardinality($3::text[]) = 0 or p.category::text = any($3::text[]))
        order by p.name
        limit $4',
      cols
    )
    using active_only, include_labor, categories, lim;
    return;
  end if;

  foreach t in array toks loop
    i := i + 1;
    extra := array[t];
    cat := '';

    if t = 'coretech' or t = 'cortech' or t = 'coreteck' or t = 'coretek' then
      extra := array_append(extra, 'coretec'); t := 'coretec';
    elsif t = 'dreamweever' or t = 'dreamwever' or t = 'dreamweavor' then
      extra := array_append(extra, 'dreamweaver');
    elsif t = 'acaia' or t = 'accacia' or t = 'acaciaa' then
      extra := array_append(extra, 'acacia');
    elsif t = 'carpett' then
      extra := array_append(extra, 'carpet'); t := 'carpet';
    elsif t = 'mohak' or t = 'mohwak' then
      extra := array_append(extra, 'mohawk');
    elsif t = 'vinal' or t = 'vynil' then
      extra := array_append(extra, 'vinyl'); t := 'vinyl';
    elsif t = 'laminat' or t = 'lamiante' then
      extra := array_append(extra, 'laminate'); t := 'laminate';
    elsif t = 'hardwod' or t = 'hardwoord' then
      extra := array_append(extra, 'hardwood'); t := 'hardwood';
    end if;

    if t ~ '^[0-9]+/[1-9][0-9]*$' then
      num := (split_part(t, '/', 1)::numeric / split_part(t, '/', 2)::numeric)::text;
      extra := array_append(extra, num);
      extra := array_append(extra, regexp_replace(num, '^0', ''));
    end if;
    if t ~ '^[0-9]+(\.[0-9]+)?(lb|lbs|#)$' or t ~ '^[0-9]+(\.[0-9]+)?$' then
      num := regexp_replace(t, '(lb|lbs|#)$', '');
      extra := array_append(extra, num || 'lb');
      extra := array_append(extra, num || ' lb');
      extra := array_append(extra, num || 'lbs');
      extra := array_append(extra, num || '#');
    end if;

    if t = any(array['pad','pads','padding','cushion','cushions','rebond','underlay','underlayment']) then
      extra := extra || array['pad','padding','cushion','rebond','underlayment'];
      cat := 'underlayment';
    elsif t = any(array['lvp','lvt','lvf','plank','planks']) then
      extra := extra || array['lvp','lvt','plank'];
      cat := 'lvp';
    elsif t = 'vinyl' then
      extra := array_append(extra, 'vinyl');
      cat := 'lvp,vinyl';
    elsif t = any(array['hardwood','wood']) then
      extra := array_append(extra, t);
      cat := 'hardwood';
    elsif t = any(array['carpet','carpets']) then
      extra := array_append(extra, 'carpet');
      cat := 'carpet';
    elsif t = 'laminate' then
      cat := 'laminate';
    elsif t = any(array['tile','tiles','ceramic','porcelain']) then
      extra := extra || array['tile','ceramic','porcelain'];
      cat := 'tile';
    elsif t = any(array['trim','molding','moulding','moldings','mouldings','transition','transitions','reducer','threshold']) then
      extra := extra || array['trim','molding','transition','reducer','threshold'];
      cat := 'trim';
    elsif t = any(array['tmold','tmolding','tmould']) then
      extra := extra || array['tmold','t-mold','t mold','t-molding','t molding'];
      cat := 'trim';
    elsif t = 'quarterround' then
      extra := extra || array['quarter round','quarter-round','quarterround'];
      cat := 'trim';
    elsif t = 'revwood' then
      extra := extra || array['revwood','rev wood','revowood'];
    elsif t = 'coretec' then
      extra := extra || array['coretec','core tec'];
    end if;

    if length(t) >= 8 then
      extra := array_append(extra, left(t, 6));
    elsif length(t) >= 6 then
      extra := array_append(extra, left(t, 5));
    end if;
    if length(t) between 5 and 12 then
      for d in 1..least(length(t) - 1, 4) loop
        extra := array_append(extra, substr(t, 1, d) || substr(t, d + 2));
      end loop;
    end if;

    tok_cats[i] := cat;
    if cat <> '' then
      all_cats := all_cats || string_to_array(cat, ',');
    end if;

    foreach needle in array extra loop
      needle := btrim(coalesce(needle, ''));
      if length(needle) < 3 and needle !~ '[0-9]' then
        continue;
      end if;
      if length(needle) < 2 then
        continue;
      end if;
      needles := array_append(needles, needle);
      owners := array_append(owners, i);
      patterns := array_append(patterns, '%' || needle || '%');
    end loop;
  end loop;

  n := coalesce(array_length(tok_cats, 1), 0);

  return query execute format(
    'with base as (
       select %s,
         lower(coalesce(p.name, '''')) as _nm,
         lower(coalesce(p.sku, '''')) as _sku,
         lower(
           coalesce(p.search_text, '''') || '' '' ||
           coalesce(p.name, '''') || '' '' ||
           coalesce(p.sku, '''') || '' '' ||
           coalesce(p.manufacturer, '''') || '' '' ||
           coalesce(p.style, '''') || '' '' ||
           coalesce(p.color, '''') || '' '' ||
           coalesce(p.fiber, '''') || '' '' ||
           coalesce(p.species, '''') || '' '' ||
           coalesce(p.notes, '''') || '' '' ||
           coalesce(p.category::text, '''')
         ) as _hay,
         p.category::text as _cat
       from public.products p
       where ($1 is not true or p.active)
         and ($2 is true or p.category is distinct from ''labor'')
         and (
           $3::text[] is null
           or cardinality($3::text[]) = 0
           or p.category::text = any($3::text[])
         )
         and (
           coalesce(p.search_text, '''') ilike any($4::text[])
           or coalesce(p.fiber, '''') ilike any($4::text[])
           or coalesce(p.species, '''') ilike any($4::text[])
           or coalesce(p.notes, '''') ilike any($4::text[])
           or (cardinality($5::text[]) > 0 and p.category::text = any($5::text[]))
         )
     ),
     scored as (
       select b.*,
         (
           select count(*)::int
           from generate_series(1, $6) g
           where exists (
             select 1
             from unnest($7::text[], $8::int[]) as u(needle, owner)
             where u.owner = g
               and (
                 strpos(b._hay, u.needle) > 0
                 or strpos(replace(b._sku, ''-'', ''''), replace(u.needle, ''-'', '''')) > 0
               )
           )
           or (
             coalesce(($9::text[])[g], '''') <> ''''
             and strpos('','' || ($9::text[])[g] || '','', '','' || b._cat || '','') > 0
           )
         ) as _hits,
         (
           select coalesce(sum(
             greatest(
               case when exists (
                 select 1 from unnest($7::text[], $8::int[]) as u(needle, owner)
                 where u.owner = g and strpos(b._nm, u.needle) > 0
               ) then 4 else 0 end,
               case when exists (
                 select 1 from unnest($7::text[], $8::int[]) as u(needle, owner)
                 where u.owner = g and strpos(b._hay, u.needle) > 0
               ) then 3 else 0 end,
               case when coalesce(($9::text[])[g], '''') <> ''''
                     and strpos('','' || ($9::text[])[g] || '','', '','' || b._cat || '','') > 0
               then 5 else 0 end
             )
           ), 0)
           from generate_series(1, $6) g
         ) as _score
       from base b
     )
     select %s
       from scored s
      where s._hits > 0
      order by (s._hits = $6) desc, s._score desc, s._nm
      limit $10',
    cols,
    out_cols
  )
  using active_only, include_labor, categories, patterns, all_cats, n, needles, owners, tok_cats, lim;
end;
$fn$;

comment on function public.search_products_smart(text, int, boolean, boolean, text[]) is
  '0495: catalog search by token coverage, trade synonyms, and typo needles. Does not read avg_unit_cost or inventory_carrying_value. Does NOT enable accounting.';

revoke all on function public.search_products_smart(text, int, boolean, boolean, text[]) from public;
revoke all on function public.search_products_smart(text, int, boolean, boolean, text[]) from anon;
grant execute on function public.search_products_smart(text, int, boolean, boolean, text[]) to authenticated;
grant execute on function public.search_products_smart(text, int, boolean, boolean, text[]) to service_role;

-- Older callers (and the SQL editor checks) follow the new ranking.
create or replace function public.search_products(
  q text,
  lim int default 50,
  include_labor boolean default false,
  active_only boolean default true
)
returns setof public.products
language sql
stable
security invoker
set search_path = public
as $wrap$
  select * from public.search_products_smart(q, lim, include_labor, active_only, null::text[]);
$wrap$;

comment on function public.search_products(text, int, boolean, boolean) is
  '0495: delegates to search_products_smart. Does not read avg_unit_cost or inventory_carrying_value. Does NOT enable accounting.';

revoke all on function public.search_products(text, int, boolean, boolean) from public;
revoke all on function public.search_products(text, int, boolean, boolean) from anon;
grant execute on function public.search_products(text, int, boolean, boolean) to authenticated;
grant execute on function public.search_products(text, int, boolean, boolean) to service_role;

-- Inventory list was one ILIKE of the whole phrase, so "shaw oak" matched
-- neither word unless that exact string sat in one column. Each word now has
-- to appear. Still security definer, still the same role gate, still the
-- cost-free view. Does NOT enable accounting.
create or replace function public.inv_list_inventory_products_ops(
  p_search text default null,
  p_limit int default 500
) returns setof public.products_inventory_ops
language plpgsql
security definer
set search_path = public
as $inv$
declare
  v_raw text;
  toks text[];
begin
  perform public.accounting_require_roles(
    array['admin','office','warehouse'], 'list inventory products ops'
  );
  v_raw := nullif(lower(btrim(coalesce(p_search, ''))), '');
  if v_raw is null then
    return query
      select *
        from public.products_inventory_ops p
       where p.track_stock = true
       order by p.name
       limit greatest(1, least(coalesce(p_limit, 500), 2000));
    return;
  end if;

  toks := array_remove(regexp_split_to_array(v_raw, '[^a-z0-9/#.-]+'), '');
  return query
  select *
    from public.products_inventory_ops p
   where p.track_stock = true
     and (
       coalesce(array_length(toks, 1), 0) = 0
       or (
         select bool_and(
           strpos(
             lower(
               coalesce(p.name, '') || ' ' || coalesce(p.sku, '') || ' ' ||
               coalesce(p.manufacturer, '') || ' ' || coalesce(p.style, '') || ' ' ||
               coalesce(p.color, '') || ' ' || coalesce(p.notes, '') || ' ' ||
               coalesce(p.category::text, '')
             ),
             t
           ) > 0
           or (t = any(array['pad','pads','padding','cushion','cushions']) and p.category::text = 'underlayment')
           or (t = any(array['lvp','lvt','plank','planks']) and p.category::text = 'lvp')
           or (t = any(array['wood','hardwood']) and p.category::text = 'hardwood')
           or (t = any(array['carpet','carpets']) and p.category::text = 'carpet')
           or (t = any(array['tile','tiles','ceramic','porcelain']) and p.category::text = 'tile')
         )
         from unnest(toks) t
       )
     )
   order by p.name
   limit greatest(1, least(coalesce(p_limit, 500), 2000));
end;
$inv$;

revoke all on function public.inv_list_inventory_products_ops(text, int) from public;
revoke all on function public.inv_list_inventory_products_ops(text, int) from anon;
grant execute on function public.inv_list_inventory_products_ops(text, int) to authenticated;
grant execute on function public.inv_list_inventory_products_ops(text, int) to service_role;
