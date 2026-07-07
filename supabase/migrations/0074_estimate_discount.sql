-- Estimate-level discount, applied to the subtotal before tax. Flows to the
-- invoice as a discount line when an invoice is created from the estimate.
alter table public.estimates
  add column if not exists discount_kind text not null default 'amount'; -- amount | percent
alter table public.estimates
  add column if not exists discount_value numeric(12, 2) not null default 0;
