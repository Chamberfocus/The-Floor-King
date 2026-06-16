-- Cancel a customer/job: a deal that fell through, a no-show, or a job called
-- off. Keeps the record (and history) but takes it out of the active pipeline.
-- Reopen by clearing these.
alter table public.customers
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancel_reason text;

create index if not exists customers_cancelled_idx on public.customers (cancelled_at);
