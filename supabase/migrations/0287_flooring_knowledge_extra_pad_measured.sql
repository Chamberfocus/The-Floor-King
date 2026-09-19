-- Floor King — flooring knowledge engine, pass 98.
-- Run in the Supabase SQL editor AFTER 0190–0286. Idempotent — safe to re-run.
--
-- Additional pad for a specific area (stairs, landing) was labeled Area /
-- sq ft, so a salesperson could type a roll or billing yards into measured
-- square feet. That field is MEASURED sq ft — not a 30-yard roll and not
-- the billing unit. Carpet pad still bills in square yards unless the SKU
-- is feet. Foam stays on hs_underlayment. A pad SKU with no sold-by unit
-- stays How many / Unit TBD, not taped square feet.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (carpet pad would plant square feet).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0287_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

commit;
