-- Floor King CRM — Accessory programs (generated trim/transition catalog items).
--
-- Accessories are a cross-product: TYPE × VARIANT. A "program" binds a set of
-- priced types to a real flooring product line, so the variants (colors) come
-- from the floors we actually carry instead of a second hand-kept list.
--
--   accessory_types          the type list (T-Mold, Quarter Round, Baseboard…)
--   accessory_programs       a trim line bound to a flooring source (mfr + style)
--   accessory_program_types  program × type → THE PRICE (one price, all colors)
--   products.accessory_*     provenance stamped on each generated/adopted item
--
-- Generated items are REAL rows in public.products with category='trim', so they
-- are searchable and usable exactly like any other product — no side system.
--
-- Run in Supabase: SQL Editor -> paste -> Run. Safe to re-run.

-- 1) Type catalog -------------------------------------------------------------
-- `axis` is what a type varies by:
--   color → one item per coordinating floor color (T-Mold, Reducer, Stair Nose)
--   size  → one item per size (Baseboard 3¼" / 4¼" / 5¼" — primed, not color-matched)
--   none  → exactly one item (a single SKU)
create table if not exists public.accessory_types (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  unit            text not null default 'each',   -- 'each' (a 94" stick) | 'lnft'
  axis            text not null default 'color',  -- 'color' | 'size' | 'none'
  sizes           text[] not null default '{}',   -- axis='size' only
  piece_length_in numeric,                        -- unit='each': stick length (94")
  default_price   numeric(12, 2) not null default 0,
  sort            int not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint accessory_types_unit_ck check (unit in ('each', 'lnft')),
  constraint accessory_types_axis_ck check (axis in ('color', 'size', 'none'))
);
create unique index if not exists accessory_types_name_uniq
  on public.accessory_types (lower(name));

-- 2) Programs — a trim line bound to a flooring color source ------------------
create table if not exists public.accessory_programs (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  manufacturer      text,
  style             text,                            -- the product line
  color_source      text not null default 'line',    -- 'line' | 'manufacturer' | 'manual'
  manual_colors     text[] not null default '{}',
  active            boolean not null default true,
  last_generated_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint accessory_programs_source_ck
    check (color_source in ('line', 'manufacturer', 'manual'))
);
-- One program per flooring line. Case/space-insensitive so "Adura Max" and
-- "adura max" can't both claim the same line.
create unique index if not exists accessory_programs_line_uniq
  on public.accessory_programs (
    lower(coalesce(manufacturer, '')),
    lower(coalesce(style, ''))
  );

-- 3) Program × type → THE PRICE ----------------------------------------------
-- This is where "enter the price once per type, every color inherits it" lives.
-- It is scoped to a program because the same type costs different money on
-- different vendor lines (a Stair Nose runs $27–$119 across manufacturers).
create table if not exists public.accessory_program_types (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references public.accessory_programs (id) on delete cascade,
  type_id         uuid not null references public.accessory_types (id)    on delete cascade,
  price           numeric(12, 2) not null default 0,
  unit            text,     -- overrides accessory_types.unit
  piece_length_in numeric,  -- overrides accessory_types.piece_length_in
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (program_id, type_id),
  constraint accessory_program_types_unit_ck check (unit is null or unit in ('each', 'lnft'))
);
create index if not exists accessory_program_types_program_idx
  on public.accessory_program_types (program_id);

-- 4) Provenance on the catalog item itself ------------------------------------
-- accessory_origin:
--   'adopted'   an EXISTING vendor row we reverse-engineered into a program.
--               Never re-priced, renamed, deactivated, or deleted by regeneration.
--   'generated' created by the generator. Regeneration may update its price and
--               may deactivate it if its color disappears from the source line.
-- price_override: when set, regeneration leaves material_rate alone. This is how
--               a single color can cost more than the rest of its type.
alter table public.products
  add column if not exists accessory_program_id uuid references public.accessory_programs (id) on delete set null,
  add column if not exists accessory_type_id    uuid references public.accessory_types (id)    on delete set null,
  add column if not exists accessory_variant    text,
  add column if not exists accessory_origin     text,
  add column if not exists price_override       numeric(12, 2),
  add column if not exists piece_length_in      numeric;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_accessory_origin_ck') then
    alter table public.products add constraint products_accessory_origin_ck
      check (accessory_origin is null or accessory_origin in ('adopted', 'generated'));
  end if;
end $$;

-- THE no-duplicates guarantee. Regeneration upserts on this key, so running it
-- twice — or after adding a color — can never double-enter an item. Enforced by
-- the database, not by convention. coalesce() so axis='none' items (null variant)
-- still collide instead of NULL-comparing as distinct.
create unique index if not exists products_accessory_uniq
  on public.products (accessory_program_id, accessory_type_id, coalesce(accessory_variant, ''))
  where accessory_program_id is not null;

create index if not exists products_accessory_program_idx
  on public.products (accessory_program_id)
  where accessory_program_id is not null;

-- A linear-foot product would be auto-classed 'rolled' by migration 0086, which
-- routes PO receipts to the roll ledger and silently never accumulates on_hand.
-- Accessories are counted goods, not rolls.
update public.products
   set stock_kind = 'discrete'
 where category = 'trim'
   and stock_kind = 'rolled';

-- 5) RLS — staff read/write, customers never ---------------------------------
alter table public.accessory_types         enable row level security;
alter table public.accessory_programs      enable row level security;
alter table public.accessory_program_types enable row level security;

do $$
declare t text;
begin
  foreach t in array array['accessory_types', 'accessory_programs', 'accessory_program_types']
  loop
    execute format('drop policy if exists %I_internal on public.%I;', t, t);
    execute format(
      'create policy %I_internal on public.%I for all to authenticated
         using (public.my_role() <> ''customer'')
         with check (public.my_role() <> ''customer'');', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;
