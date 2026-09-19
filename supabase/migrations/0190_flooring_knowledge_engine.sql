-- Floor King — flooring knowledge engine (guided estimate).
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- WHAT THIS DOES
--
-- 1. Maps hard-surface types onto the real catalog families (LVP/LVT vs sheet
--    vinyl, solid vs engineered hardwood) without inventing new product
--    categories.
-- 2. Keys the questions the knowledge overlay branches on, and adds AND/OR
--    show_if so adhesive is glue-down only, underlayment is floating + no
--    attached pad, etc.
-- 3. Captures estimator data that was missing: occupancy, grade, attached pad,
--    vapor barrier, prep confidence (Known / Estimated / Allowance / TBD),
--    carpet install system, pattern/direction notes, existing pad, stair
--    construction, access. Notes/TBD — not invented prices.
-- 4. Measures rooms on BOTH carpet and hard-surface paths so MEASURED AREA
--    is taped independently of carpet ORDER QUANTITY (the cuts).
--
-- Does NOT invent carton coverage, cut plans, or catalog categories.
-- Does NOT enable accounting.

-- P0_0190_FLOORING_KNOWLEDGE

begin;

-- 1 · MEASURE — rooms first, both paths --------------------------------------
-- Carpet used to skip rooms and treat cuts as the only size. Cuts remain the
-- order quantity; rooms are the measured area the salesperson taped.
update public.estimate_questions
   set position = 20,
       section = 'Measure',
       label = 'Which areas are we flooring?',
       help = 'Enter rooms in feet and inches. Add a section for closets and offsets. This is MEASURED area — carpet order quantity still comes from the cuts.',
       config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
       )
 where id = '0a53c264-85da-49e3-9635-bb2b1ed13dc1';

-- 2 · SURFACE TYPE — real families, no invented catalog categories ------------
update public.estimate_questions
   set key = 'surface_type',
       help = 'LVP/LVT is boxed. Sheet vinyl is roll goods. Engineered hardwood is still the hardwood catalog — the construction changes permitted install methods.',
       config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{options}',
           '[{"label":"Laminate"},{"label":"LVP / LVT"},{"label":"Hardwood"},{"label":"Engineered hardwood"},{"label":"Tile"},{"label":"Sheet vinyl"}]'::jsonb
         ),
         '{purpose}', '"MATERIAL"'::jsonb
       )
 where id = 'dbf16892-ddf3-4536-aabd-a419cb606c07';

-- Keep mapping the retired "Engineered" / "LVP / Vinyl" labels in the app;
-- new estimates pick the split labels above.

-- 3 · INSTALL METHOD — superset; the UI filters by family --------------------
update public.estimate_questions
   set key = 'install_method',
       help = 'The method changes adhesive, underlayment, fasteners, and moisture questions. Pick what this product actually allows.',
       config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{options}',
           '[{"label":"Floating / click"},{"label":"Glue-down"},{"label":"Nail-down"},{"label":"Staple-down"},{"label":"Loose-lay"},{"label":"Thinset / mortar"}]'::jsonb
         ),
         '{purpose}', '"INSTALLATION"'::jsonb
       )
 where id = 'd31db10e-9b44-4b5d-a008-069e0d428051';

-- 4 · KEYS on existing questions the overlay / new show_if need --------------
update public.estimate_questions set key = 'hs_underlayment'
 where id = '4dd450f1-d003-445c-9135-6477f2a98e9c' and (key is null or key = '' or key = 'hs_underlayment');
update public.estimate_questions set key = 'adhesive'
 where id = '75db35d1-5b51-4a58-baeb-437c6b7c2489' and (key is null or key = '' or key = 'adhesive');
update public.estimate_questions set key = 'acclimation'
 where id = 'f5331bc8-bc96-47f4-a392-eca7d00b694a' and (key is null or key = '' or key = 'acclimation');
update public.estimate_questions set key = 'moisture_test'
 where id = '9400b1d6-9e58-45f8-929d-57dc35dff3be' and (key is null or key = '' or key = 'moisture_test');
update public.estimate_questions set key = 'substrate'
 where id = 'c7bf81f2-c02f-4e92-94d9-3b3a8a7ed691' and (key is null or key = '' or key = 'substrate');
update public.estimate_questions set key = 'moisture_mitigation'
 where id = '2fc7799c-030c-4276-b6fa-801cb9867082' and (key is null or key = '' or key = 'moisture_mitigation');
update public.estimate_questions set key = 'radiant_heat'
 where id = '78fd0c2e-eace-4625-96b2-2080d2f57d55' and (key is null or key = '' or key = 'radiant_heat');

-- Underlayment: floating floors without attached pad (not glue-down, not tile).
update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{show_if}',
           '{"all":[{"key":"install_method","in":["Floating / click"]},{"key":"attached_pad","in":["No","Unknown","Not sure"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"systems":["floating"],"attachedPad":"no","purpose":"MATERIAL"}'::jsonb
       )
 where id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

-- Adhesive: glue-down only (never on floating laminate).
update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{show_if}',
           '{"key":"install_method","in":["Glue-down"]}'::jsonb
         ),
         '{knowledge_when}',
         '{"systems":["glue"],"purpose":"MATERIAL"}'::jsonb
       )
 where id = '75db35d1-5b51-4a58-baeb-437c6b7c2489';

-- Acclimation: hardwood / engineered (construction still catalogs as hardwood).
update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb), '{show_if}',
         '{"any":[{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"install_method","in":["Glue-down"]}]}'::jsonb
       )
 where id = 'f5331bc8-bc96-47f4-a392-eca7d00b694a';

-- Moisture test: glue-down or wood over concrete — not floating click.
update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb), '{show_if}',
         '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"surface_type","in":["Hardwood","Engineered hardwood"]}]}'::jsonb
       )
 where id = '9400b1d6-9e58-45f8-929d-57dc35dff3be';

-- 5 · NEW QUESTIONS (notes / TBD — no invented catalog prices) ---------------

-- Carpet install system
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-000000000009',
       'Carpet',
       'How will the carpet be installed?',
       'Stretch-in over pad is the residential default. Glue-down and carpet tile change pad, tack strip, and adhesive. Do not assume.',
       'choice', 'carpet_install', false, true, 105,
       '{"note":true,"multi":false,"purpose":"INSTALLATION","knowledge_when":{"families":["carpet"],"purpose":"INSTALLATION"},"show_if":{"key":"project_type","in":["Carpet"]},"options":[{"label":"Stretch-in"},{"label":"Glue-down"},{"label":"Carpet tile"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'carpet_install');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-000000000006',
       'Carpet',
       'Pattern match / direction?',
       'Captures layout notes for purchasing and the warehouse. This is not an automatic cut plan.',
       'choice', 'pattern_match', false, true, 106,
       '{"note":true,"multi":false,"purpose":"WAREHOUSE","knowledge_when":{"families":["carpet"],"purpose":"WAREHOUSE"},"show_if":{"key":"project_type","in":["Carpet"]},"options":[{"label":"No pattern / no match"},{"label":"Pattern match required"},{"label":"Directional — run the same way"},{"label":"Unknown / field layout"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'pattern_match');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-000000000007',
       'Carpet',
       'Seam / layout notes',
       'Where seams should fall, roll width concerns, rooms that must run the same direction. For the cut list — not a generated plan.',
       'text', 'carpet_direction', false, true, 107,
       '{"note":true,"purpose":"WAREHOUSE","knowledge_when":{"families":["carpet"],"purpose":"WAREHOUSE"},"show_if":{"key":"project_type","in":["Carpet"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'carpet_direction');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-000000000008',
       'Carpet',
       'Existing pad?',
       'Reuse only when the salesperson explicitly chooses it. Default is remove with the old carpet.',
       'choice', 'existing_pad', false, true, 108,
       '{"note":true,"multi":false,"purpose":"LABOR","knowledge_when":{"families":["carpet"],"purpose":"LABOR"},"show_if":{"key":"project_type","in":["Carpet"]},"options":[{"label":"Remove with old carpet"},{"label":"Reuse (explicitly allowed)"},{"label":"No pad / unknown"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'existing_pad');

-- Attached pad (floating LVP / laminate / engineered)
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-000000000003',
       'Hard surface',
       'Does the product have an attached pad?',
       'Attached pad usually means no separate underlayment. Leave Unknown if the data sheet is not in front of you.',
       'choice', 'attached_pad', false, true, 206,
       '{"note":true,"multi":false,"purpose":"MATERIAL","knowledge_when":{"systems":["floating"],"families":["lvp","laminate","hardwood"],"purpose":"MATERIAL"},"show_if":{"key":"install_method","in":["Floating / click"]},"options":[{"label":"Yes"},{"label":"No"},{"label":"Unknown"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'attached_pad');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-000000000004',
       'Hard surface',
       'Moisture barrier / vapor retarder?',
       'Often required over concrete on floating floors. Capture the need — do not invent a product if it is not in the catalog.',
       'choice', 'vapor_barrier', false, true, 207,
       '{"note":true,"multi":false,"purpose":"PREP","knowledge_when":{"systems":["floating","glue"],"purpose":"PREP"},"show_if":{"any":[{"key":"install_method","in":["Floating / click","Glue-down"]},{"key":"substrate","in":["Concrete"]}]},"options":[{"label":"Required"},{"label":"Included with underlayment"},{"label":"Not needed"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'vapor_barrier');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-000000000002',
       'Hard surface',
       'Grade / location',
       'Above / on / below grade can change what a hardwood or LVP product permits. Confirm against the product, do not assume.',
       'choice', 'construction_grade', false, true, 209,
       '{"note":true,"multi":false,"purpose":"INSTALLATION","knowledge_when":{"families":["hardwood","lvp","laminate","vinyl","tile"],"purpose":"INSTALLATION"},"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"Above grade"},{"label":"On grade"},{"label":"Below grade"},{"label":"Unknown"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'construction_grade');

-- Stair extras (carpet or HS — keyed stairs already exists)
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-00000000000a',
       'Carpet',
       'Stair landings',
       'Landings are usually measured with the rooms; this flags extra pieces and noses.',
       'number', 'stair_landings', false, true, 121,
       '{"note":true,"purpose":"MEASUREMENT","emit":null,"show_if":{"key":"stairs","in":["Yes"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'stair_landings');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-00000000000b',
       'Carpet',
       'Open / closed stair sides',
       'Open sides (waterfall vs wrapped) change carpet and hard-surface nosing. Capture it; pricing still uses existing stair labor/products.',
       'choice', 'stair_open_sides', false, true, 122,
       '{"note":true,"multi":false,"purpose":"MEASUREMENT","show_if":{"key":"stairs","in":["Yes"]},"options":[{"label":"Closed both sides"},{"label":"Open one side"},{"label":"Open both sides"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'stair_open_sides');

-- Prep confidence — do not force fake precision
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-000000000005',
       'Floor prep',
       'How sure are we about the prep?',
       'If the substrate is hidden until demo, pick Field verify / TBD. Builder will show that instead of a fake bag count.',
       'choice', 'prep_confidence', false, true, 355,
       '{"note":true,"multi":false,"purpose":"PREP","show_if":{"key":"project_type","in":["Carpet","Hard surface"]},"options":[{"label":"Known"},{"label":"Estimated"},{"label":"Allowance"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'prep_confidence');

-- Occupancy + access (scheduling / labor notes unless a catalog charge exists)
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-000000000001',
       'Site & schedule',
       'Occupied or vacant?',
       'Affects furniture, scheduling, and install notes. Not a price by itself.',
       'choice', 'occupancy', false, true, 505,
       '{"note":true,"multi":false,"purpose":"SCHEDULING","show_if":{"key":"project_type","in":["Carpet","Hard surface"]},"options":[{"label":"Occupied"},{"label":"Vacant"},{"label":"Unknown"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'occupancy');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-00000000000c',
       'Site & schedule',
       'Access conditions',
       'Upper floor, elevator, long carry, unusual access — scope/schedule notes unless a Floor King labor item is added in Builder.',
       'choice', 'access_conditions', false, true, 532,
       '{"note":true,"multi":true,"purpose":"SCHEDULING","show_if":{"key":"project_type","in":["Carpet","Hard surface"]},"options":[{"label":"Ground floor / easy access"},{"label":"Upper floor"},{"label":"Elevator"},{"label":"Long carry"},{"label":"Unusual / difficult access"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'access_conditions');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0190a001-c0de-4000-8000-00000000000d',
       'Site & schedule',
       'Heavy furniture or specialty items?',
       'Pianos, pool tables, loaded china cabinets. Captured as scope unless a furniture-moving line is already on this job.',
       'choice', 'furniture_heavy', false, true, 512,
       '{"note":true,"multi":true,"purpose":"SCOPE","show_if":{"key":"project_type","in":["Carpet","Hard surface"]},"options":[{"label":"None"},{"label":"Piano"},{"label":"Pool table"},{"label":"Loaded cabinets / antiques"},{"label":"Other — describe"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'furniture_heavy');

commit;

-- After apply you should see the new keys (occupancy, carpet_install, attached_pad,
-- prep_confidence, …) and surface_type options Laminate / LVP / LVT / Hardwood /
-- Engineered hardwood / Tile / Sheet vinyl.
--   select position, section, key, label
--     from public.estimate_questions
--    where active
--    order by position;
