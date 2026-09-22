-- Floor King — flooring knowledge engine, pass 23.
-- Run in the Supabase SQL editor AFTER 0190–0211. Idempotent — safe to re-run.
--
-- Adhesive is a catalog product pick (gallons / kits / pails). The Guided
-- Estimate used to write taped room square feet onto that line as quantity —
-- so a 500 sq ft glue-down became "500 sq ft of adhesive". Glue is not
-- sold by the square foot unless the catalog unit actually says so.
--
-- This migration only updates help so the live question matches the app:
-- pick the catalog glue; enter gallons/kits in Builder; do not invent
-- coverage from taped area. The emit gate lives in the app.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0212_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Quantity is gallons or kits in Builder — taped square feet is not a glue order. Do not invent coverage.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"MATERIAL"'::jsonb
         ),
         '{knowledge_when}',
         '{"systems":["glue","carpet_tile"],"purpose":"MATERIAL"}'::jsonb
       )
 where key = 'adhesive'
    or id = '75db35d1-5b51-4a58-baeb-437c6b7c2489';

commit;
