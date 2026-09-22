-- Floor King — flooring knowledge engine, pass 25.
-- Run in the Supabase SQL editor AFTER 0190–0213. Idempotent — safe to re-run.
--
-- Carpet tile stairs are not waterfall / upholstered wrap.
-- Stretch-in and glue-down broadloom still use the existing stair-type
-- labor (waterfall vs upholstered). Exclusive carpet tile hides that
-- editor and asks a notes-only Yes / No / Field verify plus a step count
-- in EACH. Do not invent stair-nose or wrap labor — pick a catalog item
-- in Builder if Floor King sells it.
--
-- Unanswered carpet_install stays optimistic: waterfall stairs remain
-- visible until Carpet tile is picked.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0214_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'How many steps, and waterfall vs upholstered. Stretch-in and glue-down wrap labor — not hard-surface stair noses, and not carpet tile. Exclusive carpet tile hides this.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"MEASUREMENT"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"require":{"key":"carpet_install","in":["Stretch-in","Glue-down","Unknown / field verify"]},"purpose":"MEASUREMENT"}'::jsonb
       )
 where key = 'carpet_stairs'
    or (kind = 'stairs' and (key is null or key = ''));

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0214a001-c0de-4000-8000-000000000001',
       'Stairs',
       'Carpet tile on stairs?',
       'Carpet tile on stairs is not waterfall wrap. Capture whether stairs are in scope. Do not invent stair-nose or wrap labor — pick a catalog item in Builder if Floor King sells it. Field verify if you have not seen them.',
       'choice', 'carpet_tile_stairs', false, true, 251,
       '{"note":true,"multi":false,"purpose":"MEASUREMENT","knowledge_when":{"families":["carpet"],"systems":["carpet_tile"],"require":{"key":"carpet_install","in":["Carpet tile"]},"purpose":"MEASUREMENT"},"show_if":{"key":"carpet_install","in":["Carpet tile"]},"options":[{"label":"No"},{"label":"Yes"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'carpet_tile_stairs');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0214a001-c0de-4000-8000-000000000002',
       'Stairs',
       'How many carpet-tile steps?',
       'Count of steps in EACH — never square feet. Notes for the crew. Leave blank if you will count on site.',
       'number', 'carpet_tile_stair_count', false, true, 252,
       '{"note":true,"purpose":"MEASUREMENT","knowledge_when":{"families":["carpet"],"systems":["carpet_tile"],"require":{"key":"carpet_tile_stairs","in":["Yes"]},"purpose":"MEASUREMENT"},"show_if":{"key":"carpet_tile_stairs","in":["Yes"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'carpet_tile_stair_count');

update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"any":[{"key":"stairs","in":["Yes"]},{"key":"carpet_stairs","in":["Yes"]},{"key":"hs_plank_stairs","in":["Yes"]},{"key":"carpet_tile_stairs","in":["Yes"]}]}'::jsonb
       )
 where key in ('stair_landings', 'stair_open_sides');

commit;
