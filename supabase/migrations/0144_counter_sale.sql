-- Floor King — cash & carry counter sales.
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- A walk-in buys material off the shelf. Today that has nowhere to go: an
-- estimate is a quote for work, an order is a request to be reviewed, and
-- neither records "they paid, they left with it". So it either gets typed in as
-- a fake job or it never reaches the books at all.
--
-- A counter sale is just an invoice that was paid the moment it was raised, so
-- it needs no new tables — only somewhere to record that the customer agreed to
-- hear from us, which is the reason for capturing their details at the counter
-- in the first place.

alter table public.customers
  -- Asked at the counter: "want to hear about deals?" Explicit opt-in, with the
  -- date, because consent you can't date is consent you can't rely on.
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists marketing_opt_in_at timestamptz;

comment on column public.customers.marketing_opt_in is
  'Customer agreed to marketing contact. Set at the counter or on their file; '
  'never inferred from a purchase.';

create index if not exists customers_marketing_opt_in_idx
  on public.customers (marketing_opt_in) where marketing_opt_in;

-- Mark the invoices that came off the counter, so a cash sale can be told from
-- a job invoice in the books without guessing from whether a job is attached.
alter table public.invoices
  add column if not exists counter_sale boolean not null default false;

create index if not exists invoices_counter_sale_idx
  on public.invoices (counter_sale) where counter_sale;

-- Check it:
--   select full_name, marketing_opt_in from public.customers where marketing_opt_in;
--   select number, counter_sale from public.invoices where counter_sale;
