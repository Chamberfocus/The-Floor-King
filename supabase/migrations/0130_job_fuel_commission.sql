-- Per-job internal costs the owner factors into TRUE profit but the customer
-- never sees: a flat fuel/vehicle reimbursement and a commission % of the sale.
-- Shown only in the estimate builder's internal profit panel and Profit targets.
alter table public.business_settings
  add column if not exists job_fuel_fee numeric not null default 160;
alter table public.business_settings
  add column if not exists job_commission_pct numeric not null default 3.5;
