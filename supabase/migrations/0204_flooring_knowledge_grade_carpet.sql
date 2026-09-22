-- Floor King — flooring knowledge engine, pass 15.
-- Run in the Supabase SQL editor AFTER 0190–0203. Idempotent — safe to re-run.
--
-- Grade / location is relevant for glue-down carpet and carpet tile (slab,
-- below-grade moisture) as well as hard surface. Stretch-in over wood does
-- not need this question. Notes only — this does not invent a product ban
-- or a second adhesive SKU. Manufacturer/product still overrides.
--
-- Live knowledge_when must match the overlay: 0190 stored HS families only,
-- which would hide this on glue-down carpet even after show_if opened.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0204_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Above / on / below grade can change what a product and adhesive permit. Stretch-in over wood hides this. Glue-down carpet, carpet tile, and hard surface still ask. Confirm against the product — do not assume a ban.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"any":[{"key":"project_type","in":["Hard surface"]},{"key":"carpet_install","in":["Glue-down","Carpet tile"]}]}'::jsonb
           ),
           '{knowledge_when}',
           '{"purpose":"INSTALLATION","any":[{"families":["hardwood","lvp","laminate","vinyl","tile"]},{"systems":["glue","carpet_tile"]}]}'::jsonb
         ),
         '{purpose}',
         '"INSTALLATION"'::jsonb
       )
 where key = 'construction_grade'
    or id = '0190a001-c0de-4000-8000-000000000002';

commit;
