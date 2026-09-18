-- Floor King — flooring knowledge engine, pass 115.
-- Run in the Supabase SQL editor AFTER 0190–0303. Idempotent — safe to re-run.
--
-- Extra pad / foam with no sold-by unit still required typing measured sq ft
-- then discarded it on the count TBD path. A pad SKU with no sold-by unit is
-- How many / Unit TBD in Builder — not taped square feet. Emit TBD without
-- requiring measured sq ft. Area-unit extras still ask MEASURED sq ft.
-- Do not plant leftover sq ft.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0304_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

commit;
