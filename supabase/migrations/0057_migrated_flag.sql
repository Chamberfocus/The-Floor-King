-- Floor King CRM — mark carry-over (pre-go-live) records so they stay OUT of
-- financial reporting (Business Pulse, P&L, salesperson scorecard) while still
-- living in the app operationally (pipeline, schedule, job board, AR balances).
-- Anything created normally after go-live has migrated = false and counts.
-- Safe to re-run.

alter table public.estimates add column if not exists migrated boolean not null default false;
alter table public.jobs      add column if not exists migrated boolean not null default false;
alter table public.invoices  add column if not exists migrated boolean not null default false;
alter table public.payments  add column if not exists migrated boolean not null default false;
