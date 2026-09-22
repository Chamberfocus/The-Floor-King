-- Floor King — flooring knowledge engine, pass 5.
-- Run in the Supabase SQL editor AFTER 0190–0193. Idempotent — safe to re-run.
--
-- Keys live questions the overlay could not see, and adds the remaining
-- estimator branches that Floor King already prices or needs as scope:
--   1. Carpet pad is stretch-in only (glue-down / carpet tile hide it).
--   2. Toilets / appliances / doors / furniture — EACH, existing labor rates.
--   3. Carpet waterfall vs hard-surface plank stairs (already separate kinds).
--   4. Tile floor vs wall — wall is a catalog pick in Builder, not invented labor.
--   5. Sheet vinyl skim / embossing — Field verify allowed; no bag count invented.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0194_FLOORING_KNOWLEDGE

begin;

-- Carpet pad: overlay hides this on glue-down / carpet tile.
update public.estimate_questions
   set key = 'carpet_pad',
       help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile do not use residential pad — that branch hides this step.',
       config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{purpose}', '"MATERIAL"'::jsonb),
         '{knowledge_when}',
         '{"families":["carpet"],"systems":["stretch_in"],"purpose":"MATERIAL"}'::jsonb
       )
 where id = 'c96e8386-c44e-4ca1-95b9-3c24d15c9437'
    or (section = 'Carpet' and kind = 'product' and config->>'category' = 'underlayment'
        and (key is null or key = '' or key = 'carpet_pad'));

-- Toilets / appliances: Floor King already has pull-reset and disconnect labor.
-- Count in EACH. Show on both carpet and hard-surface jobs.
update public.estimate_questions
   set key = 'toilets',
       help = 'Count in EACH — never square feet. Uses Floor King pull & reset labor when you enter a number.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(coalesce(config, '{}'::jsonb), '{purpose}', '"LABOR"'::jsonb),
           '{show_if}',
           '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"LABOR"}'::jsonb
       )
 where id = '78cbe0e9-7b58-4907-8f6e-8829c507b753'
    or label ilike 'Toilets to pull%';

update public.estimate_questions
   set key = 'appliances',
       help = 'Count in EACH (fridge, stove, washer/dryer). Uses Floor King disconnect/move labor when you enter a number.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(coalesce(config, '{}'::jsonb), '{purpose}', '"LABOR"'::jsonb),
           '{show_if}',
           '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"LABOR"}'::jsonb
       )
 where id = '68d3a7bc-065f-4b02-b88b-e94b8776b2f7'
    or label ilike 'Appliances to disconnect%';

-- Furniture light/medium/heavy already emits Floor King labor. Key it for review.
update public.estimate_questions
   set key = 'furniture_level',
       help = 'Light / medium / heavy uses Floor King furniture-moving labor. Pianos and pool tables stay on the specialty-items question as scope — do not double-charge.',
       config = jsonb_set(coalesce(config, '{}'::jsonb), '{purpose}', '"LABOR"'::jsonb)
 where id = 'd65f32f1-7448-4106-8cdc-3ea20cedf672'
    or (label ilike 'Furniture%heavy%' and (key is null or key = '' or key = 'furniture_level'));

-- Doors to shave: EACH.
update public.estimate_questions
   set key = 'doors_shave',
       help = 'Count of doors to undercut, in EACH. Never square feet.',
       config = jsonb_set(coalesce(config, '{}'::jsonb), '{purpose}', '"LABOR"'::jsonb)
 where id = '911ca1f0-d0a5-4048-9b1e-2e07fde68231'
    or (label ilike 'Doors to shave%' and (key is null or key = '' or key = 'doors_shave'));

-- Stair kinds: carpet waterfall/upholstered vs hard-surface plank wrap.
update public.estimate_questions
   set key = 'carpet_stairs',
       help = 'How many steps, and waterfall vs upholstered. This is carpet stair labor — not a hard-surface stair-nose takeoff.',
       config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{purpose}', '"MEASUREMENT"'::jsonb),
         '{knowledge_when}',
         '{"families":["carpet"],"purpose":"MEASUREMENT"}'::jsonb
       )
 where kind = 'stairs' and (key is null or key = '' or key = 'carpet_stairs');

update public.estimate_questions
   set key = 'hs_plank_stairs',
       help = 'Hard-surface stairs are treads/risers and stair noses, not carpet waterfall. Matching stairnose stays on Trims. Do not invent a labor rate if none is on the question.',
       config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{purpose}', '"MEASUREMENT"'::jsonb),
         '{knowledge_when}',
         '{"families":["lvp","hardwood","laminate","vinyl","tile"],"purpose":"MEASUREMENT"}'::jsonb
       )
 where kind = 'hs_stairs' and (key is null or key = '' or key = 'hs_plank_stairs');

-- Tile floor vs wall. Wall does not invent labor.
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0194a001-c0de-4000-8000-000000000001',
       'Hard surface',
       'Floor or wall tile?',
       'Wall tile is only priced from catalog items you pick in Builder. This records the surface — it does not invent wall-tile labor or trim.',
       'choice', 'tile_application', false, true, 218,
       '{"note":true,"multi":false,"purpose":"INSTALLATION","knowledge_when":{"families":["tile"],"purpose":"INSTALLATION"},"show_if":{"key":"surface_type","in":["Tile"]},"options":[{"label":"Floor"},{"label":"Wall"},{"label":"Both"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'tile_application');

-- Floor vs wall before layout / setting materials.
update public.estimate_questions set position = 217 where key = 'tile_application';
update public.estimate_questions set position = 218 where key = 'tile_layout';

-- Sheet vinyl skim / embossing. Notes only — hs_prep already prices skim coat.
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0194a001-c0de-4000-8000-000000000002',
       'Floor prep',
       'Existing floor embossed / needs skim?',
       'Embossed vinyl or patterned existing floors often need a skim coat before new sheet goods. If you cannot see it until demo, pick Field verify — do not invent a bag count here. Skim labor still comes from the Floor prep step when you know you need it.',
       'choice', 'vinyl_skim', false, true, 353,
       '{"note":true,"multi":false,"purpose":"PREP","knowledge_when":{"families":["vinyl"],"purpose":"PREP"},"show_if":{"key":"surface_type","in":["Sheet vinyl"]},"options":[{"label":"Not needed"},{"label":"Skim coat needed"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'vinyl_skim');

commit;
