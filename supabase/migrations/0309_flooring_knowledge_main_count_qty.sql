-- Floor King — flooring knowledge engine, pass 120.
-- Run in the Supabase SQL editor AFTER 0190–0308. Idempotent — safe to re-run.
--
-- Main pad / foam / adhesive sold by roll / each / gal still emitted as
-- silent TBD and the pad question still showed room sq ft as takeoff
-- yards. A main count SKU asks How many in that unit — room square feet
-- is not pad yards, not foam feet, and not a glue order. Empty sold-by
-- unit stays TBD. Area-unit pad still uses measured vs billing yards.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT SQL-gate adhesive on surface_type (0142 — mixed LVP still asks glue).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0309_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. A pad SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main pad SKU sold by roll / each / gal does not convert room square feet into pad yards on Review. A main pad SKU sold by the roll / each / gal asks How many in that unit — room square feet is not pad yards and not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. A foam SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main foam SKU sold by roll / each / gal does not convert room square feet into foam feet on Review. A main foam SKU sold by the roll / each / gal asks How many in that unit — room square feet is not foam feet and not a 30-yard roll. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Exclusive laminate leftover Glue-down does not show this — laminate is floating. Exclusive sheet vinyl leftover Floating still asks this — sheet vinyl is glue-down. Carpet-only leftover Glue-down does not show this — carpet glue is on Carpet install. Mixed LVP still asks. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. A glue SKU sold by the gal / kit / each asks How many in that unit — taped square feet is not a glue order. Do not invent coverage.'
 where key = 'adhesive';

commit;
