-- Sample checkout & return — customers borrow flooring samples; we track what
-- they took, when it's due back, and send return reminders. Tied to the
-- customer record so it shows on their dashboard (and their portal).

create table if not exists public.sample_checkouts (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers (id) on delete cascade,
  status          text not null default 'out',     -- out | returned | lost
  checked_out_at  timestamptz not null default now(),
  due_date        date not null,
  returned_at     timestamptz,
  deposit         numeric(12, 2),                   -- optional hold taken
  notes           text,
  last_reminder_on date,                            -- dedupe the daily reminder
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists sample_checkouts_customer_idx
  on public.sample_checkouts (customer_id);
create index if not exists sample_checkouts_status_due_idx
  on public.sample_checkouts (status, due_date);

create table if not exists public.sample_checkout_items (
  id           uuid primary key default gen_random_uuid(),
  checkout_id  uuid not null references public.sample_checkouts (id) on delete cascade,
  product_id   uuid references public.products (id) on delete set null,
  label        text not null,                       -- the sample (manufacturer / style / color)
  qty          int not null default 1,
  returned     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists sample_items_checkout_idx
  on public.sample_checkout_items (checkout_id);

-- RLS: staff manage everything; a customer can READ their own (for the portal).
alter table public.sample_checkouts enable row level security;
alter table public.sample_checkout_items enable row level security;

drop policy if exists sample_checkouts_staff on public.sample_checkouts;
create policy sample_checkouts_staff on public.sample_checkouts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists sample_checkouts_customer_read on public.sample_checkouts;
create policy sample_checkouts_customer_read on public.sample_checkouts
  for select to authenticated using (customer_id = public.my_customer_id());

drop policy if exists sample_items_staff on public.sample_checkout_items;
create policy sample_items_staff on public.sample_checkout_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists sample_items_customer_read on public.sample_checkout_items;
create policy sample_items_customer_read on public.sample_checkout_items
  for select to authenticated using (
    exists (
      select 1 from public.sample_checkouts c
      where c.id = checkout_id and c.customer_id = public.my_customer_id()
    )
  );

grant select, insert, update, delete on public.sample_checkouts to authenticated;
grant select, insert, update, delete on public.sample_checkout_items to authenticated;

drop trigger if exists set_sample_checkouts_updated_at on public.sample_checkouts;
create trigger set_sample_checkouts_updated_at before update on public.sample_checkouts
  for each row execute function public.set_updated_at();

-- Defaults: loan length & how many days before due to start reminding.
alter table public.business_settings
  add column if not exists sample_loan_days int not null default 14;
alter table public.business_settings
  add column if not exists sample_reminder_lead_days int not null default 2;
