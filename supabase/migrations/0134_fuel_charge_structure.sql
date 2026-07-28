-- Fuel / vehicle / commission structure (all internal, never shown to the
-- customer):
--   • job_fuel_charge  — what we CHARGE the customer for fuel, hidden ($60)
--   • job_fuel_fee     — reused as the salesperson gas comp ($50)
--   • job_car_allowance— reused as fleet upkeep ($110)   → gas + fleet = $160
--   • job_commission_pct — commission % of the sale (3.5)
-- Adds the new customer-charge column; the code defaults carry the split.
alter table public.business_settings
  add column if not exists job_fuel_charge numeric not null default 60;

-- Point any existing settings row at the new split (gas 50 / fleet 110) so the
-- $160 vehicle cost is preserved but correctly attributed.
update public.business_settings
  set job_fuel_fee = 50, job_car_allowance = 110
  where id = 'default' and job_fuel_fee = 160 and job_car_allowance = 0;
