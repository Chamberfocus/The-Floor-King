-- NOT FOR PRODUCTION.
-- Disposable PostgreSQL fixture that mirrors the 0187 operational FK graph
-- needed to execute customer_reset_final.sql. Pre-0188 snapshot triggers
-- match 0155 (CASCADE + immutable). Apply 0188 AFTER this file.

create extension if not exists pgcrypto;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  referred_by_customer_id uuid references public.customers (id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  material_rate numeric(12, 2) not null default 0
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.gl_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);

create table public.workflow_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.org_settings (
  id text primary key default 'default',
  company_name text
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null default 'customer',
  customer_id uuid references public.customers (id) on delete set null
);

create table public.accounting_settings (
  id int primary key default 1 check (id = 1),
  posting_enabled boolean not null default false,
  inventory_posting_enabled boolean not null default false,
  ap_posting_enabled boolean not null default false,
  installer_posting_enabled boolean not null default false,
  invoice_posting_enabled boolean not null default false,
  payment_posting_enabled boolean not null default false,
  credit_posting_enabled boolean not null default false,
  expense_posting_enabled boolean not null default false,
  deposit_posting_enabled boolean not null default false,
  books_of_record boolean not null default false,
  opening_balances_entered boolean not null default false,
  accountant_validated boolean not null default false,
  cutover_date date
);

create table public.financial_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null default 'seed'
);

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  current_approval_snapshot_id uuid
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  estimate_id uuid references public.estimates (id) on delete set null
);

create table public.estimate_approval_snapshots (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  version int not null,
  accepted_option_id uuid,
  approved_at timestamptz not null default now(),
  approval_source text not null default 'staff',
  approved_by_user_id uuid,
  approved_by_customer_id uuid references public.customers (id) on delete set null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (estimate_id, version)
);

alter table public.estimates
  add constraint estimates_current_approval_snapshot_fk
  foreign key (current_approval_snapshot_id)
  references public.estimate_approval_snapshots (id) on delete set null;

create or replace function public.prevent_approval_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.estimate_id is distinct from old.estimate_id
       or new.version is distinct from old.version
       or new.payload is distinct from old.payload
       or new.accepted_option_id is distinct from old.accepted_option_id
       or new.approved_at is distinct from old.approved_at
       or new.approval_source is distinct from old.approval_source
       or new.approved_by_user_id is distinct from old.approved_by_user_id
       or new.approved_by_customer_id is distinct from old.approved_by_customer_id
    then
      raise exception 'estimate_approval_snapshots are immutable';
    end if;
  elsif tg_op = 'DELETE' then
    raise exception 'estimate_approval_snapshots are append-only; delete is not allowed';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger estimate_approval_snapshots_immutable
  before update on public.estimate_approval_snapshots
  for each row execute function public.prevent_approval_snapshot_mutation();

create trigger estimate_approval_snapshots_no_delete
  before delete on public.estimate_approval_snapshots
  for each row execute function public.prevent_approval_snapshot_mutation();

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null
);

create table public.po_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  for_customer_id uuid references public.customers (id) on delete set null,
  for_job_id uuid references public.jobs (id) on delete set null
);

create table public.work_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs (id) on delete cascade,
  po_id uuid references public.purchase_orders (id) on delete cascade,
  body text
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null,
  status text not null default 'draft',
  approval_snapshot_id uuid references public.estimate_approval_snapshots (id) on delete set null
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade
);

create table public.credit_memos (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict
);

create table public.customer_deposits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict
);

create table public.customer_deposit_applications (
  id uuid primary key default gen_random_uuid()
);

create table public.credit_applications (
  id uuid primary key default gen_random_uuid()
);

create table public.opening_ar_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict
);

create table public.invoice_write_offs (
  id uuid primary key default gen_random_uuid()
);

create table public.installer_bills (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  status text not null default 'draft'
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  po_id uuid references public.purchase_orders (id) on delete set null
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  source_id uuid,
  status text not null default 'draft'
);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  po_id uuid references public.purchase_orders (id) on delete restrict
);

create table public.service_callbacks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict
);

create table public.customer_duplicate_overrides (
  id uuid primary key default gen_random_uuid(),
  created_customer_id uuid references public.customers (id) on delete set null,
  matched_customer_id uuid references public.customers (id) on delete set null
);

create table public.office_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'task',
  customer_id uuid references public.customers (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null
);

create table public.job_schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs (id) on delete set null
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  customer_id uuid references public.customers (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  po_id uuid references public.purchase_orders (id) on delete set null
);

create table public.job_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  path text not null
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete cascade,
  estimate_id uuid references public.estimates (id) on delete set null,
  is_block boolean not null default false
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade
);

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade
);

create table public.service_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade
);

create table public.customer_areas (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade
);

create table public.sample_checkouts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade
);

-- Catalog / config that MUST survive the reset.
insert into public.accounting_settings (id) values (1);
insert into public.products (id, name, material_rate)
values ('b1000000-0000-4000-8000-000000000001', 'Stay Product', 3.50);
insert into public.suppliers (id, name)
values ('b2000000-0000-4000-8000-000000000001', 'Stay Supplier');
insert into public.gl_accounts (id, code, name)
values ('b3000000-0000-4000-8000-000000000001', '1000', 'Cash');
insert into public.workflow_stages (id, name)
values ('b4000000-0000-4000-8000-000000000001', 'Lead');
insert into public.org_settings (id, company_name)
values ('default', 'The Floor King');
insert into public.financial_audit_log (id, action)
values ('b5000000-0000-4000-8000-000000000001', 'seed-must-survive');
insert into public.purchase_orders (id)
values ('b6000000-0000-4000-8000-000000000001');
insert into public.work_notes (id, body)
values ('b7000000-0000-4000-8000-000000000001', 'shop-wide note');
insert into public.appointments (id, is_block)
values ('b8000000-0000-4000-8000-000000000001', true);
insert into public.office_tasks (id, title)
values ('b9000000-0000-4000-8000-000000000001', 'shop task');
insert into public.profiles (id, email, role)
values ('ba000000-0000-4000-8000-000000000001', 'staff@example.com', 'office');

-- 11 customers. Customer 1 owns the two protected snapshots.
insert into public.customers (id, full_name) values
  ('a1000000-0000-4000-8000-000000000001', 'Snap One'),
  ('a1000000-0000-4000-8000-000000000002', 'Op Two'),
  ('a1000000-0000-4000-8000-000000000003', 'Op Three'),
  ('a1000000-0000-4000-8000-000000000004', 'Op Four'),
  ('a1000000-0000-4000-8000-000000000005', 'Op Five'),
  ('a1000000-0000-4000-8000-000000000006', 'Op Six'),
  ('a1000000-0000-4000-8000-000000000007', 'Op Seven'),
  ('a1000000-0000-4000-8000-000000000008', 'Op Eight'),
  ('a1000000-0000-4000-8000-000000000009', 'Op Nine'),
  ('a1000000-0000-4000-8000-000000000010', 'Op Ten'),
  ('a1000000-0000-4000-8000-000000000011', 'Op Eleven');

update public.customers
   set referred_by_customer_id = 'a1000000-0000-4000-8000-000000000001'
 where id = 'a1000000-0000-4000-8000-000000000002';

insert into public.profiles (id, email, role, customer_id)
values (
  'ba000000-0000-4000-8000-000000000002',
  'portal@example.com',
  'customer',
  'a1000000-0000-4000-8000-000000000001'
);

insert into public.estimates (id, customer_id) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');

insert into public.estimate_approval_snapshots (
  id, estimate_id, version, approved_by_customer_id, payload
) values
(
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  1,
  'a1000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'schema_version', 1,
    'estimate_id', 'a2000000-0000-4000-8000-000000000001',
    'customer_id', 'a1000000-0000-4000-8000-000000000001',
    'title', 'Approved one'
  )
),
(
  'a3000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001',
  2,
  'a1000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'schema_version', 1,
    'estimate_id', 'a2000000-0000-4000-8000-000000000001',
    'customer_id', 'a1000000-0000-4000-8000-000000000001',
    'title', 'Approved two'
  )
);

update public.estimates
   set current_approval_snapshot_id = 'a3000000-0000-4000-8000-000000000002'
 where id = 'a2000000-0000-4000-8000-000000000001';

insert into public.jobs (id, customer_id, estimate_id) values
  ('a4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002');

insert into public.appointments (id, customer_id, estimate_id)
values ('a5000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002');
insert into public.activities (id, customer_id)
values ('a5100000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');
insert into public.handoffs (id, customer_id)
values ('a5200000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');
insert into public.messages (id, customer_id)
values ('a5300000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');
insert into public.service_addresses (id, customer_id)
values ('a5400000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');
insert into public.customer_areas (id, customer_id)
values ('a5500000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');
insert into public.sample_checkouts (id, customer_id)
values ('a5600000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');
insert into public.service_callbacks (id, customer_id)
values ('a5700000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002');
insert into public.orders (id, customer_id, job_id)
values ('a5800000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002');
insert into public.office_tasks (id, title, customer_id, job_id)
values ('a5900000-0000-4000-8000-000000000002', 'call back', 'a1000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002');
insert into public.documents (id, path, customer_id, job_id)
values ('a6000000-0000-4000-8000-000000000002', 'customer/a1000000-0000-4000-8000-000000000002/scan.pdf', 'a1000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002');
insert into public.job_files (id, job_id, path)
values ('a6100000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002', 'jobs/a4000000-0000-4000-8000-000000000002/photo.jpg');
insert into public.work_notes (id, job_id, body)
values ('a6200000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002', 'job note');
insert into public.invoices (id, customer_id, job_id, status)
values ('a6300000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002', 'draft');
insert into public.invoice_items (id, invoice_id)
values ('a6400000-0000-4000-8000-000000000002', 'a6300000-0000-4000-8000-000000000002');
insert into public.job_schedule_overrides (id, job_id)
values ('a6500000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002');
insert into public.expenses (id, job_id)
values ('a6600000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002');
insert into public.installer_bills (id, job_id, status)
values ('a6700000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000002', 'draft');
insert into public.purchase_orders (id, customer_id, job_id, estimate_id)
values (
  'a6800000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000002',
  'a4000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000002'
);
insert into public.po_items (id, po_id, for_customer_id, for_job_id)
values (
  'a6900000-0000-4000-8000-000000000002',
  'a6800000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000002',
  'a4000000-0000-4000-8000-000000000002'
);
insert into public.customer_duplicate_overrides (id, created_customer_id, matched_customer_id)
values (
  'a6a00000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001'
);
