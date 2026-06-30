-- Floor King CRM — single global "Freight & fees" markup. Catalog prices are
-- the bare material cost; this one number covers freight, fuel surcharges, drop
-- fees and handling on average, and is applied automatically to every material
-- cost so margins and job profit reflect the TRUE landed cost.
-- Safe to re-run.

alter table public.org_settings
  add column if not exists freight_markup_pct numeric not null default 0;

-- Seed it from the old fuel-surcharge number if one was set and freight is 0,
-- so nothing is lost.
update public.org_settings
   set freight_markup_pct = fuel_surcharge_pct
 where freight_markup_pct = 0
   and coalesce(fuel_surcharge_pct, 0) > 0;
