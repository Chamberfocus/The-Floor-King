-- Floor King CRM — order pricing: show retail on the order form and let the
-- customer request a price (per unit) that you approve. Retail is a snapshot of
-- what the customer saw; requested_price is what they asked to pay. Safe to re-run.

alter table public.order_items
  add column if not exists retail_price    numeric(12, 2),
  add column if not exists requested_price numeric(12, 2);
