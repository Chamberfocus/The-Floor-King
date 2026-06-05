-- Floor King CRM — Phase 2: Materials catalog + Estimates (multi-option)
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

-- 1) Enums -------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'product_category') then
    create type public.product_category as enum
      ('carpet', 'lvp', 'hardwood', 'laminate', 'tile', 'vinyl',
       'underlayment', 'trim', 'labor', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'estimate_status') then
    create type public.estimate_status as enum
      ('draft', 'sent', 'approved', 'declined', 'changes_requested');
  end if;
  if not exists (select 1 from pg_type where typname = 'line_type') then
    create type public.line_type as enum ('mat_labor', 'installed', 'flat');
  end if;
  if not exists (select 1 from pg_type where typname = 'estimate_presentation') then
    -- How the customer sees the quote: itemized vs single lump-sum total.
    create type public.estimate_presentation as enum ('detailed', 'summary');
  end if;
end $$;

-- 2) Products / materials catalog -------------------------------------------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      public.product_category not null default 'other',
  unit          text not null default 'sqft',
  material_rate numeric(12, 2) not null default 0,
  labor_rate    numeric(12, 2) not null default 0,
  sku           text,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists products_active_idx on public.products (active, category);

-- 3) Estimates ---------------------------------------------------------------
create table if not exists public.estimates (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  title       text,
  status      public.estimate_status not null default 'draft',
  presentation public.estimate_presentation not null default 'detailed', -- itemized vs lump-sum to customer
  tax_rate    numeric(5, 2) not null default 8.0,  -- percent, applied to full subtotal
  notes       text,                      -- internal notes
  job_description text,                   -- customer-facing written scope of the job (from wizard)
  customer_response_note text,            -- reason on decline / details on a change request
  accepted_option_id uuid,  -- set when a customer approves a specific option
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists estimates_customer_idx on public.estimates (customer_id, created_at desc);
create index if not exists estimates_status_idx on public.estimates (status);

-- 4) Options (an estimate presents one or more options to choose from) -------
create table if not exists public.estimate_options (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  name        text not null default 'Option',
  position    int not null default 0,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists estimate_options_estimate_idx
  on public.estimate_options (estimate_id, position);

-- 5) Line items (per option; flexible pricing) ------------------------------
create table if not exists public.estimate_line_items (
  id             uuid primary key default gen_random_uuid(),
  option_id      uuid not null references public.estimate_options (id) on delete cascade,
  position       int not null default 0,
  room           text,                    -- e.g. "Living Room" (for work orders / grouping)
  description    text not null default '',
  line_type      public.line_type not null default 'mat_labor',
  sqft           numeric(12, 2),
  material_rate  numeric(12, 2),
  labor_rate     numeric(12, 2),
  installed_rate numeric(12, 2),
  flat_amount    numeric(12, 2),
  product_id     uuid references public.products (id) on delete set null
);
create index if not exists estimate_line_items_option_idx
  on public.estimate_line_items (option_id, position);

-- accepted_option_id references an option (added after options table exists)
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'estimates_accepted_option_fk'
  ) then
    alter table public.estimates
      add constraint estimates_accepted_option_fk
      foreign key (accepted_option_id)
      references public.estimate_options (id) on delete set null;
  end if;
end $$;

-- 6) updated_at triggers -----------------------------------------------------
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists estimates_set_updated_at on public.estimates;
create trigger estimates_set_updated_at
  before update on public.estimates
  for each row execute function public.set_updated_at();

-- 7) Row-Level Security ------------------------------------------------------
alter table public.products             enable row level security;
alter table public.estimates            enable row level security;
alter table public.estimate_options     enable row level security;
alter table public.estimate_line_items  enable row level security;

-- Staff full access; crew read (they'll consume work orders later).
do $$
declare t text;
begin
  foreach t in array array[
    'products', 'estimates', 'estimate_options', 'estimate_line_items'
  ] loop
    execute format('drop policy if exists %I_staff_all on public.%I;', t, t);
    execute format(
      'create policy %I_staff_all on public.%I for all to authenticated
         using (public.is_staff()) with check (public.is_staff());', t, t);
    execute format('drop policy if exists %I_crew_read on public.%I;', t, t);
    execute format(
      'create policy %I_crew_read on public.%I for select to authenticated
         using (public.user_role(auth.uid()) = ''crew'');', t, t);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;
