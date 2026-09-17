-- Floor King — flooring knowledge engine, pass 11.
-- Run in the Supabase SQL editor AFTER 0190–0199. Idempotent — safe to re-run.
--
-- Prep questions must follow substrate CONDITION, not fire on every hard-surface
-- job the same way:
--   * moisture_test is hardwood OR glue-down OR "Moisture concerns" on
--     subfloor_condition (laminate floating still hides it unless flagged).
--   * Does not invent a moisture reading, bag count, or catalog product.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0200_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Glue-down, hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"subfloor_condition","in":["Moisture concerns"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP","any":[{"families":["hardwood"]},{"systems":["glue"]},{"subfloor":["Moisture concerns"]}]}'::jsonb
       )
 where key = 'moisture_test';

commit;
