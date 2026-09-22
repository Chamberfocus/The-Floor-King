-- Floor King — flooring knowledge engine, pass 82.
-- Run in the Supabase SQL editor AFTER 0190–0270. Idempotent — safe to re-run.
--
-- Exclusive carpet tile over Concrete still asked the 6-mil click-floor
-- vapor-barrier question and skipped acclimation / moisture / Aqua bar.
-- Modular tile uses adhesive — not a floating-floor sheet. Hide vapor
-- barrier once carpet_install is exclusively Carpet tile and no click/glue
-- hard-surface family is also on the job. Ask acclimation, moisture test,
-- and Aqua bar instead (positive expander, like 0205 glue-down carpet).
-- Mixed LVP or hardwood + carpet tile still asks vapor barrier.
-- Unanswered carpet install stays open. Stretch-in still hides moisture.
-- Do NOT SQL-gate vapor_barrier on carpet_install (0142 — unanswered carpet and mixed stretch-in + tile over concrete must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0271_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation. Mixed LVP or hardwood + tile or carpet tile still asks. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Do not invent a box size.'
 where key = 'carpet_install';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down / carpet tile, from this overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Legacy AC/heat yes-no answers still count.'
 where key = 'climate_control';

update public.estimate_questions
   set help = 'Hardwood, glue-down (including glue-down carpet), and carpet tile need acclimation / climate notes. Floating laminate and stretch-in hide this — do not invent a day count.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down","Carpet tile"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"INSTALLATION","any":[{"families":["hardwood"]},{"systems":["glue","carpet_tile"]}]}'::jsonb
       )
 where key = 'acclimation'
    or id = 'f5331bc8-bc96-47f4-a392-eca7d00b694a';

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Wet area still asks.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down","Carpet tile"]},{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"subfloor_condition","in":["Moisture concerns"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP","any":[{"families":["hardwood"]},{"systems":["glue","carpet_tile"]},{"subfloor":["Moisture concerns"]}]}'::jsonb
       )
 where key = 'moisture_test'
    or id = '9400b1d6-9e58-45f8-929d-57dc35dff3be';

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Existing catalog rates — do not invent a new product.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down","Carpet tile"]},{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"subfloor_condition","in":["Moisture concerns"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP","any":[{"families":["hardwood"]},{"systems":["glue","carpet_tile"]},{"subfloor":["Moisture concerns"]}]}'::jsonb
       )
 where key = 'moisture_mitigation'
    or id = '2fc7799c-030c-4276-b6fa-801cb9867082';

commit;
