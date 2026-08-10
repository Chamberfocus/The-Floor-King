-- Floor King — supplier price feeds (fcB2B and plain files)
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- fcB2B is the flooring industry's own EDI standard. Its 832 Product Price
-- Catalog is the document that carries a supplier's price list; 850/855/856/810
-- carry the purchase order, its acknowledgement, the shipment and the invoice.
-- Newer suppliers also expose RESTful services (stock check, price inquiry).
--
-- Every supplier is at a different point on that road. Some will hand you a
-- REST endpoint, most will send a spreadsheet. This models the CONNECTION per
-- supplier so both arrive in the same place, and — crucially — never lets a
-- feed change a price without the change being recorded and reversible.

-- 1. How we connect to each supplier ---------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'supplier_feed_kind') then
    create type public.supplier_feed_kind as enum (
      'fcb2b_rest',   -- fcB2B RESTful web services (price inquiry, stock check)
      'fcb2b_832',    -- fcB2B 832 Price Catalog document, dropped as a file
      'file',         -- a plain CSV / Excel price list, emailed or downloaded
      'manual'        -- keyed in by hand; still tracked so history is complete
    );
  end if;
end
$$;

create table if not exists public.supplier_feeds (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references public.suppliers (id) on delete cascade,
  kind          public.supplier_feed_kind not null default 'file',
  -- fcB2B identifies the BUYER with a supplier-assigned code. The spec is
  -- explicit that this should NOT be the account number.
  client_identifier text,
  -- Base URL of the supplier's fcB2B service, e.g. https://rest.example.com
  endpoint_url  text,
  -- Credentials live in Vercel env vars, never here. This only names which one.
  credential_key text,
  -- How often they publish, so a stale feed is obvious.
  cadence_days  int,
  last_success_at timestamptz,
  last_error    text,
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists supplier_feeds_one_per_supplier
  on public.supplier_feeds (supplier_id);

comment on column public.supplier_feeds.client_identifier is
  'Supplier-assigned buyer code from the fcB2B spec. Explicitly NOT the account '
  'number — suppliers issue a separate identifier for electronic exchange.';

-- 2. Every price import, as a reversible batch ------------------------------
create table if not exists public.price_imports (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid references public.suppliers (id) on delete set null,
  kind          public.supplier_feed_kind not null default 'file',
  -- What arrived, so a bad import can be explained rather than guessed at.
  source_name   text,
  effective_date date,
  -- draft = parsed and waiting for a human; applied = prices changed.
  status        text not null default 'draft',
  matched       int not null default 0,
  unmatched     int not null default 0,
  changed       int not null default 0,
  applied_at    timestamptz,
  applied_by    uuid references public.profiles (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists price_imports_supplier_idx
  on public.price_imports (supplier_id, created_at desc);

create table if not exists public.price_import_lines (
  id            uuid primary key default gen_random_uuid(),
  import_id     uuid not null references public.price_imports (id) on delete cascade,
  -- What the supplier sent, kept verbatim so a mismatch is diagnosable.
  supplier_sku  text,
  description   text,
  new_cost      numeric(12,4),
  uom           text,
  -- What we matched it to, and what that product costs today.
  product_id    uuid references public.products (id) on delete set null,
  old_cost      numeric(12,4),
  -- exact | sku | none — how confident the match is.
  match_kind    text,
  raw           jsonb
);
create index if not exists price_import_lines_import_idx
  on public.price_import_lines (import_id);

-- 3. Price history — the audit trail a price change deserves ---------------
create table if not exists public.product_price_history (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  old_cost      numeric(12,4),
  new_cost      numeric(12,4),
  source        text,               -- 'import' | 'manual' | supplier name
  import_id     uuid references public.price_imports (id) on delete set null,
  changed_by    uuid references public.profiles (id) on delete set null,
  changed_at    timestamptz not null default now()
);
create index if not exists product_price_history_product_idx
  on public.product_price_history (product_id, changed_at desc);

comment on table public.product_price_history is
  'Every cost change, with where it came from. A supplier raising a price mid-'
  'quote is invisible without this — and an estimate built last week needs to '
  'be explainable against the price that was live when it was built.';

-- 4. RLS --------------------------------------------------------------------
alter table public.supplier_feeds enable row level security;
alter table public.price_imports enable row level security;
alter table public.price_import_lines enable row level security;
alter table public.product_price_history enable row level security;

drop policy if exists supplier_feeds_staff on public.supplier_feeds;
create policy supplier_feeds_staff on public.supplier_feeds for all
  to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists price_imports_staff on public.price_imports;
create policy price_imports_staff on public.price_imports for all
  to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists price_import_lines_staff on public.price_import_lines;
create policy price_import_lines_staff on public.price_import_lines for all
  to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists price_history_staff on public.product_price_history;
create policy price_history_staff on public.product_price_history for select
  to authenticated using (public.is_staff());

grant select, insert, update, delete on public.supplier_feeds to authenticated;
grant select, insert, update, delete on public.price_imports to authenticated;
grant select, insert, update, delete on public.price_import_lines to authenticated;
grant select on public.product_price_history to authenticated;

-- 5. Which suppliers are ready to receive a feed ---------------------------
/**
 * A feed can only update products that are ATTRIBUTED to that supplier. Today
 * products carry a manufacturer name but no supplier_id, so this view is the
 * honest answer to "would a Mohawk catalog actually update anything?".
 */
create or replace view public.supplier_feed_readiness
with (security_invoker = true) as
select
  s.id                                     as supplier_id,
  s.name,
  f.kind,
  f.active                                 as feed_active,
  f.last_success_at,
  (select count(*)::int from public.products p
     where p.supplier_id = s.id)           as linked_products,
  (select count(*)::int from public.products p
     where p.supplier_id = s.id and coalesce(p.sku, '') <> '')
                                           as linked_with_sku
from public.suppliers s
left join public.supplier_feeds f on f.supplier_id = s.id;

grant select on public.supplier_feed_readiness to authenticated;
