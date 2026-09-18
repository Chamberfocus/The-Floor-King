-- Floor King — flooring knowledge engine, pass 89.
-- Run in the Supabase SQL editor AFTER 0190–0277. Idempotent — safe to re-run.
--
-- Catalog category underlayment is pad yards (SQYD_CATEGORIES). Laminate / LVP
-- foam is the same category but bills by the square foot. Guided Estimate uses
-- the question key + SKU unit so hs_underlayment is not converted to yards.
-- Product area unit wins when the SKU actually stores sq yd or sq ft.
-- Do not invent a 30-yard foam roll.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (carpet pad would plant square feet).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0278_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

commit;
