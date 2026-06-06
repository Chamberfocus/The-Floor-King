-- Floor King CRM — Phase 13: granular roles & data scoping
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.
--
-- Access model:
--   admin (Owner/Admin)  : everything, incl. profit/expenses/P&L
--   sales_manager        : all sales (customers/estimates/jobs/invoices) but NO profit/expenses
--   office               : full operational (no profit/expenses page)
--   scheduler            : all customers/jobs to schedule; NO financials
--   salesman             : ONLY their assigned customers + related estimates/jobs/invoices
--   warehouse            : all jobs' material/schedule info; NO financials
--   crew (Installer)     : ONLY their assigned/open jobs and that scope
--   customer             : portal (own records)

-- 1) New roles -----------------------------------------------------------------
alter type public.user_role add value if not exists 'sales_manager';
alter type public.user_role add value if not exists 'salesman';
alter type public.user_role add value if not exists 'scheduler';

-- 2) Role-as-text helper (safe to compare against newly added enum values) -----
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public
as $$ select public.user_role(auth.uid())::text $$;

-- 3) PROFILES: any internal (non-customer) user may read the team roster -------
drop policy if exists profiles_internal_read on public.profiles;
create policy profiles_internal_read on public.profiles
  for select to authenticated
  using (public.my_role() <> 'customer');

-- 4) CUSTOMERS -----------------------------------------------------------------
-- Tighten crew: only customers tied to a job they're on (or an open board job).
drop policy if exists customers_crew_read on public.customers;
create policy customers_crew_read on public.customers
  for select to authenticated
  using (public.my_role() = 'crew' and exists (
    select 1 from public.jobs j
    where j.customer_id = customers.id
      and (j.assigned_to = auth.uid() or j.open_for_claim = true)));

drop policy if exists customers_salesmgr_all on public.customers;
create policy customers_salesmgr_all on public.customers
  for all to authenticated
  using (public.my_role() = 'sales_manager')
  with check (public.my_role() = 'sales_manager');

drop policy if exists customers_scheduler_read on public.customers;
create policy customers_scheduler_read on public.customers
  for select to authenticated
  using (public.my_role() = 'scheduler');

drop policy if exists customers_salesman_own on public.customers;
create policy customers_salesman_own on public.customers
  for all to authenticated
  using (public.my_role() = 'salesman'
    and (assigned_to = auth.uid() or workflow_owner_id = auth.uid()))
  with check (public.my_role() = 'salesman'
    and (assigned_to = auth.uid() or workflow_owner_id = auth.uid()));

-- 5) ACTIVITIES ----------------------------------------------------------------
drop policy if exists activities_crew_read on public.activities;
create policy activities_crew_read on public.activities
  for select to authenticated
  using (public.my_role() = 'crew' and exists (
    select 1 from public.jobs j
    where j.customer_id = activities.customer_id and j.assigned_to = auth.uid()));

drop policy if exists activities_salesmgr_all on public.activities;
create policy activities_salesmgr_all on public.activities
  for all to authenticated
  using (public.my_role() in ('sales_manager', 'scheduler'))
  with check (public.my_role() in ('sales_manager', 'scheduler'));

drop policy if exists activities_salesman_own on public.activities;
create policy activities_salesman_own on public.activities
  for all to authenticated
  using (public.my_role() = 'salesman' and exists (
    select 1 from public.customers c
    where c.id = activities.customer_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())))
  with check (public.my_role() = 'salesman' and exists (
    select 1 from public.customers c
    where c.id = activities.customer_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())));

-- 6) PRODUCTS (catalog) — sales roles read to build estimates; drop crew read --
drop policy if exists products_crew_read on public.products;
drop policy if exists products_sales_read on public.products;
create policy products_sales_read on public.products
  for select to authenticated
  using (public.my_role() in ('sales_manager', 'salesman', 'scheduler'));

-- 7) ESTIMATES + OPTIONS + LINE ITEMS -----------------------------------------
-- crew: only the estimate behind a job they're on.
drop policy if exists estimates_crew_read on public.estimates;
create policy estimates_crew_read on public.estimates
  for select to authenticated
  using (public.my_role() = 'crew' and exists (
    select 1 from public.jobs j
    where j.estimate_id = estimates.id
      and (j.assigned_to = auth.uid() or j.open_for_claim = true)));

drop policy if exists estimate_options_crew_read on public.estimate_options;
create policy estimate_options_crew_read on public.estimate_options
  for select to authenticated
  using (public.my_role() = 'crew' and exists (
    select 1 from public.jobs j
    where j.option_id = estimate_options.id
      and (j.assigned_to = auth.uid() or j.open_for_claim = true)));

drop policy if exists estimate_line_items_crew_read on public.estimate_line_items;
create policy estimate_line_items_crew_read on public.estimate_line_items
  for select to authenticated
  using (public.my_role() = 'crew' and exists (
    select 1 from public.jobs j
    where j.option_id = estimate_line_items.option_id
      and (j.assigned_to = auth.uid() or j.open_for_claim = true)));

-- sales_manager: full; scheduler: read; salesman: their customers' estimates.
drop policy if exists estimates_salesmgr_all on public.estimates;
create policy estimates_salesmgr_all on public.estimates
  for all to authenticated
  using (public.my_role() = 'sales_manager')
  with check (public.my_role() = 'sales_manager');
drop policy if exists estimates_scheduler_read on public.estimates;
create policy estimates_scheduler_read on public.estimates
  for select to authenticated using (public.my_role() = 'scheduler');
drop policy if exists estimates_salesman_own on public.estimates;
create policy estimates_salesman_own on public.estimates
  for all to authenticated
  using (public.my_role() = 'salesman' and exists (
    select 1 from public.customers c
    where c.id = estimates.customer_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())))
  with check (public.my_role() = 'salesman' and exists (
    select 1 from public.customers c
    where c.id = estimates.customer_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())));

drop policy if exists estimate_options_salesmgr_all on public.estimate_options;
create policy estimate_options_salesmgr_all on public.estimate_options
  for all to authenticated
  using (public.my_role() in ('sales_manager', 'scheduler'))
  with check (public.my_role() = 'sales_manager');
drop policy if exists estimate_options_salesman_own on public.estimate_options;
create policy estimate_options_salesman_own on public.estimate_options
  for all to authenticated
  using (public.my_role() = 'salesman' and exists (
    select 1 from public.estimates e join public.customers c on c.id = e.customer_id
    where e.id = estimate_options.estimate_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())))
  with check (public.my_role() = 'salesman' and exists (
    select 1 from public.estimates e join public.customers c on c.id = e.customer_id
    where e.id = estimate_options.estimate_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())));

drop policy if exists estimate_line_items_salesmgr_all on public.estimate_line_items;
create policy estimate_line_items_salesmgr_all on public.estimate_line_items
  for all to authenticated
  using (public.my_role() in ('sales_manager', 'scheduler'))
  with check (public.my_role() = 'sales_manager');
drop policy if exists estimate_line_items_salesman_own on public.estimate_line_items;
create policy estimate_line_items_salesman_own on public.estimate_line_items
  for all to authenticated
  using (public.my_role() = 'salesman' and exists (
    select 1 from public.estimate_options o
      join public.estimates e on e.id = o.estimate_id
      join public.customers c on c.id = e.customer_id
    where o.id = estimate_line_items.option_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())))
  with check (public.my_role() = 'salesman' and exists (
    select 1 from public.estimate_options o
      join public.estimates e on e.id = o.estimate_id
      join public.customers c on c.id = e.customer_id
    where o.id = estimate_line_items.option_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())));

-- 8) JOBS ----------------------------------------------------------------------
drop policy if exists jobs_scheduler_all on public.jobs;
create policy jobs_scheduler_all on public.jobs
  for all to authenticated
  using (public.my_role() = 'scheduler')
  with check (public.my_role() = 'scheduler');
drop policy if exists jobs_salesmgr_read on public.jobs;
create policy jobs_salesmgr_read on public.jobs
  for select to authenticated using (public.my_role() = 'sales_manager');
drop policy if exists jobs_salesman_own on public.jobs;
create policy jobs_salesman_own on public.jobs
  for select to authenticated
  using (public.my_role() = 'salesman' and exists (
    select 1 from public.customers c
    where c.id = jobs.customer_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())));

-- 9) INVOICES + ITEMS + PAYMENTS — sales_manager all (revenue); salesman own ---
drop policy if exists invoices_salesmgr_read on public.invoices;
create policy invoices_salesmgr_read on public.invoices
  for select to authenticated using (public.my_role() = 'sales_manager');
drop policy if exists invoices_salesman_own on public.invoices;
create policy invoices_salesman_own on public.invoices
  for select to authenticated
  using (public.my_role() = 'salesman' and exists (
    select 1 from public.customers c
    where c.id = invoices.customer_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())));

drop policy if exists invoice_items_salesmgr_read on public.invoice_items;
create policy invoice_items_salesmgr_read on public.invoice_items
  for select to authenticated using (public.my_role() = 'sales_manager');
drop policy if exists invoice_items_salesman_own on public.invoice_items;
create policy invoice_items_salesman_own on public.invoice_items
  for select to authenticated
  using (public.my_role() = 'salesman' and exists (
    select 1 from public.invoices i join public.customers c on c.id = i.customer_id
    where i.id = invoice_items.invoice_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())));

drop policy if exists payments_salesmgr_read on public.payments;
create policy payments_salesmgr_read on public.payments
  for select to authenticated using (public.my_role() = 'sales_manager');
drop policy if exists payments_salesman_own on public.payments;
create policy payments_salesman_own on public.payments
  for select to authenticated
  using (public.my_role() = 'salesman' and exists (
    select 1 from public.invoices i join public.customers c on c.id = i.customer_id
    where i.id = payments.invoice_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())));

-- 10) EXPENSES — owner/admin ONLY (profit/cost) -------------------------------
drop policy if exists expenses_staff_all on public.expenses;
drop policy if exists expenses_admin_all on public.expenses;
create policy expenses_admin_all on public.expenses
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 11) MESSAGES — sales_manager/scheduler all; salesman their customers --------
drop policy if exists messages_salesmgr_all on public.messages;
create policy messages_salesmgr_all on public.messages
  for all to authenticated
  using (public.my_role() in ('sales_manager', 'scheduler'))
  with check (public.my_role() in ('sales_manager', 'scheduler'));
drop policy if exists messages_salesman_own on public.messages;
create policy messages_salesman_own on public.messages
  for all to authenticated
  using (public.my_role() = 'salesman' and exists (
    select 1 from public.customers c
    where c.id = messages.customer_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())))
  with check (public.my_role() = 'salesman' and author_id = auth.uid() and exists (
    select 1 from public.customers c
    where c.id = messages.customer_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())));

-- 12) HANDOFFS — sales_manager/scheduler manage ------------------------------
drop policy if exists handoffs_salesmgr_all on public.handoffs;
create policy handoffs_salesmgr_all on public.handoffs
  for all to authenticated
  using (public.my_role() in ('sales_manager', 'scheduler'))
  with check (public.my_role() in ('sales_manager', 'scheduler'));

-- 13) JOB APPLICATIONS — scheduler reads to assign installers -----------------
drop policy if exists job_applications_scheduler_read on public.job_applications;
create policy job_applications_scheduler_read on public.job_applications
  for select to authenticated using (public.my_role() = 'scheduler');

-- 14) JOB FILES — sales_manager/scheduler view all; salesman their jobs -------
drop policy if exists job_files_sales_read on public.job_files;
create policy job_files_sales_read on public.job_files
  for select to authenticated
  using (
    public.my_role() in ('sales_manager', 'scheduler')
    or (public.my_role() = 'salesman' and exists (
      select 1 from public.jobs j join public.customers c on c.id = j.customer_id
      where j.id = job_files.job_id
        and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())))
  );

-- 15) QUALIFYING + WIZARD QUESTIONS — sales roles read ------------------------
drop policy if exists qq_sales_read on public.qualifying_questions;
create policy qq_sales_read on public.qualifying_questions
  for select to authenticated
  using (public.my_role() in ('sales_manager', 'salesman', 'scheduler'));
drop policy if exists wizard_questions_sales_read on public.wizard_questions;
create policy wizard_questions_sales_read on public.wizard_questions
  for select to authenticated
  using (public.my_role() in ('sales_manager', 'salesman', 'scheduler'));
