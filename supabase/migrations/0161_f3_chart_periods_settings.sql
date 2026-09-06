-- F3 Accounting Foundation (1/2): Chart of Accounts, periods, settings, system mappings.
-- Non-destructive. No historical journal backfill. Safe defaults (posting OFF).

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
create table if not exists public.gl_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  account_type text not null
    check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  subtype text,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gl_accounts_code_unique unique (code)
);

create index if not exists gl_accounts_type_idx
  on public.gl_accounts (account_type, is_active);

-- ---------------------------------------------------------------------------
-- Accounting periods
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open'
    check (status in ('open', 'closed', 'locked')),
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete set null,
  locked_at timestamptz,
  locked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint accounting_periods_dates_chk check (end_date >= start_date),
  constraint accounting_periods_range_unique unique (start_date, end_date)
);

create index if not exists accounting_periods_status_idx
  on public.accounting_periods (status, start_date);

-- ---------------------------------------------------------------------------
-- Accounting settings (singleton row)
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_settings (
  id int primary key default 1 check (id = 1),
  -- Automatic event posting remains OFF until cutover + owner validation.
  posting_enabled boolean not null default false,
  inventory_posting_enabled boolean not null default false,
  cutover_date date,
  books_of_record boolean not null default false,
  default_cash_method text not null default 'undeposited'
    check (default_cash_method in ('cash', 'undeposited')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.accounting_settings (id)
values (1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- System account role mappings (stable keys → accounts)
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_account_mappings (
  mapping_key text primary key,
  account_id uuid not null references public.gl_accounts (id) on delete restrict,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Seed starter Floor King chart (idempotent by code)
-- ---------------------------------------------------------------------------
insert into public.gl_accounts (code, name, account_type, subtype, is_system)
values
  ('1000', 'Operating Checking', 'asset', 'cash', true),
  ('1050', 'Undeposited Funds', 'asset', 'cash_clearing', true),
  ('1100', 'Accounts Receivable', 'asset', 'receivable', true),
  ('1200', 'Inventory Asset', 'asset', 'inventory', true),
  ('1300', 'Prepaid Expenses', 'asset', 'prepaid', false),
  ('1500', 'Fixed Assets', 'asset', 'fixed', false),
  ('2000', 'Accounts Payable', 'liability', 'payable', true),
  ('2100', 'Sales Tax Payable', 'liability', 'tax', true),
  ('2200', 'Customer Deposits / Unearned Revenue', 'liability', 'deposit', true),
  ('2250', 'Customer Credit Liability', 'liability', 'customer_credit', true),
  ('3000', 'Opening Balance Equity', 'equity', 'opening', true),
  ('3100', 'Owner Equity', 'equity', 'owner', true),
  ('3200', 'Retained Earnings', 'equity', 'retained', true),
  ('4000', 'Flooring Sales', 'revenue', 'sales', true),
  ('4100', 'Installation Revenue', 'revenue', 'sales', false),
  ('4900', 'Sales Discounts', 'revenue', 'contra_revenue', true),
  ('5000', 'Material COGS', 'expense', 'cogs', true),
  ('5100', 'Installation Labor COGS', 'expense', 'cogs', true),
  ('5200', 'Freight / Delivery', 'expense', 'cogs', false),
  ('6000', 'Supplies', 'expense', 'opex', false),
  ('6100', 'Advertising', 'expense', 'opex', false),
  ('6200', 'Rent', 'expense', 'opex', false),
  ('6300', 'Utilities', 'expense', 'opex', false),
  ('6400', 'Insurance', 'expense', 'opex', false),
  ('6500', 'Vehicle', 'expense', 'opex', false),
  ('6600', 'Office', 'expense', 'opex', false),
  ('6700', 'Bank / Merchant Fees', 'expense', 'opex', false),
  ('6900', 'Miscellaneous Expense', 'expense', 'opex', true)
on conflict (code) do nothing;

-- Map system roles by code (only if mapping missing)
insert into public.accounting_account_mappings (mapping_key, account_id)
select v.mapping_key, a.id
from (values
  ('cash_operating', '1000'),
  ('undeposited_funds', '1050'),
  ('accounts_receivable', '1100'),
  ('inventory_asset', '1200'),
  ('accounts_payable', '2000'),
  ('sales_tax_payable', '2100'),
  ('customer_deposits', '2200'),
  ('customer_credit_liability', '2250'),
  ('opening_balance_equity', '3000'),
  ('owner_equity', '3100'),
  ('retained_earnings', '3200'),
  ('default_sales_revenue', '4000'),
  ('sales_discounts', '4900'),
  ('material_cogs', '5000'),
  ('installer_labor_cogs', '5100'),
  ('default_expense', '6900')
) as v(mapping_key, code)
join public.gl_accounts a on a.code = v.code
on conflict (mapping_key) do nothing;

-- Seed a few open monthly periods around 2026 (non-destructive if ranges exist)
insert into public.accounting_periods (label, start_date, end_date, status)
values
  ('2026-01', '2026-01-01', '2026-01-31', 'open'),
  ('2026-02', '2026-02-01', '2026-02-28', 'open'),
  ('2026-03', '2026-03-01', '2026-03-31', 'open'),
  ('2026-04', '2026-04-01', '2026-04-30', 'open'),
  ('2026-05', '2026-05-01', '2026-05-31', 'open'),
  ('2026-06', '2026-06-01', '2026-06-30', 'open'),
  ('2026-07', '2026-07-01', '2026-07-31', 'open'),
  ('2026-08', '2026-08-01', '2026-08-31', 'open'),
  ('2026-09', '2026-09-01', '2026-09-30', 'open'),
  ('2026-10', '2026-10-01', '2026-10-31', 'open'),
  ('2026-11', '2026-11-01', '2026-11-30', 'open'),
  ('2026-12', '2026-12-01', '2026-12-31', 'open')
on conflict (start_date, end_date) do nothing;

alter table public.gl_accounts enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.accounting_settings enable row level security;
alter table public.accounting_account_mappings enable row level security;

drop policy if exists gl_accounts_staff_select on public.gl_accounts;
create policy gl_accounts_staff_select on public.gl_accounts
  for select to authenticated
  using (public.is_staff());

drop policy if exists gl_accounts_admin_write on public.gl_accounts;
create policy gl_accounts_admin_write on public.gl_accounts
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));

drop policy if exists accounting_periods_staff_select on public.accounting_periods;
create policy accounting_periods_staff_select on public.accounting_periods
  for select to authenticated
  using (public.is_staff());

drop policy if exists accounting_periods_admin_write on public.accounting_periods;
create policy accounting_periods_admin_write on public.accounting_periods
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));

drop policy if exists accounting_settings_staff_select on public.accounting_settings;
create policy accounting_settings_staff_select on public.accounting_settings
  for select to authenticated
  using (public.is_staff());

drop policy if exists accounting_settings_admin_write on public.accounting_settings;
create policy accounting_settings_admin_write on public.accounting_settings
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));

drop policy if exists accounting_mappings_staff_select on public.accounting_account_mappings;
create policy accounting_mappings_staff_select on public.accounting_account_mappings
  for select to authenticated
  using (public.is_staff());

drop policy if exists accounting_mappings_admin_write on public.accounting_account_mappings;
create policy accounting_mappings_admin_write on public.accounting_account_mappings
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));

grant select on public.gl_accounts to authenticated;
grant select, insert, update on public.gl_accounts to authenticated;
grant select on public.accounting_periods to authenticated;
grant select, insert, update on public.accounting_periods to authenticated;
grant select on public.accounting_settings to authenticated;
grant select, update on public.accounting_settings to authenticated;
grant select on public.accounting_account_mappings to authenticated;
grant select, insert, update on public.accounting_account_mappings to authenticated;
-- No DELETE grants for system accounting tables.
