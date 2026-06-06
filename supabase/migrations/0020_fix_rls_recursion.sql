-- Floor King CRM — Phase 16: fix RLS infinite recursion (42P17)
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.
--
-- 0017 added policies where customers->jobs and jobs->customers reference each
-- other, causing "infinite recursion detected in policy for relation customers".
-- Fix: do every cross-table check inside SECURITY DEFINER functions (which run
-- as the owner and skip RLS), so policy evaluation never re-enters another
-- RLS-protected table. Same technique as is_staff()/user_role().

-- 1) Helper functions (RLS-bypassing) -----------------------------------------
create or replace function public.crew_sees_customer(cust uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j
    where j.customer_id = cust and (j.assigned_to = auth.uid() or j.open_for_claim = true));
$$;

create or replace function public.crew_sees_estimate(est uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j
    where j.estimate_id = est and (j.assigned_to = auth.uid() or j.open_for_claim = true));
$$;

create or replace function public.crew_sees_option(opt uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j
    where j.option_id = opt and (j.assigned_to = auth.uid() or j.open_for_claim = true));
$$;

create or replace function public.mine_customer(cust uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.customers c
    where c.id = cust and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid()));
$$;

create or replace function public.mine_estimate(est uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.estimates e join public.customers c on c.id = e.customer_id
    where e.id = est and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid()));
$$;

create or replace function public.mine_option(opt uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.estimate_options o
      join public.estimates e on e.id = o.estimate_id
      join public.customers c on c.id = e.customer_id
    where o.id = opt and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid()));
$$;

create or replace function public.mine_invoice(inv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invoices i join public.customers c on c.id = i.customer_id
    where i.id = inv and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid()));
$$;

create or replace function public.mine_job(j_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j join public.customers c on c.id = j.customer_id
    where j.id = j_id and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid()));
$$;

-- 2) Rewrite the recursive policies to use the helpers --------------------------

-- CUSTOMERS
drop policy if exists customers_crew_read on public.customers;
create policy customers_crew_read on public.customers
  for select to authenticated
  using (public.my_role() = 'crew' and public.crew_sees_customer(customers.id));

-- ACTIVITIES
drop policy if exists activities_crew_read on public.activities;
create policy activities_crew_read on public.activities
  for select to authenticated
  using (public.my_role() = 'crew' and public.crew_sees_customer(activities.customer_id));
drop policy if exists activities_salesman_own on public.activities;
create policy activities_salesman_own on public.activities
  for all to authenticated
  using (public.my_role() = 'salesman' and public.mine_customer(activities.customer_id))
  with check (public.my_role() = 'salesman' and public.mine_customer(activities.customer_id));

-- ESTIMATES
drop policy if exists estimates_crew_read on public.estimates;
create policy estimates_crew_read on public.estimates
  for select to authenticated
  using (public.my_role() = 'crew' and public.crew_sees_estimate(estimates.id));
drop policy if exists estimates_salesman_own on public.estimates;
create policy estimates_salesman_own on public.estimates
  for all to authenticated
  using (public.my_role() = 'salesman' and public.mine_customer(estimates.customer_id))
  with check (public.my_role() = 'salesman' and public.mine_customer(estimates.customer_id));

-- ESTIMATE OPTIONS
drop policy if exists estimate_options_crew_read on public.estimate_options;
create policy estimate_options_crew_read on public.estimate_options
  for select to authenticated
  using (public.my_role() = 'crew' and public.crew_sees_option(estimate_options.id));
drop policy if exists estimate_options_salesman_own on public.estimate_options;
create policy estimate_options_salesman_own on public.estimate_options
  for all to authenticated
  using (public.my_role() = 'salesman' and public.mine_estimate(estimate_options.estimate_id))
  with check (public.my_role() = 'salesman' and public.mine_estimate(estimate_options.estimate_id));

-- ESTIMATE LINE ITEMS
drop policy if exists estimate_line_items_crew_read on public.estimate_line_items;
create policy estimate_line_items_crew_read on public.estimate_line_items
  for select to authenticated
  using (public.my_role() = 'crew' and public.crew_sees_option(estimate_line_items.option_id));
drop policy if exists estimate_line_items_salesman_own on public.estimate_line_items;
create policy estimate_line_items_salesman_own on public.estimate_line_items
  for all to authenticated
  using (public.my_role() = 'salesman' and public.mine_option(estimate_line_items.option_id))
  with check (public.my_role() = 'salesman' and public.mine_option(estimate_line_items.option_id));

-- INVOICES / ITEMS / PAYMENTS
drop policy if exists invoices_salesman_own on public.invoices;
create policy invoices_salesman_own on public.invoices
  for select to authenticated
  using (public.my_role() = 'salesman' and public.mine_customer(invoices.customer_id));
drop policy if exists invoice_items_salesman_own on public.invoice_items;
create policy invoice_items_salesman_own on public.invoice_items
  for select to authenticated
  using (public.my_role() = 'salesman' and public.mine_invoice(invoice_items.invoice_id));
drop policy if exists payments_salesman_own on public.payments;
create policy payments_salesman_own on public.payments
  for select to authenticated
  using (public.my_role() = 'salesman' and public.mine_invoice(payments.invoice_id));

-- JOBS
drop policy if exists jobs_salesman_own on public.jobs;
create policy jobs_salesman_own on public.jobs
  for select to authenticated
  using (public.my_role() = 'salesman' and public.mine_customer(jobs.customer_id));

-- MESSAGES
drop policy if exists messages_salesman_own on public.messages;
create policy messages_salesman_own on public.messages
  for all to authenticated
  using (public.my_role() = 'salesman' and public.mine_customer(messages.customer_id))
  with check (public.my_role() = 'salesman' and author_id = auth.uid()
              and public.mine_customer(messages.customer_id));

-- DOCUMENTS
drop policy if exists documents_salesman_own on public.documents;
create policy documents_salesman_own on public.documents
  for all to authenticated
  using (public.my_role() = 'salesman' and public.mine_customer(documents.customer_id))
  with check (public.my_role() = 'salesman' and public.mine_customer(documents.customer_id));

-- JOB FILES
drop policy if exists job_files_sales_read on public.job_files;
create policy job_files_sales_read on public.job_files
  for select to authenticated
  using (
    public.my_role() in ('sales_manager', 'scheduler')
    or (public.my_role() = 'salesman' and public.mine_job(job_files.job_id))
  );
