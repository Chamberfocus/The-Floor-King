-- Floor King — flooring knowledge engine, pass 105.
-- Run in the Supabase SQL editor AFTER 0190–0293. Idempotent — safe to re-run.
--
-- Catalog underlayment maps to family other, so pad / foam never reached
-- Review takeoff. Show measured area vs billing quantity (pad yards, foam
-- feet) instead of skipping the product or inventing a 30-yard roll.
-- Waste stays 0 unless the product has a waste percent. Carton coverage is
-- not invented. A pad SKU with no sold-by unit stays How many / Unit TBD
-- in Builder — Review takeoff is measured vs billing, not a planted qty.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Does NOT invent carton coverage / 30-yard roll.
--
-- Does NOT invent catalog categories or prices.
-- Does NOT enable accounting.

-- P0_0294_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

commit;
