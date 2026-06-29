-- Address geocode + cached property data (house value & details). The value is
-- looked up once on demand and cached here so we don't burn the property-data
-- API on every page load.
alter table public.customers
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists property_value numeric,
  add column if not exists property_beds int,
  add column if not exists property_baths numeric,
  add column if not exists property_sqft int,
  add column if not exists property_year int,
  add column if not exists property_type text,
  add column if not exists property_checked_at timestamptz;
