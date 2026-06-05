-- Floor King CRM — Phase 5: Customer Portal access
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

-- 1) Link a portal login to the customer it represents -----------------------
alter table public.profiles
  add column if not exists customer_id uuid references public.customers (id) on delete set null;

-- 2) Helper: the customer record linked to the current user ------------------
create or replace function public.my_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select customer_id from public.profiles where id = auth.uid();
$$;

-- 3) Portal read policies (customers see only their own records) -------------
drop policy if exists customers_customer_read on public.customers;
create policy customers_customer_read on public.customers
  for select to authenticated
  using (id = public.my_customer_id());

drop policy if exists estimates_customer_read on public.estimates;
create policy estimates_customer_read on public.estimates
  for select to authenticated
  using (customer_id = public.my_customer_id());

-- Customers may respond to their own estimates (approve / decline / changes).
drop policy if exists estimates_customer_update on public.estimates;
create policy estimates_customer_update on public.estimates
  for update to authenticated
  using (customer_id = public.my_customer_id())
  with check (customer_id = public.my_customer_id());

drop policy if exists estimate_options_customer_read on public.estimate_options;
create policy estimate_options_customer_read on public.estimate_options
  for select to authenticated
  using (exists (
    select 1 from public.estimates e
    where e.id = estimate_options.estimate_id
      and e.customer_id = public.my_customer_id()
  ));

drop policy if exists estimate_line_items_customer_read on public.estimate_line_items;
create policy estimate_line_items_customer_read on public.estimate_line_items
  for select to authenticated
  using (exists (
    select 1 from public.estimate_options o
    join public.estimates e on e.id = o.estimate_id
    where o.id = estimate_line_items.option_id
      and e.customer_id = public.my_customer_id()
  ));

drop policy if exists jobs_customer_read on public.jobs;
create policy jobs_customer_read on public.jobs
  for select to authenticated
  using (customer_id = public.my_customer_id());

drop policy if exists invoices_customer_read on public.invoices;
create policy invoices_customer_read on public.invoices
  for select to authenticated
  using (customer_id = public.my_customer_id());

drop policy if exists invoice_items_customer_read on public.invoice_items;
create policy invoice_items_customer_read on public.invoice_items
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_items.invoice_id
      and i.customer_id = public.my_customer_id()
  ));

drop policy if exists payments_customer_read on public.payments;
create policy payments_customer_read on public.payments
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = payments.invoice_id
      and i.customer_id = public.my_customer_id()
  ));
