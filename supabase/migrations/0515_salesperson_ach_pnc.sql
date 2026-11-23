-- Owner book uses the customers and jobs already in the app. No new table for that.
-- ACH: a PNC NACHA file is prepared here. The bank account number is not stored.
-- The invoice is not paid until the office marks the PNC deposit settled.

alter table public.org_settings
  add column if not exists ach_destination_routing text,
  add column if not exists ach_company_id text,
  add column if not exists ach_odfi_routing text,
  add column if not exists ach_company_name text;

create table if not exists public.ach_pulls (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  invoice_id uuid not null references public.invoices (id),
  amount numeric(12, 2) not null check (amount > 0),
  status text not null check (status in ('ready', 'settled', 'returned', 'cancelled')),
  account_last4 text not null,
  routing_last4 text not null,
  account_type text not null check (account_type in ('checking', 'savings')),
  account_holder text not null,
  payment_id uuid references public.payments (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists ach_pulls_invoice_idx on public.ach_pulls (invoice_id, created_at desc);

alter table public.ach_pulls enable row level security;

drop policy if exists ach_pulls_select on public.ach_pulls;
drop policy if exists ach_pulls_insert on public.ach_pulls;
drop policy if exists ach_pulls_update on public.ach_pulls;

create policy ach_pulls_select on public.ach_pulls
  for select to authenticated
  using (
    public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager', 'salesman')
  );

create policy ach_pulls_insert on public.ach_pulls
  for insert to authenticated
  with check (
    public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager', 'salesman')
  );

create policy ach_pulls_update on public.ach_pulls
  for update to authenticated
  using (
    public.user_role(auth.uid())::text in ('admin', 'office')
  )
  with check (
    public.user_role(auth.uid())::text in ('admin', 'office')
  );

revoke all on public.ach_pulls from public, anon;
grant select, insert on public.ach_pulls to authenticated;
grant update on public.ach_pulls to authenticated;
revoke delete on public.ach_pulls from authenticated, anon, public;
