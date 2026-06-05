-- Floor King CRM — Phase 4: Invoicing & Payments (manual methods)
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'invoice_status') then
    create type public.invoice_status as enum
      ('draft', 'sent', 'partial', 'paid', 'void');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type public.payment_method as enum
      ('card', 'cash', 'check', 'echeck', 'financing', 'link', 'other');
  end if;
end $$;

create table if not exists public.invoices (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  job_id      uuid references public.jobs (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null,
  number      text,
  status      public.invoice_status not null default 'draft',
  issue_date  date,
  due_date    date,
  tax_rate    numeric(5, 2) not null default 8.0,
  notes       text,
  terms       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists invoices_customer_idx
  on public.invoices (customer_id, created_at desc);
create index if not exists invoices_status_idx on public.invoices (status);

create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  position    int not null default 0,
  description text not null default '',
  quantity    numeric(12, 2),
  unit        text not null default 'sqft',
  rate        numeric(12, 2)
);
create index if not exists invoice_items_invoice_idx
  on public.invoice_items (invoice_id, position);

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  amount      numeric(12, 2) not null,
  method      public.payment_method not null default 'other',
  reference   text,
  paid_at     date,
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists payments_invoice_idx on public.payments (invoice_id);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices      enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['invoices', 'invoice_items', 'payments'] loop
    execute format('drop policy if exists %I_staff_all on public.%I;', t, t);
    execute format(
      'create policy %I_staff_all on public.%I for all to authenticated
         using (public.is_staff()) with check (public.is_staff());', t, t);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated;', t);
  end loop;
end $$;
