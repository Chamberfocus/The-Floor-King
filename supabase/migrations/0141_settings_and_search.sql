-- Floor King — the per-job overhead columns, and a search index that works
-- Run in the Supabase SQL editor. Safe to re-run. Supersedes 0130 and 0134,
-- which were never run and cannot be run as written (see below).

-- 1. Per-job overheads ------------------------------------------------------
--
-- These four are read on every estimate, job and profit figure in the app, and
-- NONE of the columns exist. getBusinessSettings does `{...DEFAULTS, ...row}`,
-- so the code defaults have been standing in silently — $50 gas, $110 car,
-- 3.5% commission are being charged on every job right now. The numbers are
-- right; what's broken is that Settings → Profit targets writes to columns that
-- aren't there, so the values can never be CHANGED.
--
-- 0130 adds job_fuel_fee and job_commission_pct. 0134 then UPDATEs
-- job_car_allowance — a column neither migration ever creates, so 0134 fails on
-- a clean database. This adds all four.
alter table public.business_settings
  -- What we charge the customer for fuel. Revenue, folded into the price, never
  -- shown as its own line.
  add column if not exists job_fuel_charge   numeric not null default 60,
  -- Salesperson gas reimbursement. A cost.
  add column if not exists job_fuel_fee      numeric not null default 50,
  -- Fleet upkeep. A cost. Gas + fleet = the $160 vehicle cost per job.
  add column if not exists job_car_allowance numeric not null default 110,
  add column if not exists job_commission_pct numeric not null default 3.5;

comment on column public.business_settings.job_fuel_charge is
  'CHARGED to the customer (revenue, hidden inside the price). Not the same as '
  'job_fuel_fee, which is what it COSTS us. Confusing these inflates profit.';

-- Preserve the intended split if an older row carried the combined $160.
update public.business_settings
   set job_fuel_fee = 50, job_car_allowance = 110
 where id = 'default' and job_fuel_fee = 160 and job_car_allowance = 0;

-- 2. Catalog search that doesn't scan 13,558 rows --------------------------
--
-- The only search index is products (lower(name)) — a btree, which cannot serve
-- `ilike '%term%'` because of the leading wildcard. Every keystroke in the
-- product picker full-scans the table across six columns.
--
-- Trigram indexes are what make a contains-match fast.
create extension if not exists pg_trgm;

create index if not exists products_name_trgm_idx
  on public.products using gin (name gin_trgm_ops);
create index if not exists products_sku_trgm_idx
  on public.products using gin (sku gin_trgm_ops);
create index if not exists products_manufacturer_trgm_idx
  on public.products using gin (manufacturer gin_trgm_ops);
create index if not exists products_style_trgm_idx
  on public.products using gin (style gin_trgm_ops);
create index if not exists products_color_trgm_idx
  on public.products using gin (color gin_trgm_ops);

-- The picker filters these on every query, so let the planner cut the set down
-- before it does any matching at all.
create index if not exists products_active_category_idx
  on public.products (active, category);

analyze public.products;
