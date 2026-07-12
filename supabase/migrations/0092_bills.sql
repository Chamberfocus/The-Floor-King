-- Floor King CRM — Accounts Payable: Bills (the payables mirror of Invoices).
-- A PO becomes a Bill (what you owe a vendor); bills carry a bill date + due
-- date, line items, and payments. Paying a bill posts a linked materials expense
-- so the P&L stays accurate without double entry. Safe to re-run.

create table if not exists public.bills (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid references public.purchase_orders (id) on delete set null,
  supplier_id  uuid references public.suppliers (id) on delete set null,
  supplier     text,                       -- snapshot of the vendor name
  job_id       uuid references public.jobs (id) on delete set null,
  customer_id  uuid references public.customers (id) on delete set null,
  bill_number  text,                       -- the vendor's invoice / bill number
  bill_date    date not null default now(),
  due_date     date,
  terms        text,                        -- e.g. 'net_30'
  memo         text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bills_supplier_idx on public.bills (supplier_id);
create index if not exists bills_due_idx on public.bills (due_date);
create index if not exists bills_created_idx on public.bills (created_at desc);

create table if not exists public.bill_items (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references public.bills (id) on delete cascade,
  position    int not null default 0,
  description text not null default '',
  quantity    numeric(12, 2),
  unit        text not null default 'sqft',
  unit_cost   numeric(12, 2)
);
create index if not exists bill_items_bill_idx on public.bill_items (bill_id, position);

create table if not exists public.bill_payments (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references public.bills (id) on delete cascade,
  date        date not null default now(),
  amount      numeric(12, 2) not null,
  method      text,
  note        text,
  expense_id  uuid references public.expenses (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists bill_payments_bill_idx on public.bill_payments (bill_id);

-- Link an expense back to the bill it came from (so the P&L reflects paid bills
-- without a separate manual entry, and deleting a payment can undo it).
alter table public.expenses
  add column if not exists bill_id uuid references public.bills (id) on delete set null;

-- updated_at trigger
drop trigger if exists bills_set_updated_at on public.bills;
create trigger bills_set_updated_at before update on public.bills
  for each row execute function public.set_updated_at();

-- RLS: staff only (mirrors purchase_orders / invoices).
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.bill_payments enable row level security;

drop policy if exists bills_staff_all on public.bills;
create policy bills_staff_all on public.bills
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists bill_items_staff_all on public.bill_items;
create policy bill_items_staff_all on public.bill_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists bill_payments_staff_all on public.bill_payments;
create policy bill_payments_staff_all on public.bill_payments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.bills to authenticated;
grant select, insert, update, delete on public.bill_items to authenticated;
grant select, insert, update, delete on public.bill_payments to authenticated;
