-- Floor King CRM — 0187 catalog search pricing columns
--
-- WHY
-- 0176 revoked SELECT on products.avg_unit_cost and products.inventory_carrying_value
-- from `authenticated`. public.search_products still did `select *` / `select p`
-- (setof public.products), which requires every column. After 0176 the RPC fails
-- for staff JWTs and the app falls back to a slower ILIKE path.
--
-- This rebuilds search_products so valuation columns are projected as NULL and
-- never read. material_rate / labor_rate / clearance_price stay selectable
-- (OUR COST / clearance sell — already granted to authenticated in 0176).
-- Warehouse still has no products RLS policy, so they still get zero rows from
-- the table; this does not leak cost to warehouse or customers.
--
-- Additive. Does NOT enable accounting. Does NOT mutate product prices.
-- Do NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.
--
-- READ-ONLY preflight (run in SQL editor, do not apply 0187 yet):
--   select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
--          p.prosecdef as security_definer
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where p.proname = 'search_products';
--   select relacl from pg_class where relname = 'products';
--   select has_column_privilege('authenticated', 'public.products', 'material_rate', 'select') as can_cost,
--          has_column_privilege('authenticated', 'public.products', 'avg_unit_cost', 'select') as can_wac;

do $$
declare
  s record;
begin
  if to_regclass('public.products') is null then
    raise exception 'P0_0187_PRECHECK: public.products missing.';
  end if;
  if to_regprocedure('public.search_products(text, int, boolean, boolean)') is null then
    raise exception 'P0_0187_PRECHECK: search_products(text,int,boolean,boolean) missing — apply 0147 first.';
  end if;
  if to_regclass('public.accounting_settings') is not null then
    select * into s from public.accounting_settings where id = 1;
    if found and (
         coalesce(s.posting_enabled, false)
      or coalesce(s.books_of_record, false)
      or s.cutover_date is not null
    ) then
      raise exception 'P0_0187_PRECHECK: accounting flags must remain OFF/NULL.';
    end if;
  end if;
end $$;

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
    raise exception '0187_SEARCH: no products columns to project';
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
        lower(p.search_text || ' ' || coalesce(p.category::text, '')) as _hay
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
  '0187: catalog search. Does not read avg_unit_cost / inventory_carrying_value. Ranking unchanged from 0147.';

revoke all on function public.search_products(text, int, boolean, boolean) from public;
revoke all on function public.search_products(text, int, boolean, boolean) from anon;
grant execute on function public.search_products(text, int, boolean, boolean) to authenticated;
grant execute on function public.search_products(text, int, boolean, boolean) to service_role;
