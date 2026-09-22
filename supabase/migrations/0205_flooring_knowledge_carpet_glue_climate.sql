-- Floor King — flooring knowledge engine, pass 16.
-- Run in the Supabase SQL editor AFTER 0190–0204. Idempotent — safe to re-run.
--
-- Glue-down carpet uses carpet_install, not hard-surface install_method.
-- 0190/0200 gated acclimation, moisture_test, and moisture_mitigation on
-- hardwood surface OR install_method Glue-down — so a carpet-only glue-down
-- job never asked them. Overlay already treats systems:glue as in-scope.
--
-- Stretch-in still hides these. This does not invent a day count, a moisture
-- reading, or a second adhesive SKU.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0205_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Hardwood and glue-down (including glue-down carpet) need acclimation / climate notes. Floating laminate and stretch-in hide this — do not invent a day count.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"INSTALLATION","any":[{"families":["hardwood"]},{"systems":["glue"]}]}'::jsonb
       )
 where key = 'acclimation'
    or id = 'f5331bc8-bc96-47f4-a392-eca7d00b694a';

update public.estimate_questions
   set help = 'Glue-down (hard surface or carpet), hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down"]},{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"subfloor_condition","in":["Moisture concerns"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP","any":[{"families":["hardwood"]},{"systems":["glue"]},{"subfloor":["Moisture concerns"]}]}'::jsonb
       )
 where key = 'moisture_test'
    or id = '9400b1d6-9e58-45f8-929d-57dc35dff3be';

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down (including glue-down carpet), or a moisture-concern flag makes it relevant. Stretch-in and floating laminate without that flag hide this. Existing catalog rates — do not invent a new product.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down"]},{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"subfloor_condition","in":["Moisture concerns"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP","any":[{"families":["hardwood"]},{"systems":["glue"]},{"subfloor":["Moisture concerns"]}]}'::jsonb
       )
 where key = 'moisture_mitigation'
    or id = '2fc7799c-030c-4276-b6fa-801cb9867082';

commit;
