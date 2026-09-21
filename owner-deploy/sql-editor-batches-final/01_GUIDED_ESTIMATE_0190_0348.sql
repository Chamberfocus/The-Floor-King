-- Floor King CRM — GUIDED ESTIMATE SQL Editor FINAL batch 01
-- Source bundle: GUIDED_ESTIMATE_0190_0476_OWNER_DEPLOY.sql
-- Source SHA-256: b6b5a9f9f0ec5e83bfee6707e97da88d70e77fd92e456c5efcaa763c071a6372
-- Source HEAD: 1703ce2fba7bb1da467873ffa422ae701c4fbdac
-- Range: 0190–0348 (159 numbered files)
-- Apply AFTER 0189.
-- Independent transaction: a failure rolls back THIS batch only.
-- Do not skip batches. Do not reorder. Do not apply in parallel.
-- Does NOT enable accounting. Do NOT set books_of_record / posting flags.
-- Quote-escape already applied (12' → 12'' in SQL strings; visible 12').
-- Practical rebatch of the validated 0190–0476 set. SQL interiors unchanged.

BEGIN;
-- BEGIN 0190_flooring_knowledge_engine.sql
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

-- original begin; absorbed into the single owner-bundle transaction

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

-- original commit; absorbed into the single owner-bundle transaction

-- After apply you should see the new keys (occupancy, carpet_install, attached_pad,
-- prep_confidence, …) and surface_type options Laminate / LVP / LVT / Hardwood /
-- Engineered hardwood / Tile / Sheet vinyl.
--   select position, section, key, label
--     from public.estimate_questions
--    where active
--    order by position;
-- END 0190_flooring_knowledge_engine.sql

-- BEGIN 0191_flooring_knowledge_roll_tile_stairs.sql
-- Floor King — flooring knowledge engine, pass 2.
-- Run in the Supabase SQL editor AFTER 0190. Idempotent — safe to re-run.
--
-- Closes gaps 0190 left against the estimator workflow:
--   1. Sheet vinyl is roll goods and needs a layout/cuts capture (area ≠ order).
--   2. Tile layout (straight vs diagonal) — waste is a note, not a fake extra %.
--   3. Hardwood nail/staple fasteners as scope (no invented SKU).
--   4. Existing LVP/laminate/vinyl: glued vs floating — removal is not identical.
--   5. Stair extras must sit AFTER both carpet and hard-surface stair questions
--      so they never appear behind the salesperson.
--   6. Demo (existing conditions) moves before Floor prep.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0191_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Stair extras: 0190 parked these at 121 (Carpet). A hard-surface job answers
-- stairs at position 250, so 121 would pop in BEHIND the salesperson.
update public.estimate_questions
   set position = 265, section = 'Stairs'
 where key = 'stair_landings';
update public.estimate_questions
   set position = 266, section = 'Stairs'
 where key = 'stair_open_sides';

-- Existing conditions before prep (still after install method, which gates
-- adhesive / underlayment without appearing behind the user).
update public.estimate_questions
   set position = 270, section = 'Demo & disposal'
 where id = '789950c7-06a2-4c4b-81ca-15b5a4a54f29'; -- Demo — what's coming up?
update public.estimate_questions
   set position = 275, section = 'Demo & disposal'
 where key = 'demo_disposal';
update public.estimate_questions
   set position = 276, section = 'Demo & disposal'
 where id = '81a746cb-5374-46d2-b828-c7f0053b3c8f'; -- Bulk pickup day

-- Sheet vinyl layout (roll goods). Kind `cuts` reuses the roll-length editor;
-- default widths are 6' / 12' (not carpet 12/15).
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0191a001-c0de-4000-8000-000000000001',
       'Hard surface',
       'Sheet vinyl layout / cuts',
       'Sheet vinyl is roll goods. Enter cut lengths at the product width. Measured room area is not the order quantity — seams and roll width can require more.',
       'cuts', 'vinyl_layout', false, true, 216,
       '{"category":"vinyl","ask_source":true,"widths":[6,12],"install_yd":5,"purpose":"WAREHOUSE","knowledge_when":{"families":["vinyl"],"purpose":"WAREHOUSE"},"show_if":{"key":"surface_type","in":["Sheet vinyl"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'vinyl_layout');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0191a001-c0de-4000-8000-000000000002',
       'Hard surface',
       'Tile layout / pattern',
       'Straight vs diagonal vs a special pattern. If Floor King prices these the same, this is still a scope note for waste and labor. Do not invent a waste percent.',
       'choice', 'tile_layout', false, true, 218,
       '{"note":true,"multi":false,"purpose":"INSTALLATION","knowledge_when":{"families":["tile"],"purpose":"INSTALLATION"},"show_if":{"key":"surface_type","in":["Tile"]},"options":[{"label":"Straight"},{"label":"Diagonal / diamond"},{"label":"Herringbone / special"},{"label":"Unknown / field layout"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'tile_layout');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0191a001-c0de-4000-8000-000000000003',
       'Hard surface',
       'Fasteners (nail / staple)',
       'Nail-down and staple-down need fasteners. Capture the need — pick a catalog item in Builder rather than inventing a SKU here.',
       'choice', 'hardwood_fasteners', false, true, 228,
       '{"note":true,"multi":false,"purpose":"MATERIAL","knowledge_when":{"systems":["nail","staple"],"purpose":"MATERIAL"},"show_if":{"key":"install_method","in":["Nail-down","Staple-down"]},"options":[{"label":"Standard — include in material"},{"label":"Customer / builder supplies"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'hardwood_fasteners');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0191a001-c0de-4000-8000-000000000004',
       'Demo & disposal',
       'Is the existing floor glued down?',
       'Glued hard surface is a different removal than floating click. Uses the existing demo labor rates — this is a crew/scope flag, not a second price.',
       'choice', 'existing_bond', false, true, 272,
       '{"note":true,"multi":false,"purpose":"LABOR","show_if":{"key":"hs_demo","in":["LVP","Laminate","Sheet vinyl","LVP / Vinyl"]},"options":[{"label":"Floating / click — not glued"},{"label":"Glued down"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'existing_bond');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0191_flooring_knowledge_roll_tile_stairs.sql

-- BEGIN 0192_flooring_knowledge_estimator_gaps.sql
-- Floor King — flooring knowledge engine, pass 3.
-- Run in the Supabase SQL editor AFTER 0190 and 0191. Idempotent — safe to re-run.
--
-- Closes remaining estimator gaps without inventing catalog prices:
--   1. Tack strip is a stretch-in carpet condition (keep / replace / not needed),
--      not a generic yes/no parked before the install method.
--   2. Hard-surface substrate includes Unknown / field verify (no fake precision).
--   3. Glue-down adhesive also follows carpet glue-down (not only HS install_method).
--   4. Floating-floor expansion is a scope note, not an invented linear-foot charge.
--   5. Tile setting materials (thinset / grout / backer) record the NEED — bag
--      counts stay TBD until a catalog item is picked in Builder.
--   6. Vents/registers are EACH, never square feet, and do not invent a price.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0192_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Tack strip: existing yes/no ("Tackless (tackstrip) needed?") becomes a keyed
-- condition after carpet_install so glue-down / carpet tile can hide it.
update public.estimate_questions
   set key = 'tack_strip',
       position = 109,
       section = 'Carpet',
       kind = 'choice',
       label = 'Tack strip condition?',
       help = 'Stretch-in needs tack strip. Glue-down and carpet tile do not. Capture keep vs replace — pick a catalog item in Builder rather than inventing a linear-foot price here.',
       config = '{"note":true,"multi":false,"purpose":"ACCESSORY","knowledge_when":{"families":["carpet"],"systems":["stretch_in"],"purpose":"ACCESSORY"},"show_if":{"key":"project_type","in":["Carpet"]},"options":[{"label":"Keep existing — in good shape"},{"label":"Replace / new tack strip"},{"label":"Not needed (glue-down / tile)"},{"label":"Unknown / field verify"}]}'::jsonb
 where key = 'tack_strip'
    or label = 'Tackless (tackstrip) needed?';

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0192a001-c0de-4000-8000-000000000001',
       'Carpet',
       'Tack strip condition?',
       'Stretch-in needs tack strip. Glue-down and carpet tile do not. Capture keep vs replace — pick a catalog item in Builder rather than inventing a linear-foot price here.',
       'choice', 'tack_strip', false, true, 109,
       '{"note":true,"multi":false,"purpose":"ACCESSORY","knowledge_when":{"families":["carpet"],"systems":["stretch_in"],"purpose":"ACCESSORY"},"show_if":{"key":"project_type","in":["Carpet"]},"options":[{"label":"Keep existing — in good shape"},{"label":"Replace / new tack strip"},{"label":"Not needed (glue-down / tile)"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'tack_strip');

-- Substrate: do not force plywood vs concrete when the salesperson cannot see it.
update public.estimate_questions
   set help = 'If you cannot see the substrate until demo, pick Unknown / field verify rather than guessing.',
       config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{options}',
           '[{"label":"Concrete"},{"label":"Plywood / OSB"},{"label":"Wood"},{"label":"Existing flooring"},{"label":"Other"},{"label":"Unknown / field verify"}]'::jsonb
         ),
         '{purpose}', '"PREP"'::jsonb
       )
 where id = 'c7bf81f2-c02f-4e92-94d9-3b3a8a7ed691';

-- Adhesive: glue-down on hard surface OR carpet glue-down.
update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{show_if}',
           '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"systems":["glue"],"purpose":"MATERIAL"}'::jsonb
       )
 where id = '75db35d1-5b51-4a58-baeb-437c6b7c2489';

-- Floating expansion (laminate / floating LVP / floating engineered) — scope only.
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0192a001-c0de-4000-8000-000000000002',
       'Hard surface',
       'Expansion / perimeter gaps?',
       'Floating floors need expansion at walls and transitions. Record it as scope; add catalog reducers / T-molds / quarter round on Trims rather than inventing a linear-foot charge here.',
       'choice', 'laminate_expansion', false, true, 217,
       '{"note":true,"multi":false,"purpose":"SCOPE","knowledge_when":{"systems":["floating"],"purpose":"SCOPE"},"show_if":{"key":"install_method","in":["Floating / click"]},"options":[{"label":"Standard — cover with trim"},{"label":"Tight / existing base stays"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'laminate_expansion');

-- Tile setting materials — need only, no invented bag counts.
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0192a001-c0de-4000-8000-000000000003',
       'Hard surface',
       'Tile setting materials needed?',
       'Thinset, grout, and backer come from the catalog in Builder. This records the need — do not invent bag counts or coverage.',
       'choice', 'tile_setting', false, true, 219,
       '{"note":true,"multi":true,"purpose":"MATERIAL","knowledge_when":{"families":["tile"],"purpose":"MATERIAL"},"show_if":{"key":"surface_type","in":["Tile"]},"options":[{"label":"Thinset / mortar"},{"label":"Grout"},{"label":"Backer board / membrane"},{"label":"Included / not needed"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'tile_setting');

-- Vents / registers: EACH, no invented price.
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0192a001-c0de-4000-8000-000000000004',
       'Trims',
       'Floor vents / registers to change?',
       'Count in EACH — never square feet. Pick a catalog vent on this trim list if Floor King sells it; otherwise this is a crew note, not a price.',
       'number', 'vents_registers', false, true, 602,
       '{"note":true,"purpose":"ACCESSORY","show_if":{"key":"project_type","in":["Carpet","Hard surface"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'vents_registers');

-- Furniture moving already has Floor King light/medium/heavy labor rates.
-- Specialty items stay notes-only on furniture_heavy.
update public.estimate_questions
   set help = 'Pianos, pool tables, loaded china cabinets. Captured as scope unless a furniture-moving line (light/medium/heavy) is already on this job. Do not invent a second charge here.'
 where key = 'furniture_heavy';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0192_flooring_knowledge_estimator_gaps.sql

-- BEGIN 0193_flooring_knowledge_subfloor_condition.sql
-- Floor King — flooring knowledge engine, pass 4.
-- Run in the Supabase SQL editor AFTER 0190–0192. Idempotent — safe to re-run.
--
-- 1. Subfloor CONDITION (flat / uneven / cracks / damage / height / moisture)
--    with Unknown / field verify — do not force a bag count before demo.
-- 2. Patterned / Berber-loop as a carpet layout option (not a new catalog type).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0193_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0193a001-c0de-4000-8000-000000000001',
       'Floor prep',
       'What is the substrate condition?',
       'If you cannot see it until demo, pick Unknown / field verify. Prep bag counts stay TBD unless you already know.',
       'choice', 'subfloor_condition', false, true, 352,
       '{"note":true,"multi":true,"purpose":"PREP","knowledge_when":{"purpose":"PREP"},"show_if":{"key":"project_type","in":["Carpet","Hard surface"]},"options":[{"label":"Flat / sound"},{"label":"Uneven"},{"label":"Cracks"},{"label":"Damage / soft spots"},{"label":"Height difference / transitions"},{"label":"Moisture concerns"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'subfloor_condition');

-- Berber / loop is a layout/stretch note, not a new catalog category.
update public.estimate_questions
   set config = jsonb_set(
         config,
         '{options}',
         coalesce(config->'options', '[]'::jsonb) || '[{"label":"Berber / loop — watch seams & stretch"}]'::jsonb
       )
 where key = 'pattern_match'
   and not (config->'options' @> '[{"label":"Berber / loop — watch seams & stretch"}]'::jsonb);

-- original commit; absorbed into the single owner-bundle transaction
-- END 0193_flooring_knowledge_subfloor_condition.sql

-- BEGIN 0194_flooring_knowledge_job_conditions.sql
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

-- original begin; absorbed into the single owner-bundle transaction

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

-- original commit; absorbed into the single owner-bundle transaction
-- END 0194_flooring_knowledge_job_conditions.sql

-- BEGIN 0195_flooring_knowledge_pattern_delivery.sql
-- Floor King — flooring knowledge engine, pass 6.
-- Run in the Supabase SQL editor AFTER 0190–0194. Idempotent — safe to re-run.
--
-- 1. Pattern repeat (inches) when patterned carpet is in play — warehouse /
--    purchasing notes for a future cut engine. Does NOT generate a cut plan.
-- 2. Delivery scope — Floor King has a Delivery add-on. Capture include vs
--    pickup vs TBD; do not invent a fuel charge here.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0195_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0195a001-c0de-4000-8000-000000000001',
       'Carpet',
       'Pattern repeat (inches)?',
       'For purchasing and layout notes. This is not a cut plan — roll width, seams, and matching can still require more than measured area.',
       'number', 'pattern_repeat', false, true, 107,
       '{"note":true,"purpose":"WAREHOUSE","knowledge_when":{"families":["carpet"],"require":{"key":"pattern_match","in":["Pattern match required"]},"purpose":"WAREHOUSE"},"show_if":{"key":"pattern_match","in":["Pattern match required"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'pattern_repeat');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0195a001-c0de-4000-8000-000000000002',
       'Site & schedule',
       'Delivery?',
       'Floor King has a Delivery add-on. Record whether to include it — pick the catalog line in Builder rather than inventing a fuel charge here.',
       'choice', 'delivery_scope', false, true, 535,
       '{"note":true,"multi":false,"purpose":"PURCHASING","knowledge_when":{"purpose":"PURCHASING"},"show_if":{"key":"project_type","in":["Carpet","Hard surface"]},"options":[{"label":"Include delivery"},{"label":"Customer pickup / will call"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'delivery_scope');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0195_flooring_knowledge_pattern_delivery.sql

-- BEGIN 0196_flooring_knowledge_stair_gates.sql
-- Floor King — flooring knowledge engine, pass 7.
-- Run in the Supabase SQL editor AFTER 0190–0195. Idempotent — safe to re-run.
--
-- 1. Stair landings / open sides were gated on the deactivated
--    "Stairs being done?" yes/no (`key=stairs`). Live stair capture is the
--    carpet waterfall/upholstered step list and the hard-surface plank
--    steps. Re-gate so those follow-ups appear after a step count is entered.
-- 2. Floating underlayment used to require attached_pad already answered
--    (No / Unknown). Unanswered attached-pad hid the question. Overlay still
--    hides underlayment when attached pad is Yes.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0196_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{show_if}',
           '{"any":[{"key":"stairs","in":["Yes"]},{"key":"carpet_stairs","in":["Yes"]},{"key":"hs_plank_stairs","in":["Yes"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"MEASUREMENT","require":{"key":"stairs","in":["Yes"]}}'::jsonb
       ),
       help = 'Landings are usually measured with the rooms; this flags extra pieces and noses. Count in EACH — never square feet.',
       section = 'Stairs'
 where key in ('stair_landings', 'stair_open_sides');

update public.estimate_questions
   set help = 'Landings are usually measured with the rooms; this flags extra pieces and noses. Count in EACH — never square feet.'
 where key = 'stair_landings';

update public.estimate_questions
   set help = 'Open sides (waterfall vs wrapped) change carpet and hard-surface nosing. Capture it; pricing still uses existing stair labor/products.'
 where key = 'stair_open_sides';

-- Underlayment: floating method is enough. Attached-pad Yes is an overlay hide.
update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{show_if}',
           '{"key":"install_method","in":["Floating / click"]}'::jsonb
         ),
         '{knowledge_when}',
         '{"systems":["floating"],"attachedPad":"no","purpose":"MATERIAL"}'::jsonb
       )
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0196_flooring_knowledge_stair_gates.sql

-- BEGIN 0197_flooring_knowledge_scope_notes.sql
-- Floor King — flooring knowledge engine, pass 8.
-- Run in the Supabase SQL editor AFTER 0190–0196. Idempotent — safe to re-run.
--
-- 1. Asbestos risk when tearing out old ceramic/sheet vinyl (pre-1985). Scope /
--    warning only — does NOT invent abatement pricing.
-- 2. Hard-surface plank run direction (LVP / laminate / hardwood). Warehouse /
--    layout note — does NOT auto-inflate waste.
--
-- Delivery stays a choice. The app emits a Delivery line only when Settings →
-- Default pricing already has a Delivery cost; it does not invent fuel $.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0197_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0197a001-c0de-4000-8000-000000000001',
       'Demo & disposal',
       'Asbestos risk in existing vinyl / ceramic?',
       'Sheet vinyl or ceramic from before ~1985 may contain asbestos. Capture it for the crew. Do not invent an abatement price here.',
       'choice', 'asbestos_risk', false, true, 277,
       '{"note":true,"multi":false,"purpose":"WARNING","knowledge_when":{"purpose":"WARNING"},"show_if":{"key":"hs_demo","in":["Ceramic WITH mortar bed","Ceramic WITHOUT mortar bed","Sheet vinyl"]},"options":[{"label":"No — not applicable"},{"label":"Possible — test before removal"},{"label":"Confirmed — abatement required"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'asbestos_risk');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0197a001-c0de-4000-8000-000000000002',
       'Hard surface',
       'Plank / board run direction?',
       'Which way the planks run. Affects seams, waste, and the warehouse. Do not auto-inflate waste from this answer.',
       'choice', 'hs_direction', false, true, 214,
       '{"note":true,"multi":false,"purpose":"WAREHOUSE","knowledge_when":{"families":["lvp","laminate","hardwood"],"purpose":"WAREHOUSE"},"show_if":{"key":"surface_type","in":["Laminate","LVP / LVT","Hardwood","Engineered hardwood"]},"options":[{"label":"Down the length of the room"},{"label":"Across the width"},{"label":"Diagonal / special"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'hs_direction');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0197_flooring_knowledge_scope_notes.sql

-- BEGIN 0198_flooring_knowledge_vapor_barrier.sql
-- Floor King — flooring knowledge engine, pass 9.
-- Run in the Supabase SQL editor AFTER 0190–0197. Idempotent — safe to re-run.
--
-- vapor_barrier show_if is already OR(floating/glue, Concrete). The overlay
-- knowledge_when was AND systems floating|glue, so nail-down hardwood over a
-- slab never asked. Align overlay with show_if. Does not invent a vapor-barrier
-- product or a bag count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0198_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{knowledge_when}',
         '{"purpose":"PREP","any":[{"systems":["floating","glue"]},{"substrate":["Concrete"]}]}'::jsonb
       ),
       help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0198_flooring_knowledge_vapor_barrier.sql

-- BEGIN 0199_flooring_knowledge_hs_trim.sql
-- Floor King — flooring knowledge engine, pass 10.
-- Run in the Supabase SQL editor AFTER 0190–0198. Idempotent — safe to re-run.
--
-- Hard-surface doorway transitions and base/shoe/quarter-round were asked as
-- priced choice rows (0081) then deactivated because Trims already captures
-- them (0085 / 0117). New salespeople still skip Trims. Re-ask as NOTES only:
-- which types are needed, in EACH (transitions) or LN FT (base/QR/shoe).
-- Matching pieces are added on Trims from existing TRIM_TYPES — this does NOT
-- invent Versatrim SKUs, carton coverage, or a second priced transition line.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0199_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0199a001-c0de-4000-8000-000000000001',
       'trim',
       'Doorway transitions needed?',
       'T-mold, reducer, end cap, threshold, or metal — EACH, never square feet. Pick the types here, then add matching catalog pieces on Trims. Do not invent a SKU or price here. Field verify is allowed.',
       'choice', 'hs_transitions', false, true, 291,
       '{"note":true,"multi":true,"purpose":"ACCESSORY","knowledge_when":{"families":["lvp","hardwood","laminate","vinyl","tile"],"purpose":"ACCESSORY"},"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"None — keep existing / no new transitions"},{"label":"T-mold"},{"label":"Reducer"},{"label":"End cap"},{"label":"Threshold"},{"label":"Metal"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'hs_transitions');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0199a001-c0de-4000-8000-000000000002',
       'trim',
       'Base / quarter round / shoe?',
       'Linear feet, never square feet. Pick the profiles here, then enter footage on Trims. Keep existing or Field verify if demo has not happened. Do not invent a molding SKU here.',
       'choice', 'hs_base_trim', false, true, 292,
       '{"note":true,"multi":true,"purpose":"ACCESSORY","knowledge_when":{"families":["lvp","hardwood","laminate","vinyl","tile"],"purpose":"ACCESSORY"},"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"Keep existing base"},{"label":"Quarter round"},{"label":"Shoe molding"},{"label":"Baseboard"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'hs_base_trim');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0199_flooring_knowledge_hs_trim.sql

-- BEGIN 0200_flooring_knowledge_prep_gates.sql
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

-- original begin; absorbed into the single owner-bundle transaction

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

-- original commit; absorbed into the single owner-bundle transaction
-- END 0200_flooring_knowledge_prep_gates.sql

-- BEGIN 0201_flooring_knowledge_shared_demo.sql
-- Floor King — flooring knowledge engine, pass 12.
-- Run in the Supabase SQL editor AFTER 0190–0200. Idempotent — safe to re-run.
--
-- Removal and substrate must be shared across Carpet and Hard surface:
--   1. Demo ("what's coming up?") is the one typed tear-out question. 0142
--      already opened it to Carpet + Hard surface and retired the generic
--      $0.50 "Tear up the old floor?" so mixed jobs could not double-charge.
--      This reaffirms that gate so a knowledge-engine apply sequence
--      (0190–0201) does not depend on re-running 0142. Existing per-material
--      demo rates stay — this does not invent a second carpet tear-out price.
--   2. Demo disposal still hangs off a real demo type (not "None"), so carpet
--      jobs that pick Carpet on demo get haul/dumpster/curb the same way.
--   3. Substrate (concrete / plywood / OSB / existing / unknown) is asked on
--      carpet too. 0193 already asks CONDITION on both paths; identifying the
--      substrate is what moisture / vapor follow-ups hang off. Restores the
--      original carpet Subfloor question without a second copy.
--   4. Vapor barrier show_if also follows carpet glue-down (overlay already
--      treats glue as a system). Stretch-in over plywood still hides it until
--      the salesperson picks Concrete.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0201_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Shared typed demo — Carpet and Hard surface, one question, existing rates.
update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
       )
 where id = '789950c7-06a2-4c4b-81ca-15b5a4a54f29'; -- Demo — what's coming up?

-- Disposal only after a real demo type (0120). Reaffirm so carpet demo counts.
update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"key":"hs_demo","in":["Carpet","Ceramic WITH mortar bed","Ceramic WITHOUT mortar bed","Sheet vinyl","Luan","LVP","Laminate","Glue-down hardwood","Nailed hardwood","Other"]}'::jsonb
       )
 where key = 'demo_disposal';

-- Substrate on either path — unknown/field verify remains an option (0192).
update public.estimate_questions
   set help = 'Concrete, wood, or existing flooring — or Unknown / field verify if you cannot see it until demo. Carpet and hard surface share this question.',
       config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
       )
 where id = 'c7bf81f2-c02f-4e92-94d9-3b3a8a7ed691'; -- substrate

-- Vapor barrier: floating/glue hard surface, carpet glue-down, or a slab.
update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"any":[{"key":"install_method","in":["Floating / click","Glue-down"]},{"key":"carpet_install","in":["Glue-down"]},{"key":"substrate","in":["Concrete"]}]}'::jsonb
       )
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0201_flooring_knowledge_shared_demo.sql

-- BEGIN 0202_flooring_knowledge_tile_carpet_prep.sql
-- Floor King — flooring knowledge engine, pass 13.
-- Run in the Supabase SQL editor AFTER 0190–0201. Idempotent — safe to re-run.
--
-- Remaining estimator branches that 0201 left open:
--   1. Moisture mitigation method (Aqua bar / primer) was asked on EVERY hard-
--      surface job after 0117 folded "needed?" into None. Floating laminate over
--      plywood does not need that priced line. Gate it like moisture_test:
--      hardwood OR glue-down OR a Moisture concerns flag. Existing Aqua bar /
--      primer rates stay — this does not invent a product or a new dollar amount.
--   2. Carpet tile typically needs adhesive (pressure-sensitive or glue). The
--      overlay hid adhesive because it was glue-system only. Reuse the existing
--      adhesive catalog pick — do not invent a carpet-tile glue SKU.
--   3. Tile body (ceramic / porcelain / natural stone) is a scope note. Floor
--      King catalogs tile as one category; this does not invent a catalog split
--      or a waste percent. Setting materials still come from tile_setting /
--      Builder.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0202_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Moisture mitigation: same intelligent gate as moisture_test (0200).
update public.estimate_questions
   set help = 'Hardwood, glue-down, or a moisture-concern flag. Floating laminate without that flag hides this — pick None only when the question is showing. Do not invent an Aqua bar line on a dry floating job.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"subfloor_condition","in":["Moisture concerns"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP","any":[{"families":["hardwood"]},{"systems":["glue"]},{"subfloor":["Moisture concerns"]}]}'::jsonb
       )
 where key = 'moisture_mitigation'
    or id = '2fc7799c-030c-4276-b6fa-801cb9867082';

-- Adhesive: glue-down hard surface, glue-down carpet, OR carpet tile.
update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Do not invent a SKU — pick one in Builder or leave the product empty.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down","Carpet tile"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"systems":["glue","carpet_tile"],"purpose":"MATERIAL"}'::jsonb
       )
 where key = 'adhesive'
    or id = '75db35d1-5b51-4a58-baeb-437c6b7c2489';

-- Tile body — notes only. Catalog category stays `tile`.
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0202a001-c0de-4000-8000-000000000001',
       'Hard surface',
       'Tile body?',
       'Ceramic, porcelain, or natural stone. Floor King catalogs these as tile — this is scope for setting and waste notes, not a new category or an invented waste percent. Pick setting materials in Builder.',
       'choice', 'tile_body', false, true, 218,
       '{"note":true,"multi":false,"purpose":"INSTALLATION","knowledge_when":{"families":["tile"],"purpose":"INSTALLATION"},"show_if":{"key":"surface_type","in":["Tile"]},"options":[{"label":"Ceramic"},{"label":"Porcelain"},{"label":"Natural stone"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'tile_body');

-- Floor vs wall → body → layout → setting.
update public.estimate_questions set position = 217 where key = 'tile_application';
update public.estimate_questions set position = 218 where key = 'tile_body';
update public.estimate_questions set position = 219 where key = 'tile_layout';
update public.estimate_questions set position = 220 where key = 'tile_setting';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0202_flooring_knowledge_tile_carpet_prep.sql

-- BEGIN 0203_flooring_knowledge_radiant_tile_format.sql
-- Floor King — flooring knowledge engine, pass 14.
-- Run in the Supabase SQL editor AFTER 0190–0202. Idempotent — safe to re-run.
--
-- Remaining estimator branches:
--   1. Radiant heat is an install condition for carpet as well as hard surface
--      (pad, glue, and many products have radiant limits). 0107 gated it to
--      Hard surface only. Notes / warning only — this does not invent a
--      radiant-rated product or a price.
--   2. Tile format / size is a scope note (standard vs plank vs large format vs
--      mosaic). Floor King catalogs tile as one category; this does not invent
--      a waste percent or a second SKU. Large-format flatness stays Field verify.
--
-- Mixed LVP + hardwood sharing one job-level install method is a warning in
-- the overlay (no SQL question) — do not invent a per-room install editor here.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0203_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Radiant: either path. Overlay already has no family restriction.
update public.estimate_questions
   set help = 'Carpet pad, glue-down, and many hard-surface products have radiant limits. Flag it so purchasing can confirm the product is rated — do not invent a radiant SKU.',
       config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
       )
 where key = 'radiant_heat'
    or id = '78fd0c2e-eace-4625-96b2-2080d2f57d55';

-- Tile format — notes only, after body, before layout.
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0203a001-c0de-4000-8000-000000000001',
       'Hard surface',
       'Tile size / format?',
       'Size changes waste and floor-flatness notes. Still the tile catalog — do not invent a waste percent. Large format often needs a flatter substrate; pick Field verify if you have not seen the floor.',
       'choice', 'tile_format', false, true, 219,
       '{"note":true,"multi":false,"purpose":"INSTALLATION","knowledge_when":{"families":["tile"],"purpose":"INSTALLATION"},"show_if":{"key":"surface_type","in":["Tile"]},"options":[{"label":"Standard (about 12x12 or smaller)"},{"label":"Plank / rectangular"},{"label":"Large format (24\" or larger)"},{"label":"Mosaic / hex"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'tile_format');

update public.estimate_questions set position = 217 where key = 'tile_application';
update public.estimate_questions set position = 218 where key = 'tile_body';
update public.estimate_questions set position = 219 where key = 'tile_format';
update public.estimate_questions set position = 220 where key = 'tile_layout';
update public.estimate_questions set position = 221 where key = 'tile_setting';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0203_flooring_knowledge_radiant_tile_format.sql

-- BEGIN 0204_flooring_knowledge_grade_carpet.sql
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

-- original begin; absorbed into the single owner-bundle transaction

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

-- original commit; absorbed into the single owner-bundle transaction
-- END 0204_flooring_knowledge_grade_carpet.sql

-- BEGIN 0205_flooring_knowledge_carpet_glue_climate.sql
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

-- original begin; absorbed into the single owner-bundle transaction

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

-- original commit; absorbed into the single owner-bundle transaction
-- END 0205_flooring_knowledge_carpet_glue_climate.sql

-- BEGIN 0206_flooring_knowledge_shared_prep.sql
-- Floor King — flooring knowledge engine, pass 17.
-- Run in the Supabase SQL editor AFTER 0190–0205. Idempotent — safe to re-run.
--
-- Floor prep is one shared tail (0142): the carpet duplicate was switched off
-- and hs_prep / prep_scope were opened to Carpet + Hard surface. The knowledge
-- engine apply sequence (0190–0205) never reaffirmed those gates, and
-- "Subfloor needed?" was left on Hard surface only — so a carpet-only job
-- could pick Self-leveling on Floor prep, never see the sheet question, and
-- never record Field verify when the deck is hidden until demo.
--
-- This pass:
--   1. Reaffirms prep_scope and hs_prep on Carpet + Hard surface (0142).
--   2. Opens subfloor_needed on either path. Yes / No stay; Field verify / TBD
--      is added so we do not force a fake Yes that would emit 4×8 sheets.
--      Sheet counts still emit only on Yes (kind=subfloor), and still withhold
--      when prep_confidence is Field verify.
--   3. Reaffirms selflevel bags on hs_prep Self-leveling (0120) so a carpet
--      job that actually self-levels can count bags. Overlay require matches.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0206_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Prep same across the job? — either path, before rooms (0142).
update public.estimate_questions
   set help = 'If prep varies by room, set it on each room. Carpet and hard surface share Floor prep — do not answer it twice.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
           ),
           '{purpose}',
           '"PREP"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP"}'::jsonb
       )
 where key = 'prep_scope'
    or id = '8075de6f-91a3-4905-9599-f8d695472a4f';

-- Floor prep / leveling — one question, either path. Existing labor rates stay.
update public.estimate_questions
   set help = 'Patch, self-level, or grind — asked once for carpet or hard surface. Bag/sheet counts stay on the follow-ups; Field verify on prep confidence withholds them.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
           ),
           '{purpose}',
           '"PREP"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP"}'::jsonb
       )
 where key = 'hs_prep'
    or id = '07cdad54-20d9-4bba-896f-cf0634da772c';

-- Subfloor needed? — either path. Field verify does not invent a sheet count.
update public.estimate_questions
   set kind = 'choice',
       help = 'Plywood / OSB underlayment sheets when the existing deck cannot stay. Carpet and hard surface share this. If you cannot see it until demo, pick Field verify / TBD — do not invent a 4×8 count.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 coalesce(config, '{}'::jsonb),
                 '{show_if}',
                 '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
               ),
               '{purpose}',
               '"PREP"'::jsonb
             ),
             '{knowledge_when}',
             '{"purpose":"PREP"}'::jsonb
           ),
           '{note}',
           'true'::jsonb
         ),
         '{options}',
         '[{"label":"Yes"},{"label":"No"},{"label":"Field verify / TBD"}]'::jsonb
       )
 where key = 'subfloor_needed'
    or (label = 'Subfloor needed?' and (key is null or key = '' or key = 'subfloor_needed'));

-- 4×8 sheets only after a real Yes — never on No or Field verify.
update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"key":"subfloor_needed","in":["Yes"]}'::jsonb
       )
 where kind = 'subfloor';

-- Bag count only when Floor prep includes Self-leveling (carpet or HS).
update public.estimate_questions
   set help = 'Count bags only when Floor prep is Self-leveling. Stretch-in carpet with None / skim hides this. Field verify on prep confidence withholds the bag count.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"hs_prep","in":["Self-leveling"]}'::jsonb
           ),
           '{purpose}',
           '"PREP"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP","require":{"key":"hs_prep","in":["Self-leveling"]}}'::jsonb
       )
 where key = 'selflevel_needed'
    or label = 'Self-leveler — count the bags?';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0206_flooring_knowledge_shared_prep.sql

-- BEGIN 0207_flooring_knowledge_bond_site.sql
-- Floor King — flooring knowledge engine, pass 18.
-- Run in the Supabase SQL editor AFTER 0190–0206. Idempotent — safe to re-run.
--
-- Removal and site conditions the estimator always needs, without a second price:
--   1. Glued vs floating (existing_bond) is only about tearing up LVP / laminate /
--      sheet vinyl. 0191 already gated show_if that way; overlay had no require,
--      so a carpet-only stretch-in job still looked like it should ask "is it
--      glued?" Live knowledge_when must match so a leftover overlay cannot
--      keep that question in play after demo is Carpet / ceramic / hardwood.
--      Demo rates stay the existing per-material lines — this is still a
--      scope flag, not a second tear-out SKU.
--   2. Doors to shave and furniture moving were the original carpet questions
--      (0076) merged onto both paths (0085/0142). Reaffirm Carpet + Hard surface
--      so a knowledge-engine apply sequence does not depend on re-running 0085.
--      Count doors in EACH; furniture uses existing light/medium/heavy labor.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0207_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Glued vs floating only after a demo type that can be either.
update public.estimate_questions
   set help = 'Glued LVP / laminate / sheet vinyl is a different tear-out than floating click. Scope note — existing demo rates stay. Carpet, ceramic, and nailed hardwood already named the bond on the demo pick.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"hs_demo","in":["LVP","Laminate","Sheet vinyl","LVP / Vinyl"]}'::jsonb
           ),
           '{purpose}',
           '"LABOR"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"LABOR","require":{"key":"hs_demo","in":["LVP","Laminate","Sheet vinyl","LVP / Vinyl"]}}'::jsonb
       )
 where key = 'existing_bond';

-- Door undercut — EACH, either path. Existing $15/door labor stays.
update public.estimate_questions
   set help = 'Count of doors to undercut, in EACH. Never square feet. Carpet and hard surface share this — thicker new floor or a metal can bind a door.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
           ),
           '{purpose}',
           '"LABOR"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"LABOR"}'::jsonb
       )
 where key = 'doors_shave'
    or id = '911ca1f0-d0a5-4048-9b1e-2e07fde68231';

-- Furniture light/medium/heavy — existing labor rates, either path.
update public.estimate_questions
   set help = 'Light / medium / heavy uses Floor King furniture-moving labor. Pianos and pool tables stay on the specialty-items question as scope — do not double-charge. Asked on carpet and hard surface.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
           ),
           '{purpose}',
           '"LABOR"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"LABOR"}'::jsonb
       )
 where key = 'furniture_level'
    or id = 'd65f32f1-7448-4106-8cdc-3ea20cedf672';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0207_flooring_knowledge_bond_site.sql

-- BEGIN 0208_flooring_knowledge_stretch_pad.sql
-- Floor King — flooring knowledge engine, pass 19.
-- Run in the Supabase SQL editor AFTER 0190–0207. Idempotent — safe to re-run.
--
-- Stretch-in carpet accessories were still SQL-gated on "Carpet" only:
--   1. Tack strip (0192) had overlay systems stretch_in, but show_if was every
--      carpet job. Glue-down / carpet tile should never ask keep-vs-replace
--      tack strip — they do not use it. Gate show_if on carpet_install
--      Stretch-in so leftover overlay cannot keep the question in play.
--   2. Carpet pad (0194) is the residential stretch-in product picker. Overlay
--      already hid it on glue-down / tile; live show_if must match so a
--      glue-down job does not still present a pad SKU.
--   Existing pad removal (existing_pad) stays on every carpet job — tearing
--      out old pad is not the same as selling new pad.
--   Metals / transitions stay on every carpet job (doorways still exist).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0208_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Tack strip: stretch-in only. Keep / replace / field verify — pick a catalog
-- item in Builder rather than inventing a linear-foot price here.
update public.estimate_questions
   set help = 'Stretch-in needs tack strip. Glue-down and carpet tile hide this. Capture keep vs replace — pick a catalog item in Builder rather than inventing a linear-foot price here.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"carpet_install","in":["Stretch-in"]}'::jsonb
           ),
           '{purpose}',
           '"ACCESSORY"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"systems":["stretch_in"],"require":{"key":"carpet_install","in":["Stretch-in"]},"purpose":"ACCESSORY"}'::jsonb
       )
 where key = 'tack_strip';

-- New residential pad: stretch-in only. Glue-down / carpet tile do not use it.
update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this step — they do not use residential pad. Existing pad removal stays on the demo questions.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"carpet_install","in":["Stretch-in"]}'::jsonb
           ),
           '{purpose}',
           '"MATERIAL"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"systems":["stretch_in"],"require":{"key":"carpet_install","in":["Stretch-in"]},"purpose":"MATERIAL"}'::jsonb
       )
 where key = 'carpet_pad'
    or id = 'c96e8386-c44e-4ca1-95b9-3c24d15c9437';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0208_flooring_knowledge_stretch_pad.sql

-- BEGIN 0209_flooring_knowledge_mixed_install.sql
-- Floor King — flooring knowledge engine, pass 20.
-- Run in the Supabase SQL editor AFTER 0190–0208. Idempotent — safe to re-run.
--
-- Mixed hard-surface jobs (LVP + hardwood, laminate + tile, …) were forced
-- through ONE install_method chip. Picking Floating hid fasteners; picking
-- Nail-down hid attached pad. An estimator on a mixed job needs both branches.
--
--   1. install_method is multi-select in the catalog so the Guided Estimate
--      can keep every method in play. The app still uses single-select when
--      only one hard-surface family is on the job (laminate stays floating).
--   2. Help text tells the salesperson to pick every system actually used.
--      Follow-up questions still come from existing adhesive / pad / fastener
--      catalog picks — this does not invent a per-room editor or a SKU.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0209_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'The method changes adhesive, underlayment, fasteners, and moisture questions. If this job has more than one hard-surface product, pick every method in play — one chip still hides the other branch. Confirm what each product actually allows.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{multi}',
             'true'::jsonb
           ),
           '{purpose}',
           '"INSTALLATION"'::jsonb
         ),
         '{note}',
         'true'::jsonb
       )
 where key = 'install_method'
    or id = 'd31db10e-9b44-4b5d-a008-069e0d428051';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0209_flooring_knowledge_mixed_install.sql

-- BEGIN 0210_flooring_knowledge_metals_entry.sql
-- Floor King — flooring knowledge engine, pass 21.
-- Run in the Supabase SQL editor AFTER 0190–0209. Idempotent — safe to re-run.
--
-- Carpet doorway metals were a Yes/No with unkeyed type/color follow-ups, so
-- the estimator never captured HOW MANY transitions. Site access (lockbox /
-- homeowner / key) had no key, so review could not file it as scheduling.
-- Occupancy, access conditions, heavy furniture, and climate control already
-- exist on both Carpet and Hard surface — reaffirm knowledge_when so a
-- leftover overlay cannot hide them.
--
--   1. metals_qty — count in EACH after metals_needed Yes. Notes only; do not
--      invent a gripper/flat-metal price. Type and color stay as follow-ups.
--   2. Key Site access as crew_entry (how the crew gets in — not the same as
--      upper-floor / elevator access_conditions).
--   3. Key Metal type / Metal color so review buckets stay ACCESSORY.
--   4. Occupancy / access_conditions / furniture_heavy / climate_control keep
--      show_if Carpet + Hard surface. Climate is install conditions for every
--      path; the acclimation WARNING still fires only on hardwood / glue.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0210_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- How many carpet transitions? EACH, never square feet. No invented $ rate.
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0210a001-c0de-4000-8000-000000000001',
       'Carpet',
       'How many metals / transitions?',
       'Count of doorways or edges that need gripper or flat metal, in EACH. Never square feet. Type and color are next. Pick a catalog metal in Builder — this does not invent a price.',
       'number', 'metals_qty', false, true, 113,
       '{"note":true,"purpose":"ACCESSORY","knowledge_when":{"families":["carpet"],"require":{"key":"metals_needed","in":["Yes"]},"purpose":"ACCESSORY"},"show_if":{"key":"metals_needed","in":["Yes"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'metals_qty');

-- Metal type / color already exist from 0107 with no key.
update public.estimate_questions
   set key = 'metal_type',
       position = 114,
       help = 'Gripper (tack) or flat metal. Count is on the previous step — this is type only, not a second price.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"ACCESSORY"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"require":{"key":"metals_needed","in":["Yes"]},"purpose":"ACCESSORY"}'::jsonb
       )
 where (label = 'Metal type' and (key is null or key = '' or key = 'metal_type'));

update public.estimate_questions
   set key = 'metal_color',
       position = 115,
       help = 'Silver / titanium / gold as a crew note. Not a catalog SKU.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"ACCESSORY"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"require":{"key":"metals_needed","in":["Yes"]},"purpose":"ACCESSORY"}'::jsonb
       )
 where (label = 'Metal color' and (key is null or key = '' or key = 'metal_color'));

-- Site access = how the crew gets in (lockbox / homeowner / key). Distinct from
-- access_conditions (upper floor / elevator / long carry).
update public.estimate_questions
   set key = 'crew_entry',
       help = 'Lockbox, homeowner present, or key at the office. Scheduling note — not a price. Upper floor / elevator / long carry is the Access conditions question.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"SCHEDULING"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"SCHEDULING"}'::jsonb
       )
 where id = '53f852a3-dff5-4b24-b933-637cb31d8c18'
    or (label = 'Site access' and (key is null or key = '' or key = 'crew_entry'));

-- Occupancy / access / heavy furniture / climate: both paths. Climate is an
-- install-condition capture on every job; the acclimation warning still reads
-- hardwood / glue-down only and does not invent a day count.
update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"SCHEDULING"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"SCHEDULING"}'::jsonb
       )
 where key in ('occupancy', 'access_conditions');

update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"SCOPE"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"SCOPE"}'::jsonb
       )
 where key = 'furniture_heavy';

update public.estimate_questions
   set help = 'AC and heat on site. Hardwood and glue-down need both to acclimate or bond — the warning only fires then. Stretch-in and floating still capture it as an install condition, not a price.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{purpose}',
             '"INSTALLATION"'::jsonb
           ),
           '{knowledge_when}',
           '{"purpose":"INSTALLATION"}'::jsonb
         ),
         '{show_if}',
         '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
       )
 where key = 'climate_control'
    or id = '4f2ec418-e4bf-4019-bf99-65dbc5de025f';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0210_flooring_knowledge_metals_entry.sql

-- BEGIN 0211_flooring_knowledge_tack_lnft.sql
-- Floor King — flooring knowledge engine, pass 22.
-- Run in the Supabase SQL editor AFTER 0190–0210. Idempotent — safe to re-run.
--
-- Tack strip was keep / replace / TBD with no quantity. An estimator who
-- picks Replace still needs linear feet for purchasing — never square feet.
-- Field verify / keep existing / not needed do not invent a footage.
--
--   1. tack_strip_qty — number, ln ft, only after "Replace / new tack strip".
--      Notes only. Do not invent a linear-foot price; pick a catalog tack
--      strip in Builder if Floor King sells it.
--   2. Padding (carpet_pad) moves to 111 so the footage question sits next
--      to the condition chip (109 → 110).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0211_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set position = 111
 where key = 'carpet_pad'
    or id = 'c96e8386-c44e-4ca1-95b9-3c24d15c9437';

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0211a001-c0de-4000-8000-000000000001',
       'Carpet',
       'New tack strip — linear feet?',
       'Linear feet of new tack strip — never square feet. Leave blank or skip if you will measure on site. Pick a catalog tack-strip item in Builder rather than inventing a price here.',
       'number', 'tack_strip_qty', false, true, 110,
       '{"note":true,"purpose":"ACCESSORY","knowledge_when":{"families":["carpet"],"systems":["stretch_in"],"require":{"key":"tack_strip","in":["Replace / new tack strip"]},"purpose":"ACCESSORY"},"show_if":{"key":"tack_strip","in":["Replace / new tack strip"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'tack_strip_qty');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0211_flooring_knowledge_tack_lnft.sql

-- BEGIN 0212_flooring_knowledge_adhesive_qty.sql
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

-- original begin; absorbed into the single owner-bundle transaction

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

-- original commit; absorbed into the single owner-bundle transaction
-- END 0212_flooring_knowledge_adhesive_qty.sql

-- BEGIN 0213_flooring_knowledge_carpet_tile.sql
-- Floor King — flooring knowledge engine, pass 24.
-- Run in the Supabase SQL editor AFTER 0190–0212. Idempotent — safe to re-run.
--
-- Carpet tile is modular / boxed, not broadloom roll goods.
-- Catalog category stays `carpet` — do not invent a carpet-tile category.
--
-- Glue-down and stretch-in broadloom still need a cut list (area ≠ order).
-- Unanswered carpet_install stays optimistic: this step remains visible so
-- the salesperson can pick the product. Exclusive carpet tile keeps the
-- step for the SKU pick; the app hides the roll cut rows and orders from
-- measured area + waste. Carton count only when the product has coverage
-- — we do not invent a box size.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0213_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Live carpet cuts question (0108): null key, show_if project_type Carpet.
-- Give it a stable key so overlay/registry can find it. Keep show_if as
-- Carpet so unanswered still shows the product pick. Do not gate on
-- carpet_install — that would hide the SKU picker before the method is picked.
update public.estimate_questions
   set key = coalesce(nullif(btrim(key), ''), 'carpet_cuts'),
       help = 'Stretch-in and glue-down broadloom: cuts are the order quantity — converting room square feet into yards is not a cut plan. Carpet tile is modular: pick the product here; order is measured area plus waste. Carton count only if the product has coverage — do not invent a box size.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"project_type","in":["Carpet"]}'::jsonb
           ),
           '{purpose}',
           '"WAREHOUSE"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"purpose":"WAREHOUSE"}'::jsonb
       )
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0213_flooring_knowledge_carpet_tile.sql

-- BEGIN 0214_flooring_knowledge_carpet_tile_stairs.sql
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

-- original begin; absorbed into the single owner-bundle transaction

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

-- original commit; absorbed into the single owner-bundle transaction
-- END 0214_flooring_knowledge_carpet_tile_stairs.sql

-- BEGIN 0215_flooring_knowledge_cut_width.sql
-- Floor King — flooring knowledge engine, pass 26.
-- Run in the Supabase SQL editor AFTER 0190–0214. Idempotent — safe to re-run.
--
-- Roll-goods cuts: an empty width is not a 12-foot (carpet) or 6-foot
-- (sheet vinyl) roll. The salesperson must enter or chip a width, or the
-- catalog roll_width_ft may pre-fill the field. The app no longer silently
-- substitutes a family chip as the order quantity.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0215_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll — converting room square feet into yards is not a cut plan. Carpet tile hides this list and orders from measured area.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. Each piece needs a length AND a roll width (catalog width or a 6''/12'' chip). An empty width is not a 6-foot roll. Converting room square feet into yards is not a layout.'
 where key = 'vinyl_layout'
    or (kind = 'cuts' and config->>'category' = 'vinyl');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0215_flooring_knowledge_cut_width.sql

-- BEGIN 0216_flooring_knowledge_roll_tbd_sku.sql
-- Floor King — flooring knowledge engine, pass 27.
-- Run in the Supabase SQL editor AFTER 0190–0215. Idempotent — safe to re-run.
--
-- Roll-goods SKU without cuts: Builder still receives the product identity
-- with order TBD. Do not drop the pick, do not invent sq ft ÷ 9, and do not
-- invent a 12-foot (or 6-foot) warehouse cut from room dimensions.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0216_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll — converting room square feet into yards is not a cut plan. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile hides this list and orders from measured area.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. Each piece needs a length AND a roll width (catalog width or a 6''/12'' chip). An empty width is not a 6-foot roll. Converting room square feet into yards is not a layout. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered.'
 where key = 'vinyl_layout'
    or (kind = 'cuts' and config->>'category' = 'vinyl');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0216_flooring_knowledge_roll_tbd_sku.sql

-- BEGIN 0217_flooring_knowledge_hs_stair_units.sql
-- Floor King — flooring knowledge engine, pass 28.
-- Run in the Supabase SQL editor AFTER 0190–0216. Idempotent — safe to re-run.
--
-- Hard-surface stairs: step count is EACH/step. Stair noses, treads, and
-- risers stay on Trims. Do not invent 8 sq ft (tread+riser) or 4 sq ft
-- (tread only) of flooring as an order quantity. Wrap extra boxes in Builder
-- if the crew uses field plank. Stair labor is per step when a rate is
-- entered — legacy $/sq ft is not multiplied by 8.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0217_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Matching stairnose stays on Trims. Stair labor is $ per step when you enter a rate; do not invent one. Wrap extra boxes in Builder if you use field plank.'
 where kind = 'hs_stairs'
    or key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0217_flooring_knowledge_hs_stair_units.sql

-- BEGIN 0218_flooring_knowledge_tile_not_room_cut.sql
-- Floor King — flooring knowledge engine, pass 29.
-- Run in the Supabase SQL editor AFTER 0190–0217. Idempotent — safe to re-run.
--
-- Floor-map room L×W is measured area. Exclusive carpet tile is modular:
-- stuffing a 12'×14' room onto length_in/width_in is not a warehouse cut.
-- Broadloom order still comes from the cuts step. Staging/PO cut lists skip
-- lines marked not-a-roll (order_as_roll = false) unless real cut pieces exist.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0218_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile hides this list and orders from measured area; floor-map room sizes stay measured, not cuts.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0218_flooring_knowledge_tile_not_room_cut.sql

-- BEGIN 0219_flooring_knowledge_builder_tile_coverage.sql
-- Floor King — flooring knowledge engine, pass 30.
-- Run in the Supabase SQL editor AFTER 0190–0218. Idempotent — safe to re-run.
--
-- Exclusive carpet tile is modular coverage in Builder, not a warehouse cut
-- plan. Cuts vs Roll stays on broadloom / sheet vinyl. Carton math only when
-- product sqft_per_box exists — we do not invent a box size.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0219_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0219_flooring_knowledge_builder_tile_coverage.sql

-- BEGIN 0220_flooring_knowledge_install_rate.sql
-- Floor King — flooring knowledge engine, pass 31.
-- Run in the Supabase SQL editor AFTER 0190–0219. Idempotent — safe to re-run.
--
-- Install labor is the Settings rate on the floor-map / cuts question (or the
-- product's own labor rate). Application code must not invent $6/yd or $2/ft.
-- Copy the floor-map shop rate onto carpet cuts when that field is missing so
-- live 0087 values stay the source of truth. Sheet vinyl already carries its
-- own install_yd and is left alone.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0220_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions cuts
   set config = jsonb_set(
         coalesce(cuts.config, '{}'::jsonb),
         '{install_yd}',
         fm.install_yd
       )
  from (
    select config->'install_yd' as install_yd
      from public.estimate_questions
     where kind = 'floor_map'
       and config ? 'install_yd'
       and (config->>'install_yd') ~ '^[0-9]+([.][0-9]+)?$'
       and (config->>'install_yd')::numeric > 0
     order by position
     limit 1
  ) fm
 where cuts.kind = 'cuts'
   and coalesce(cuts.config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout'
   and (
         cuts.config->>'install_yd' is null
      or cuts.config->>'install_yd' = ''
   )
   and fm.install_yd is not null;

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0220_flooring_knowledge_install_rate.sql

-- BEGIN 0221_flooring_knowledge_trim_price.sql
-- Floor King — flooring knowledge engine, pass 32.
-- Run in the Supabase SQL editor AFTER 0190–0220. Idempotent — safe to re-run.
--
-- Trim chips name the accessory and its unit (lnft vs each). They do not plant
-- a hidden $1/lnft or $45/nose. Extra roll-goods products stay order TBD —
-- taped square feet is not a carpet order. R&R labor is typed, not $1.50.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0221_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Quarter round, shoe, and base are linear feet; stair noses, T-molds, and reducers are EACH — never square feet. Pick a catalog item or type a rate. Clicking a chip does not invent a price. Extra carpet/sheet on another step stays order TBD until cuts exist.'
 where coalesce(config->>'trim_list', '') = 'true';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0221_flooring_knowledge_trim_price.sql

-- BEGIN 0222_flooring_knowledge_roll_qty.sql
-- Floor King — flooring knowledge engine, pass 33.
-- Run in the Supabase SQL editor AFTER 0190–0221. Idempotent — safe to re-run.
--
-- Roll goods without warehouse cuts: measured square feet is not an order.
-- Pricing uses entered cuts or an explicit quantity override — never sq ft ÷ 9.
-- Exclusive carpet tile still bills from its quantity (modular coverage).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0222_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. These cuts are the order quantity — converting room square feet into yards is not a layout and is not billed as an order.'
 where kind = 'cuts'
   and config->>'category' = 'vinyl';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0222_flooring_knowledge_roll_qty.sql

-- BEGIN 0223_flooring_knowledge_piece_length.sql
-- Floor King — flooring knowledge engine, pass 34.
-- Run in the Supabase SQL editor AFTER 0190–0222. Idempotent — safe to re-run.
--
-- Trim sold by the piece converts a measured run into sticks only when the
-- product actually has piece_length_in. Missing length stays TBD — we do not
-- invent a 94" stick the way we do not invent carton coverage.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0223_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Quarter round, shoe, and base are linear feet; stair noses, T-molds, and reducers are EACH — never square feet. Pick a catalog item or type a rate. Clicking a chip does not invent a price. Linear feet convert to sticks only when the product has a piece length — we do not invent 94". Extra carpet/sheet on another step stays order TBD until cuts exist.'
 where coalesce(config->>'trim_list', '') = 'true';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0223_flooring_knowledge_piece_length.sql

-- BEGIN 0224_flooring_knowledge_billing_unit.sql
-- Floor King — flooring knowledge engine, pass 35.
-- Run in the Supabase SQL editor AFTER 0190–0223. Idempotent — safe to re-run.
--
-- Leftover measure_unit is not the billing unit. Catalog SY rates convert from
-- the printed line unit (sq yd vs sq ft), never a stray "sqft" on a yard line.
-- Boxed hard surface keeps MEASURED sqft and waste_pct — waste is not baked
-- into quantity with sqft wiped.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0224_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Enter rooms in feet and inches. Add a section for closets and offsets. This is MEASURED area — order quantity is calculated next from the product and (for carpet) the cuts. Leftover sq ft on a sq-yd line is not a billing unit and must not 9× a catalog SY rate.'
 where kind = 'areas';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0224_flooring_knowledge_billing_unit.sql

-- BEGIN 0225_flooring_knowledge_stair_allowance.sql
-- Floor King — flooring knowledge engine, pass 36.
-- Run in the Supabase SQL editor AFTER 0190–0224. Idempotent — safe to re-run.
--
-- Carpet stairs: step labor is EACH. We do not invent 6/8 sq ft of carpet per
-- step as an order — include stairs in the cut list. A Settings carpet_sqft
-- allowance is a shop reminder, not billed material.
-- Self-leveling labor in Builder does not plant $15/bag.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0225_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'How many steps, and waterfall vs upholstered. This is carpet stair labor per step — not a hard-surface stair-nose takeoff. Include stairs in your cuts. We do not invent 6/8 sq ft of carpet per step as an order.'
 where kind = 'stairs'
   and (key is null or key = '' or key = 'carpet_stairs');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0225_flooring_knowledge_stair_allowance.sql

-- BEGIN 0226_flooring_knowledge_selflevel_pour.sql
-- Floor King — flooring knowledge engine, pass 37.
-- Run in the Supabase SQL editor AFTER 0190–0225. Idempotent — safe to re-run.
--
-- Self-leveler pour thickness is the Settings default, else the coverage
-- reference. We do not invent 1/4". Count-unit emits never take taped sq ft
-- as gallons / bags / each.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0226_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Bags = area ÷ coverage at the chosen pour thickness. Pour is the Settings default, else the coverage reference. We do not invent 1/4 inch. Field verify / TBD does not add a bag count.'
 where kind = 'selflevel';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0226_flooring_knowledge_selflevel_pour.sql

-- BEGIN 0227_flooring_knowledge_subfloor_sheet.sql
-- Floor King — flooring knowledge engine, pass 38.
-- Run in the Supabase SQL editor AFTER 0190–0226. Idempotent — safe to re-run.
--
-- Subfloor sheets: round up from measured sq ft ÷ Settings sheet_sqft.
-- Missing sheet_sqft is TBD — we do not invent a 4×8 (32 sq ft) sheet.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0227_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Sheets = ceil(room sq ft ÷ Settings sheet coverage). Missing coverage is TBD — we do not invent a 4×8 (32 sq ft). Field verify / TBD does not add a sheet count. Priced per sheet, never as square feet of plywood.'
 where kind = 'subfloor';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0227_flooring_knowledge_subfloor_sheet.sql

-- BEGIN 0228_flooring_knowledge_order_cut_width.sql
-- Floor King — flooring knowledge engine, pass 39.
-- Run in the Supabase SQL editor AFTER 0190–0227. Idempotent — safe to re-run.
--
-- Customer / portal orders: an empty cut width is not a 12' roll, and a
-- missing unit is not square yards. Warehouse cut labels stay TBD until a
-- real width is entered. Existing rows are not rewritten.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0228_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

alter table public.order_items
  alter column unit set default '';

comment on column public.order_items.unit is
  'Billing unit from the catalog or the customer. Empty is TBD — never invent sq yd.';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0228_flooring_knowledge_order_cut_width.sql

-- BEGIN 0229_flooring_knowledge_tile_bags.sql
-- Floor King — flooring knowledge engine, pass 40.
-- Run in the Supabase SQL editor AFTER 0190–0228. Idempotent — safe to re-run.
--
-- Tile setting materials are catalog bags, not taped square feet. Thinset /
-- grout stay TBD until a product with coverage is picked. Customer order
-- catalog rows keep their real unit — missing unit is empty, not sq yd.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0229_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Thinset, grout, and backer come from the catalog in Builder. This records the need. Bag counts stay TBD unless a product with coverage is picked. Taped square feet is not bags of thinset.'
 where key = 'tile_setting';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0229_flooring_knowledge_tile_bags.sql

-- BEGIN 0230_flooring_knowledge_count_qty.sql
-- Floor King — flooring knowledge engine, pass 41.
-- Run in the Supabase SQL editor AFTER 0190–0229. Idempotent — safe to re-run.
--
-- Count units (each / bag / lnft / sheet) do not invent a quantity of 1 when
-- Builder switches Price per off area, when a count SKU is picked onto an
-- area line, or when a subfloor sheet line is added. Transitions stay EACH —
-- taped square feet is not one T-mold. Warehouse roll receive does not invent
-- square yards when the product unit is missing (Unit TBD until picked).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0230_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'T-mold, reducer, end cap, threshold, or metal — EACH, never square feet. Pick the types here, then add matching catalog pieces on Trims and type the count. Do not invent a SKU, a price, or a quantity of 1 from room square footage. Field verify is allowed.'
 where key = 'hs_transitions';

update public.estimate_questions
   set help = 'Count of doorways or edges that need gripper or flat metal, in EACH. Never square feet. Type the number — we do not invent 1. Type and color are next. Pick a catalog metal in Builder — this does not invent a price.'
 where key = 'metals_qty';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0230_flooring_knowledge_count_qty.sql

-- BEGIN 0231_flooring_knowledge_cut_width_init.sql
-- Floor King — flooring knowledge engine, pass 42.
-- Run in the Supabase SQL editor AFTER 0190–0230. Idempotent — safe to re-run.
--
-- Opening a carpet or sheet-vinyl cut list does not plant 12' (carpet) or
-- 6' (vinyl) as the first cut width. Catalog roll_width_ft may fill the
-- field. 12'/15' and 6'/12' chips remain one tap. An empty width is still
-- not a roll — emit already refuses to substitute a family chip.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0231_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width. Catalog roll_width_ft may fill the field; 12''/15'' chips are one tap. Opening this question does not plant 12''. An empty width is not a 12-foot roll — converting room square feet into yards is not a cut plan. Carpet tile hides this list and orders from measured area.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. Each piece needs a length AND a roll width. Catalog roll_width_ft may fill the field; 6''/12'' chips are one tap. Opening this question does not plant 6''. An empty width is not a 6-foot roll. Converting room square feet into yards is not a layout.'
 where key = 'vinyl_layout'
    or (kind = 'cuts' and config->>'category' = 'vinyl');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0231_flooring_knowledge_cut_width_init.sql

-- BEGIN 0232_flooring_knowledge_each_qty.sql
-- Floor King — flooring knowledge engine, pass 43.
-- Run in the Supabase SQL editor AFTER 0190–0231. Idempotent — safe to re-run.
--
-- Yes/No (or choice) emits billed EACH / LN FT without a typed Amount do not
-- invent a quantity of 1. Number questions still pass the count. Flat job
-- charges (delivery, furniture moving, curb) stay one charge. Unknown product
-- units on TBD lines are unit TBD, not invented "each".
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0232_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Count of toilets to pull and reset, in EACH. Type the number — a Yes is not 1 toilet. Field verify if you have not seen the bath yet.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'Doors to shave / undercut, in EACH. Type the number — we do not invent 1 door from a Yes. Skip or Field verify if unknown.'
 where key = 'doors_shave';

update public.estimate_questions
   set help = 'T-mold, reducer, end cap, threshold, or metal — EACH, never square feet. Pick the types here, then add matching catalog pieces on Trims and type the count. A type chip is not a quantity of 1. Do not invent a SKU or price. Field verify is allowed.'
 where key = 'hs_transitions';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0232_flooring_knowledge_each_qty.sql

-- BEGIN 0233_flooring_knowledge_unit_tbd.sql
-- Floor King — flooring knowledge engine, pass 44.
-- Run in the Supabase SQL editor AFTER 0190–0232. Idempotent — safe to re-run.
--
-- Missing unit metadata is unit TBD, not invented "each". Questionnaire
-- emits, Builder add-ons, catalog snapshots, stock POs, and customer-order
-- invoices keep an empty unit until a real unit is known.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0233_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Count of toilets to pull and reset, in EACH. Type the number and keep the unit as each. A Yes is not 1 toilet. Missing unit is TBD, not a guessed each. Field verify if you have not seen the bath yet.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'Doors to shave / undercut, in EACH. Type the number. We do not invent 1 door from a Yes, and we do not label an unknown unit as each.'
 where key = 'doors_shave';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0233_flooring_knowledge_unit_tbd.sql

-- BEGIN 0234_flooring_knowledge_review_units.sql
-- Floor King — flooring knowledge engine, pass 45.
-- Run in the Supabase SQL editor AFTER 0190–0233. Idempotent — safe to re-run.
--
-- Guided Review always lists MEASURED area, WASTE, ORDER quantity, BILLING
-- quantity, and UNIT of measure as separate facts. Taped sq ft is never a
-- yard order. Hard-surface sq-ft jobs still show billing + unit so 550 sq ft
-- cannot be read as yards. Carton counts appear only when coverage exists.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0234_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Enter rooms in feet and inches. Add a section for closets and offsets. This is MEASURED area. Review lists WASTE, ORDER quantity, BILLING quantity, and UNIT of measure separately. sq ft ÷ 9 is equivalent area, not a carpet order. Carton counts appear only when the product has coverage on file.'
 where kind = 'areas';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0234_flooring_knowledge_review_units.sql

-- BEGIN 0235_flooring_knowledge_product_unit.sql
-- Floor King — flooring knowledge engine, pass 46.
-- Run in the Supabase SQL editor AFTER 0190–0234. Idempotent — safe to re-run.
--
-- Picking a catalog SKU that forgot its unit does not plant sq ft. Carpet and
-- sheet vinyl still default to sq yd; boxed hard surface still defaults to
-- sq ft. Adhesive / trim / pad / other stay unit TBD until a real unit is
-- known — taped square feet is not a glue order.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0235_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Adhesive product. Quantity is gallons or kits from the catalog unit — never the room''s taped square feet. A SKU that forgot its unit is TBD; we do not plant sq ft on a pail of glue.'
 where key = 'adhesive';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0235_flooring_knowledge_product_unit.sql

-- BEGIN 0236_flooring_knowledge_other_unit.sql
-- Floor King — flooring knowledge engine, pass 47.
-- Run in the Supabase SQL editor AFTER 0190–0235. Idempotent — safe to re-run.
--
-- Adding an Other / adhesive product does not plant sq ft as the sold-by unit.
-- Floor-map "fill empty rooms" uses the job's flooring family, not a default LVP.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0236_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Fill-empty uses this job''s flooring family — it does not plant LVP on a carpet job. Sold-by for Other / adhesive is TBD until you pick a unit; we do not plant sq ft on a pail of glue.'
 where kind = 'floor_map';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0236_flooring_knowledge_other_unit.sql

-- BEGIN 0237_flooring_knowledge_stair_wrap.sql
-- Floor King — flooring knowledge engine, pass 48.
-- Run in the Supabase SQL editor AFTER 0190–0236. Idempotent — safe to re-run.
--
-- Hard-surface stair wrap product picker uses this job's flooring family.
-- Hardwood stairs do not plant LVP. Mixed jobs leave category TBD instead of
-- guessing LVP. The add-product form does the same when no category is given.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0237_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Hard-surface stairs. Count the steps. Wrap product follows this job''s flooring family — hardwood does not plant LVP. Mixed jobs leave the category TBD. Noses / treads / risers fill on Trims in EACH. Wrap qty is not an automatic sq ft/step order.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0237_flooring_knowledge_stair_wrap.sql

-- BEGIN 0238_flooring_knowledge_mixed_takeoff.sql
-- Floor King — flooring knowledge engine, pass 49.
-- Run in the Supabase SQL editor AFTER 0190–0237. Idempotent — safe to re-run.
--
-- Mixed jobs do not clone whole-job taped sq ft onto every family. Carpet
-- rooms keep carpet measured area; LVP rooms keep LVP. Unassigned mixed
-- takeoffs stay empty rather than inventing 500 sq ft of both.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0238_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Fill-empty uses this job''s flooring family. Sold-by for Other / adhesive is TBD until you pick a unit.'
 where kind = 'floor_map';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0238_flooring_knowledge_mixed_takeoff.sql

-- BEGIN 0239_flooring_knowledge_mixed_emit.sql
-- Floor King — flooring knowledge engine, pass 50.
-- Run in the Supabase SQL editor AFTER 0190–0238. Idempotent — safe to re-run.
--
-- Builder emit, pad, self-leveler bags, subfloor sheets, and the running
-- takeoff strip use the same per-family measured area as Review. Mixed
-- carpet + LVP jobs do not clone whole-job taped sq ft onto every material.
-- Unassigned mixed takeoffs stay empty rather than inventing 500 sq ft of both.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0239_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Builder lines, pad, self-leveler, and subfloor follow those rooms. Fill-empty uses this job''s flooring family. Sold-by for Other / adhesive is TBD until you pick a unit.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Quantity follows CARPET rooms only — mixed jobs do not buy pad for the LVP. Glue-down and carpet tile hide this step.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Self-leveler bags follow hard-surface rooms on a mixed job. Carpet rooms are not poured. Field verify / TBD does not invent a bag count. Coverage and pour thickness come from Settings — we do not invent 1/4".'
 where kind = 'selflevel';

update public.estimate_questions
   set help = 'Subfloor sheets follow hard-surface rooms on a mixed job. Carpet rooms are not sheeted. Field verify / TBD does not invent a sheet count. Missing sheet coverage is not a 4×8.'
 where kind = 'subfloor';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0239_flooring_knowledge_mixed_emit.sql

-- BEGIN 0240_flooring_knowledge_prep_area.sql
-- Floor King — flooring knowledge engine, pass 51.
-- Run in the Supabase SQL editor AFTER 0190–0239. Idempotent — safe to re-run.
--
-- Area-based prep labor (self-level / skim / moisture) follows hard-surface
-- rooms on a mixed job — the same split as self-leveler bags. Demo / haul
-- stay whole-job: the old floor is not the new family.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0240_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor prep for this job. Self-level / skim / grind labor follows hard-surface rooms on a mixed carpet + LVP job — not the carpet. Field verify / TBD is allowed. Bag count is a separate step when Self-leveling is picked.'
 where key = 'hs_prep';

update public.estimate_questions
   set help = 'Moisture mitigation (Aqua bar / primer) follows hard-surface rooms on a mixed job. Carpet rooms are not treated. Field verify allowed — do not invent a roll count.'
 where key = 'moisture_mitigation';

update public.estimate_questions
   set help = 'Sheet vinyl skim / embossing. Quantity follows sheet-vinyl rooms only on a mixed job. Field verify / TBD does not invent a bag count.'
 where key = 'vinyl_skim';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0240_flooring_knowledge_prep_area.sql

-- BEGIN 0241_flooring_knowledge_room_prep.sql
-- Floor King — flooring knowledge engine, pass 52.
-- Run in the Supabase SQL editor AFTER 0190–0240. Idempotent — safe to re-run.
--
-- Per-room prep is this room's measured sq ft — not the whole mixed job.
-- Kitchen 200 sq ft of LVP is not 550 sq ft of self-level on the carpet too.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0241_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Same prep for the whole job, or set it by room on the rooms step. By-room uses each room''s measured sq ft — a mixed carpet + LVP job does not clone whole-job area onto every room.'
 where key = 'prep_scope';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0241_flooring_knowledge_room_prep.sql

-- BEGIN 0242_flooring_knowledge_mixed_unassigned.sql
-- Floor King — flooring knowledge engine, pass 53.
-- Run in the Supabase SQL editor AFTER 0190–0241. Idempotent — safe to re-run.
--
-- Mixed carpet + LVP (or any 2+ families) with measured rooms but no floor-map
-- assignment used to silently takeoff 0. Review now warns: assign each room
-- to a product — mixed jobs do not clone whole-job sq ft onto every family.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0242_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms.'
 where kind = 'floor_map';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0242_flooring_knowledge_mixed_unassigned.sql

-- BEGIN 0243_flooring_knowledge_adhesive_qty_ui.sql
-- Floor King — flooring knowledge engine, pass 54.
-- Run in the Supabase SQL editor AFTER 0190–0242. Idempotent — safe to re-run.
--
-- Adhesive / other / labor / trim lines with no sold-by unit are COUNT in
-- Builder (How many / Unit TBD), not the Sq ft field. Taped square feet is
-- still not a glue order. Do not invent gallons or coverage.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0243_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. Do not invent coverage.'
 where key = 'adhesive';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0243_flooring_knowledge_adhesive_qty_ui.sql

-- BEGIN 0244_flooring_knowledge_pad_count_ui.sql
-- Floor King — flooring knowledge engine, pass 55.
-- Run in the Supabase SQL editor AFTER 0190–0243. Idempotent — safe to re-run.
--
-- Pad / underlayment with no sold-by unit is COUNT in Builder (How many /
-- Unit TBD), not the Sq ft field. Pricing uses the same count-vs-area rule
-- as display (`isCountPricedLine`) so leftover measure_unit sqft cannot
-- turn a TBD pad or toilet into square feet.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0244_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Quantity follows CARPET rooms only — mixed jobs do not buy pad for the LVP. Glue-down and carpet tile hide this step. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet.'
 where key = 'carpet_pad';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0244_flooring_knowledge_pad_count_ui.sql

-- BEGIN 0245_flooring_knowledge_hardwood_finish.sql
-- Floor King — flooring knowledge engine, pass 56.
-- Run in the Supabase SQL editor AFTER 0190–0244. Idempotent — safe to re-run.
--
-- Hardwood prefinished vs unfinished (site finish) is SCOPE, not a price.
-- Catalog has no sand/finish labor — do not invent one. Overlay families
-- hardwood so laminate / LVP hide this once the surface is known.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0245_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0245a001-c0de-4000-8000-000000000001',
       'Hard surface',
       'Prefinished or unfinished?',
       'Prefinished vs unfinished (site finish) changes sanding, finishing, and acclimation notes. Floor King has no sand/finish labor in the catalog — capture it as scope. Field verify if the SKU is not in front of you. Do not invent a sand-and-finish dollar amount.',
       'choice', 'hardwood_finish', false, true, 211,
       '{"note":true,"multi":false,"purpose":"SCOPE","knowledge_when":{"families":["hardwood"],"purpose":"SCOPE"},"show_if":{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},"options":[{"label":"Prefinished"},{"label":"Unfinished (site finish)"},{"label":"Unknown"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'hardwood_finish');

update public.estimate_questions
   set help = 'Prefinished vs unfinished (site finish) changes sanding, finishing, and acclimation notes. Floor King has no sand/finish labor in the catalog — capture it as scope. Field verify if the SKU is not in front of you. Do not invent a sand-and-finish dollar amount.',
       config = coalesce(config, '{}'::jsonb)
         || '{"note":true,"purpose":"SCOPE","knowledge_when":{"families":["hardwood"],"purpose":"SCOPE"},"show_if":{"key":"surface_type","in":["Hardwood","Engineered hardwood"]}}'::jsonb
 where key = 'hardwood_finish';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0245_flooring_knowledge_hardwood_finish.sql

-- BEGIN 0246_flooring_knowledge_stair_wrap_qty.sql
-- Floor King — flooring knowledge engine, pass 57.
-- Run in the Supabase SQL editor AFTER 0190–0245. Idempotent — safe to re-run.
--
-- Hard-surface stair wrap is extra boxes / EACH, never taped square feet.
-- Questionnaire emit strips an area sold-by unit so typing 13×8 sq ft in
-- Builder cannot reopen the invented 8 sq ft/step order. Pricing keys off
-- "wrap qty TBD" and bills quantity only.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0246_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Wrap extra boxes are How many / Unit TBD in Builder (wrap qty TBD), never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0246_flooring_knowledge_stair_wrap_qty.sql

-- BEGIN 0247_flooring_knowledge_work_type.sql
-- Floor King — flooring knowledge engine, pass 58.
-- Run in the Supabase SQL editor AFTER 0190–0246. Idempotent — safe to re-run.
--
-- New construction vs replacement. Positive "New construction" hides tear-out
-- (demo, existing pad, bond, asbestos, disposal). Unanswered keeps demo
-- visible. Substrate and prep still apply. Does not invent a demo charge.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0247_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0247a001-c0de-4000-8000-000000000001',
       'Demo & disposal',
       'New construction or replacement?',
       'Replacement asks what is coming up. New construction hides tear-out, pad removal, asbestos, and disposal — substrate and prep still apply. Unknown / field verify keeps demo visible. Do not invent a demo charge on a new slab.',
       'choice', 'work_type', false, true, 268,
       '{"note":true,"multi":false,"purpose":"SCOPE","knowledge_when":{"purpose":"SCOPE"},"show_if":{"key":"project_type","in":["Carpet","Hard surface"]},"options":[{"label":"Replacement (tear-out)"},{"label":"New construction"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'work_type');

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, asbestos, and disposal — substrate and prep still apply. Unknown / field verify keeps demo visible. Do not invent a demo charge on a new slab.',
       section = 'Demo & disposal',
       position = 268,
       config = coalesce(config, '{}'::jsonb)
         || '{"note":true,"purpose":"SCOPE","knowledge_when":{"purpose":"SCOPE"},"show_if":{"key":"project_type","in":["Carpet","Hard surface"]}}'::jsonb
 where key = 'work_type';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0247_flooring_knowledge_work_type.sql

-- BEGIN 0248_flooring_knowledge_wet_area.sql
-- Floor King — flooring knowledge engine, pass 59.
-- Run in the Supabase SQL editor AFTER 0190–0247. Idempotent — safe to re-run.
--
-- Wet area (bath / laundry / mudroom) is SCOPE/WARNING. Catalog has no
-- waterproof column — confirm the product, do not invent a SKU or a ban.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0248_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0248a001-c0de-4000-8000-000000000001',
       'Site',
       'Any wet areas (bath, laundry, mudroom)?',
       'Bath, laundry, or mudroom. Confirm the selected product is rated for a wet area. Catalog has no waterproof column — do not invent a SKU or a ban. Field verify if you have not seen the space.',
       'choice', 'wet_area', false, true, 254,
       '{"note":true,"multi":false,"purpose":"WARNING","knowledge_when":{"purpose":"WARNING"},"show_if":{"key":"project_type","in":["Carpet","Hard surface"]},"options":[{"label":"Yes — bath / laundry / mudroom"},{"label":"Some rooms"},{"label":"No"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'wet_area');

update public.estimate_questions
   set help = 'Bath, laundry, or mudroom. Confirm the selected product is rated for a wet area. Catalog has no waterproof column — do not invent a SKU or a ban. Field verify if you have not seen the space.',
       config = coalesce(config, '{}'::jsonb)
         || '{"note":true,"purpose":"WARNING","knowledge_when":{"purpose":"WARNING"},"show_if":{"key":"project_type","in":["Carpet","Hard surface"]}}'::jsonb
 where key = 'wet_area';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0248_flooring_knowledge_wet_area.sql

-- BEGIN 0249_flooring_knowledge_builder_measured.sql
-- Floor King — flooring knowledge engine, pass 60.
-- Run in the Supabase SQL editor AFTER 0190–0248. Idempotent — safe to re-run.
--
-- Builder roll goods without warehouse cuts: leftover sq ft is MEASURED
-- area, not the order. Label it "Measured sq ft (not the order)". Sq ft ÷ 9
-- is equivalent area, not a cut plan. Hard-surface boxed lines may still
-- enter sq ft directly as the order. Do not invent a 12-foot width.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0249_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Builder labels leftover sq ft as measured area, not the order — Sq ft ÷ 9 is equivalent area. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. These cuts are the order quantity — converting room square feet into yards is not a layout and is not billed as an order. Builder labels leftover sq ft as measured area, not the order — Sq ft ÷ 9 is equivalent area. Width starts empty unless the catalog has roll_width_ft. 6''/12'' chips are one tap — we do not plant 6''.'
 where kind = 'cuts'
   and (config->>'category' = 'vinyl' or key = 'vinyl_layout');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0249_flooring_knowledge_builder_measured.sql

-- BEGIN 0250_flooring_knowledge_existing_pad.sql
-- Floor King — flooring knowledge engine, pass 61.
-- Run in the Supabase SQL editor AFTER 0190–0249. Idempotent — safe to re-run.
--
-- Existing pad follows EXISTING carpet, not only a new-carpet job.
-- Tearing carpet out for LVP / hardwood / laminate / tile / sheet vinyl still
-- asks pad remove vs reuse. Sit after hs_demo so the follow-up is not behind
-- the salesperson (0142). Overlay any: installing carpet OR hs_demo Carpet.
-- Unanswered demo does not hide a carpet install. New construction still
-- hides tear-out. Do not invent a second demo rate.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0250_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set position = 271,
       help = 'Tearing out carpet — to carpet or to hard surface — usually takes the pad with it. Reuse only when the salesperson explicitly allows it. This follows the existing floor, not only a new-carpet job. Do not invent a second demo rate; the tear-out line gets a pad note.',
       config = coalesce(config, '{}'::jsonb)
         || '{"note":true,"purpose":"LABOR","knowledge_when":{"any":[{"families":["carpet"]},{"demo":["Carpet"]}],"purpose":"LABOR"},"show_if":{"any":[{"key":"project_type","in":["Carpet"]},{"key":"hs_demo","in":["Carpet"]}]}}'::jsonb
 where key = 'existing_pad';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0250_flooring_knowledge_existing_pad.sql

-- BEGIN 0251_flooring_knowledge_cuts_panel.sql
-- Floor King — flooring knowledge engine, pass 62.
-- Run in the Supabase SQL editor AFTER 0190–0250. Idempotent — safe to re-run.
--
-- Builder warehouse-cuts panel is the ORDER, not taped room square feet.
-- Empty cuts show "Order TBD — not measured sq ft" instead of "0 sq ft".
-- Hard-surface boxed measurements stay measured sq ft. Do not plant 12'.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0251_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. These cuts are the order quantity — converting room square feet into yards is not a layout and is not billed as an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. Width starts empty unless the catalog has roll_width_ft. 6''/12'' chips are one tap — we do not plant 6''.'
 where kind = 'cuts'
   and (config->>'category' = 'vinyl' or key = 'vinyl_layout');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0251_flooring_knowledge_cuts_panel.sql

-- BEGIN 0252_flooring_knowledge_cuts_tbd.sql
-- Floor King — flooring knowledge engine, pass 63.
-- Run in the Supabase SQL editor AFTER 0190–0251. Idempotent — safe to re-run.
--
-- Guided Estimate cut totals: empty width × length is Order TBD, not 0 sq yd.
-- Measured room square feet ÷ 9 is not an order. Do not plant 12'.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0252_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. These cuts are the order quantity — converting room square feet into yards is not a layout and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. Width starts empty unless the catalog has roll_width_ft. 6''/12'' chips are one tap — we do not plant 6''.'
 where kind = 'cuts'
   and (config->>'category' = 'vinyl' or key = 'vinyl_layout');

-- original commit; absorbed into the single owner-bundle transaction
-- END 0252_flooring_knowledge_cuts_tbd.sql

-- BEGIN 0253_flooring_knowledge_existing_tack.sql
-- Floor King — flooring knowledge engine, pass 64.
-- Run in the Supabase SQL editor AFTER 0190–0252. Idempotent — safe to re-run.
--
-- Existing tack strip follows EXISTING carpet, not only new stretch-in.
-- Tearing carpet out for LVP / hardwood / laminate / tile / sheet vinyl still
-- asks remove vs keep. New stretch-in tack_strip stays on the install step.
-- Sit after existing_pad so the follow-up is not behind the salesperson (0142).
-- Overlay any: installing carpet OR hs_demo Carpet. Do not invent lnft.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0253_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0253a001-c0de-4000-8000-000000000001',
       'Site',
       'Existing tack strip?',
       'Tearing out carpet usually takes tack strip with it. Keep is unusual. This is not new stretch-in tack strip — that stays on the install step. Linear feet stay off until you add a catalog item. Do not invent a linear-foot price.',
       'choice', 'existing_tack', false, true, 272,
       '{"note":true,"multi":false,"purpose":"LABOR","knowledge_when":{"any":[{"families":["carpet"]},{"demo":["Carpet"]}],"purpose":"LABOR"},"show_if":{"any":[{"key":"project_type","in":["Carpet"]},{"key":"hs_demo","in":["Carpet"]}]},"options":[{"label":"Remove with old carpet"},{"label":"Keep (unusual)"},{"label":"No tack strip / unknown"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'existing_tack');

update public.estimate_questions
   set position = 272,
       help = 'Tearing out carpet usually takes tack strip with it. Keep is unusual. This is not new stretch-in tack strip — that stays on the install step. Linear feet stay off until you add a catalog item. Do not invent a linear-foot price.',
       config = coalesce(config, '{}'::jsonb)
         || '{"note":true,"purpose":"LABOR","knowledge_when":{"any":[{"families":["carpet"]},{"demo":["Carpet"]}],"purpose":"LABOR"},"show_if":{"any":[{"key":"project_type","in":["Carpet"]},{"key":"hs_demo","in":["Carpet"]}]}}'::jsonb
 where key = 'existing_tack';

-- Keep glued-vs-floating after pad + tack so LVP demo follow-ups are not behind.
update public.estimate_questions
   set position = 273
 where key = 'existing_bond'
   and position <= 272;

-- original commit; absorbed into the single owner-bundle transaction
-- END 0253_flooring_knowledge_existing_tack.sql

-- BEGIN 0254_flooring_knowledge_wall_tile.sql
-- Floor King — flooring knowledge engine, pass 65.
-- Run in the Supabase SQL editor AFTER 0190–0253. Idempotent — safe to re-run.
--
-- Exclusive wall tile hides floor-only follow-ups (toilets, vents, door
-- shaves, floor stairs, construction grade, radiant heat) in the overlay.
-- Unanswered / Unknown stay open. Mixed carpet or LVP + wall tile still
-- asks those questions. Do NOT SQL-gate toilets on tile_application (0142).
-- Wet area, appliances, floor prep, and setting materials stay.
-- Do not invent wall-tile labor.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0254_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, and radiant heat — those are floor work. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0254_flooring_knowledge_wall_tile.sql

-- BEGIN 0255_flooring_knowledge_wall_floor.sql
-- Floor King — flooring knowledge engine, pass 66.
-- Run in the Supabase SQL editor AFTER 0190–0254. Idempotent — safe to re-run.
--
-- Exclusive wall tile also hides floor doorway T-molds, 4×8 subfloor sheets,
-- self-leveler bags, slab vapor barrier, and aqua-bar mitigation. Unanswered
-- / Unknown stay open. Mixed carpet or LVP + wall tile still asks them.
-- Wet area, appliances, floor prep, substrate, base trim, and setting
-- materials stay. Do NOT SQL-gate these on tile_application (0142).
-- Do not invent wall-tile labor.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0255_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, and aqua-bar mitigation — those are floor work. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0255_flooring_knowledge_wall_floor.sql

-- BEGIN 0256_flooring_knowledge_vacant_furniture.sql
-- Floor King — flooring knowledge engine, pass 67.
-- Run in the Supabase SQL editor AFTER 0190–0255. Idempotent — safe to re-run.
--
-- Vacant occupancy hides furniture moving (light/medium/heavy and specialty
-- items). Empty house — do not invent a furniture charge. Occupied and
-- Unknown still ask. Unanswered stays open. Do NOT SQL-gate furniture on occupancy
-- (0142 — unanswered occupancy must not hide furniture).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0256_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Occupied vs vacant. Vacant hides furniture moving — empty house, do not invent a furniture charge. Occupied and Unknown still ask light/medium/heavy. Unanswered stays open.'
 where key = 'occupancy';

update public.estimate_questions
   set help = 'Light / medium / heavy uses Floor King''s furniture-moving labor. Vacant jobs hide this. Specialty items (piano, pool table) stay on the next question as scope.'
 where key = 'furniture_level';

update public.estimate_questions
   set help = 'Pianos, pool tables, loaded china cabinets. Captured as scope unless a furniture-moving line (light/medium/heavy) is already on this job. Vacant jobs hide this. Do not invent a second charge here.'
 where key = 'furniture_heavy';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0256_flooring_knowledge_vacant_furniture.sql

-- BEGIN 0257_flooring_knowledge_new_build_skim.sql
-- Floor King — flooring knowledge engine, pass 68.
-- Run in the Supabase SQL editor AFTER 0190–0256. Idempotent — safe to re-run.
--
-- New construction hides existing-vinyl skim. There is no existing vinyl to
-- skim. Replacement and unanswered still ask. Do NOT SQL-gate vinyl_skim on work_type
-- (0142 — unanswered new-vs-replacement must not hide skim).
-- Substrate and floor prep still apply. Do not invent a bag count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0257_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, and disposal — substrate and prep still apply. Unknown / field verify keeps demo visible. Do not invent a demo charge on a new slab.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Embossed existing vinyl often needs a skim coat. New construction hides this — there is no existing vinyl. If you cannot see it until demo, pick Field verify — do not invent a bag count here.'
 where key = 'vinyl_skim';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0257_flooring_knowledge_new_build_skim.sql

-- BEGIN 0258_flooring_knowledge_new_build_toilets.sql
-- Floor King — flooring knowledge engine, pass 69.
-- Run in the Supabase SQL editor AFTER 0190–0257. Idempotent — safe to re-run.
--
-- New construction hides toilet pull & reset. There is no existing toilet to
-- pull. Replacement and unanswered still ask. Appliances and door shaves stay.
-- Do NOT SQL-gate toilets on work_type (0142 — unanswered new-vs-replacement
-- must not hide toilets). Do not invent a toilet count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0258_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, and toilet pull/reset — substrate, prep, appliances, and door shaves still apply. Unknown / field verify keeps demo visible. Do not invent a demo charge on a new slab.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count of toilets to pull and reset, in EACH. Type the number and keep the unit as each. A Yes is not 1 toilet. New construction hides this — there is no toilet to pull. Missing unit is TBD, not a guessed each. Field verify if you have not seen the bath yet.'
 where key = 'toilets';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0258_flooring_knowledge_new_build_toilets.sql

-- BEGIN 0259_flooring_knowledge_climate_sot.sql
-- Floor King — flooring knowledge engine, pass 70.
-- Run in the Supabase SQL editor AFTER 0190–0258. Idempotent — safe to re-run.
--
-- Climate, radiant, and moisture-untested warnings live on the overlay
-- (knowledgeWarnings), not a second questionnaire list. New-construction
-- warning also names toilet pull/reset (0258). Stretch-in still captures
-- climate as an install condition. Legacy AC/heat yes-no answers still count.
-- Do NOT SQL-gate climate on install_method (0142 — unanswered hardwood/glue
-- must still ask climate). Do not invent an acclimation day count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0259_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, and toilet pull/reset — substrate, prep, appliances, and door shaves still apply. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down, from the overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Legacy AC/heat yes-no answers still count.'
 where key = 'climate_control';

update public.estimate_questions
   set help = 'Carpet pad and many hard-surface products have radiant limits. Yes fires the overlay purchasing warning — do not invent a radiant-rated SKU.'
 where key = 'radiant_heat';

update public.estimate_questions
   set help = 'Glue-down, hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not.'
 where key = 'moisture_test';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0259_flooring_knowledge_climate_sot.sql

-- BEGIN 0260_flooring_knowledge_wall_moisture.sql
-- Floor King — flooring knowledge engine, pass 71.
-- Run in the Supabase SQL editor AFTER 0190–0259. Idempotent — safe to re-run.
--
-- Exclusive wall tile hides slab moisture tests. Aqua-bar mitigation is
-- already hidden (0255); asking whether the slab was tested while hiding the
-- mitigation is floor work on a wall job. Wet area, appliances, floor prep,
-- substrate, and setting materials stay. Mixed carpet or LVP + wall tile
-- still asks the slab test. Unanswered and Unknown stay open.
-- Do NOT SQL-gate moisture_test on tile_application (0142 — unanswered floor
-- vs wall must not hide a hardwood/glue moisture test, and mixed jobs must
-- still ask). Do not invent a moisture reading.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0260_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, and slab moisture tests — those are floor work. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Glue-down, hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Wet area still asks.'
 where key = 'moisture_test';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0260_flooring_knowledge_wall_moisture.sql

-- BEGIN 0261_flooring_knowledge_wall_prep.sql
-- Floor King — flooring knowledge engine, pass 72.
-- Run in the Supabase SQL editor AFTER 0190–0260. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asks Floor prep (showers skim). Self-leveling and
-- grinding chips are floor pours — hide them on wall-only jobs so a new
-- salesperson cannot emit self-level labor on a backsplash. Patch / skim and
-- None stay. Mixed LVP + wall tile still shows the floor pours. Unanswered
-- and Unknown stay open.
-- Do NOT SQL-gate hs_prep on tile_application (0142 — unanswered floor vs wall
-- must still offer Self-leveling). Do not invent a bag count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0261_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, and slab moisture tests — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'None / patch / skim / self-level / grind. Exclusive wall tile hides Self-leveling and grinding chips — those pour or grind a floor. Patch / skim stays for showers. Mixed LVP + wall tile still shows the floor pours. Do not invent a bag count here; bags are the next step when Self-leveling is picked.'
 where key = 'hs_prep';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0261_flooring_knowledge_wall_prep.sql

-- BEGIN 0262_flooring_knowledge_carpet_tile_layout.sql
-- Floor King — flooring knowledge engine, pass 73.
-- Run in the Supabase SQL editor AFTER 0190–0261. Idempotent — safe to re-run.
--
-- Exclusive carpet tile is modular / boxed, not a roll cut plan. Pattern match,
-- inches of repeat, and seam/direction notes are broadloom layout. Hide them
-- once carpet_install is exclusively Carpet tile so a new salesperson is not
-- asked for a seam plan that does not exist. Stretch-in and glue-down keep
-- them. Mixed stretch-in + tile still asks them. Unanswered stays open.
-- Do NOT SQL-gate pattern_match on carpet_install (0142 — unanswered method must still ask roll layout).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0262_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Do not invent a box size.'
 where key = 'carpet_install';

update public.estimate_questions
   set help = 'Pattern match and roll direction are for broadloom. Exclusive carpet tile hides this — modular tiles are not a seam plan. Stretch-in and glue-down keep it. Unanswered stays open. This does not generate a cut plan.'
 where key = 'pattern_match';

update public.estimate_questions
   set help = 'Where seams should fall and which way the roll runs. Exclusive carpet tile hides this — there is no roll. Glue-down broadloom still asks. For the cut list — not a generated plan.'
 where key = 'carpet_direction';

update public.estimate_questions
   set help = 'Inches of pattern repeat for purchasing and layout notes. Exclusive carpet tile hides this with pattern match. This does not generate a cut plan.'
 where key = 'pattern_repeat';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0262_flooring_knowledge_carpet_tile_layout.sql

-- BEGIN 0263_flooring_knowledge_wall_subfloor.sql
-- Floor King — flooring knowledge engine, pass 74.
-- Run in the Supabase SQL editor AFTER 0190–0262. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asked whether the FLOOR is flat / uneven / cracked.
-- That is not a backsplash question, and leftover Uneven + Patch/skim fired a
-- self-level warning after Self-leveling chips were already hidden (0261).
-- Hide subfloor_condition on wall-only jobs. Mixed LVP + wall still asks.
-- Unanswered and Unknown stay open.
-- Do NOT SQL-gate subfloor_condition on tile_application (0142 — unanswered floor vs wall must still ask floor flatness).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0263_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, and floor subfloor condition (flat / uneven / cracks) — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Flat vs uneven vs cracks vs a height change. Exclusive wall tile hides this — that is floor work, not a backsplash. Mixed LVP + wall still asks. If demo hasn''t happened, pick Unknown / field verify — do not invent a bag count.'
 where key = 'subfloor_condition';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0263_flooring_knowledge_wall_subfloor.sql

-- BEGIN 0264_flooring_knowledge_wall_stairs.sql
-- Floor King — flooring knowledge engine, pass 75.
-- Run in the Supabase SQL editor AFTER 0190–0263. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asked about stairs, landings, and open sides.
-- hs_plank_stairs was already hidden, but the generic stair gate and its
-- landing / open-side follow-ups stayed visible on a backsplash. Hide them
-- on wall-only jobs. Mixed carpet or LVP + wall still asks. Unanswered
-- and Unknown stay open.
-- Do NOT SQL-gate stairs on tile_application (0142 — unanswered floor vs wall must still ask stairs).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0264_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Stairs change material, labor, and trim. Exclusive wall tile hides this — a backsplash is not a stair job. Mixed carpet or LVP + wall still asks. Field verify if you have not seen them.'
 where key = 'stairs';

update public.estimate_questions
   set help = 'Count of landings in EACH. Measured with the rooms when they are floored the same; this flags extra pieces and noses. Exclusive wall tile hides this — a backsplash is not a stair job.'
 where key = 'stair_landings';

update public.estimate_questions
   set help = 'Open sides change wrapped carpet ends and hard-surface nosing. Exclusive wall tile hides this. Capture the construction — pricing still uses existing stair labor.'
 where key = 'stair_open_sides';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0264_flooring_knowledge_wall_stairs.sql

-- BEGIN 0265_flooring_knowledge_wall_demo.sql
-- Floor King — flooring knowledge engine, pass 76.
-- Run in the Supabase SQL editor AFTER 0190–0264. Idempotent — safe to re-run.
--
-- Exclusive wall tile still offered floor demo chips (carpet / LVP / hardwood /
-- sheet vinyl / luan) on "what's coming up?". Those are not a backsplash.
-- Hide those chips; ceramic mortar / None / Other stay for wall-tile tear-out.
-- Pad / tack / glued-vs-floating follow-ups hide too. Mixed LVP + wall still
-- shows floor demo. Unanswered and Unknown stay open.
-- Do NOT SQL-gate hs_demo on tile_application (0142 — unanswered floor vs wall must still offer carpet tear-out).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0265_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0265_flooring_knowledge_wall_demo.sql

-- BEGIN 0266_flooring_knowledge_wall_furniture.sql
-- Floor King — flooring knowledge engine, pass 77.
-- Run in the Supabase SQL editor AFTER 0190–0265. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asked light/medium/heavy furniture moving.
-- A backsplash is not a furniture-moving job. Hide furniture_level and
-- furniture_heavy on wall-only jobs. Appliances stay. Mixed LVP + wall
-- still asks. Occupied floor jobs still ask. Unanswered stays open.
-- Do NOT SQL-gate furniture on tile_application (0142 — unanswered floor vs wall must still ask furniture).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0266_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Occupied vs vacant. Vacant hides furniture moving — empty house, do not invent a furniture charge. Exclusive wall tile also hides it — a backsplash is not a furniture-moving job. Occupied and Unknown still ask light/medium/heavy. Unanswered stays open.'
 where key = 'occupancy';

update public.estimate_questions
   set help = 'Light / medium / heavy uses Floor King''s furniture-moving labor. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job. Specialty items (piano, pool table) stay on the next question as scope.'
 where key = 'furniture_level';

update public.estimate_questions
   set help = 'Pianos, pool tables, and loaded cabinets are scope/schedule notes unless this job already has a furniture-moving labor line. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job.'
 where key = 'furniture_heavy';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0266_flooring_knowledge_wall_furniture.sql

-- BEGIN 0267_flooring_knowledge_solid_floating.sql
-- Floor King — flooring knowledge engine, pass 78.
-- Run in the Supabase SQL editor AFTER 0190–0266. Idempotent — safe to re-run.
--
-- Solid hardwood is typically nail, staple, or glue — not a click floor.
-- Unanswered install method still asked attached pad / underlayment /
-- expansion because those gates stay open until a method is picked.
-- Hide them once the surface is exclusive solid hardwood. Engineered and
-- mixed Hardwood + Engineered stay open. Unanswered HS stays open.
-- Do NOT SQL-gate attached_pad on surface_type (0142 — unanswered HS must still ask attached pad for LVP / laminate).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0267_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, and thinset ask different follow-ups. Solid hardwood hides attached pad, underlayment, and expansion — floating is not a permitted system. Pick the system this product actually uses. Do not invent a per-room editor.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Floating LVP / laminate / engineered may have an attached pad. Solid hardwood hides this — floating is not a permitted system. Glue-down hides this. Yes hides separate underlayment.'
 where key = 'attached_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Do not invent a roll count.'
 where key = 'hs_underlayment';

update public.estimate_questions
   set help = 'Floating floors need expansion at walls and transitions. Solid hardwood hides this — floating is not a permitted system. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.'
 where key = 'laminate_expansion';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0267_flooring_knowledge_solid_floating.sql

-- BEGIN 0268_flooring_knowledge_tile_vapor.sql
-- Floor King — flooring knowledge engine, pass 79.
-- Run in the Supabase SQL editor AFTER 0190–0267. Idempotent — safe to re-run.
--
-- Exclusive tile (floor or wall) still asked the 6-mil vapor-barrier
-- question once substrate was Concrete. Thinset / mortar is not a
-- click-floor vapor sheet — crack isolation and uncoupling membranes
-- stay on Tile setting. Mixed LVP or hardwood + tile still asks.
-- Unanswered HS stays open. Do NOT SQL-gate vapor_barrier on surface_type (0142 — unanswered HS and mixed LVP + tile must still ask vapor barrier over concrete).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0268_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Exclusive floor tile also hides the 6-mil vapor-barrier question — thinset is not a click-floor vapor barrier; membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Thinset, grout, and backer come from the catalog in Builder. This records the need — bag counts stay TBD unless a product with coverage is actually picked. Taped square feet is not bags of thinset. Exclusive tile hides the 6-mil vapor-barrier question; crack isolation / uncoupling membranes belong here, not on that floating-floor sheet.'
 where key = 'tile_setting';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0268_flooring_knowledge_tile_vapor.sql

-- BEGIN 0269_flooring_knowledge_vapor_underlayment.sql
-- Floor King — flooring knowledge engine, pass 80.
-- Run in the Supabase SQL editor AFTER 0190–0268. Idempotent — safe to re-run.
--
-- Glue-down, carpet tile, nail-down, and stretch-in still offered
-- "Included with underlayment" on the vapor-barrier question. That chip
-- is a floating-floor 6-mil sheet — you cannot glue to it. Aqua bar /
-- primer stays on moisture mitigation. Floating and unanswered LVP /
-- engineered still offer the chip. Exclusive solid hardwood hides it
-- even before a method is picked. Do NOT SQL-gate vapor_barrier options on install_method (0142 — unanswered LVP must still offer Included with underlayment).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0269_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Aqua bar stays on moisture mitigation. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0269_flooring_knowledge_vapor_underlayment.sql

-- BEGIN 0270_flooring_knowledge_concrete_sheets.sql
-- Floor King — flooring knowledge engine, pass 81.
-- Run in the Supabase SQL editor AFTER 0190–0269. Idempotent — safe to re-run.
--
-- Exclusive Concrete still asked for 4×8 plywood overlay sheets. A slab
-- is patch / self-level, not a wood-deck repair. Hide subfloor_needed
-- once every substrate pick is Concrete. Plywood / wood / existing
-- flooring / Unknown stay open. Unanswered stays open. Sit the question
-- after substrate so it does not appear behind the salesperson.
-- Do NOT SQL-gate subfloor_needed on substrate (0142 — unanswered substrate must still ask 4×8).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0270_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'If you cannot see the substrate until demo, pick Unknown / field verify rather than guessing plywood vs concrete. Exclusive Concrete hides 4×8 subfloor sheets — a slab is patch / self-level, not plywood overlay. Plywood / wood / existing flooring still ask.',
       position = 350
 where key = 'substrate';

update public.estimate_questions
   set help = 'Yes emits 4×8 sheets only when Settings has sheet_sqft. Missing coverage is TBD — we do not invent 32 sq ft per sheet. Field verify withholds the count. Exclusive Concrete hides this — a slab is not a plywood overlay. Plywood / wood / existing flooring / Unknown still ask. Self-level stays on Floor prep.',
       position = 355
 where key = 'subfloor_needed';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0270_flooring_knowledge_concrete_sheets.sql

-- BEGIN 0271_flooring_knowledge_carpet_tile_vapor.sql
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

-- original begin; absorbed into the single owner-bundle transaction

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

-- original commit; absorbed into the single owner-bundle transaction
-- END 0271_flooring_knowledge_carpet_tile_vapor.sql

-- BEGIN 0272_flooring_knowledge_wood_moisture.sql
-- Floor King — flooring knowledge engine, pass 83.
-- Run in the Supabase SQL editor AFTER 0190–0271. Idempotent — safe to re-run.
--
-- Exclusive hardwood nail/staple/floating over plywood still asked the slab
-- moisture test and Aqua bar. 0190: moisture test is glue-down or wood over
-- concrete — not a wood deck and not floating click. Hide moisture_test and
-- moisture_mitigation once every substrate pick is Plywood / OSB / Wood and
-- the job is exclusive hardwood that is not glue-down. Glue-down over plywood
-- still asks. Mixed LVP still asks. A moisture-concern flag still asks.
-- Unanswered substrate and unanswered method stay open.
-- Do NOT SQL-gate moisture_test on substrate (0142 — unanswered substrate and mixed LVP + hardwood must still ask a slab moisture test).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0272_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood over concrete, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — 0190 is glue-down or wood over concrete, not a wood deck. Glue-down over plywood still asks. Mixed LVP still asks. Unanswered substrate stays open. Wet area still asks.'
 where key = 'moisture_test'
    or id = '9400b1d6-9e58-45f8-929d-57dc35dff3be';

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system; glue-down over wood still asks. Mixed LVP still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation'
    or id = '2fc7799c-030c-4276-b6fa-801cb9867082';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0272_flooring_knowledge_wood_moisture.sql

-- BEGIN 0273_flooring_knowledge_sole_leftover.sql
-- Floor King — flooring knowledge engine, pass 84.
-- Run in the Supabase SQL editor AFTER 0190–0272. Idempotent — safe to re-run.
--
-- Leftover install_method chips on a sole-system family still switched
-- follow-ups: Glue-down on laminate opened adhesive and hid expansion;
-- Floating on sheet vinyl hid adhesive; Floating on tile opened attached
-- pad / underlayment / expansion. Overlay now keeps the only legal system
-- (laminate floating, tile thinset, sheet vinyl glue) so leftover chips
-- do not switch follow-ups. Mixed LVP + laminate has no sole system —
-- leftover stays. Unanswered still infers.
-- Do NOT SQL-gate adhesive on surface_type (0142 — unanswered HS and mixed LVP + laminate must still ask adhesive when glue is in play).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0273_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, and thinset ask different follow-ups. Solid hardwood hides attached pad, underlayment, and expansion — floating is not a permitted system. Laminate leftover Glue-down does not open adhesive — laminate is floating. Sheet vinyl leftover Floating still asks adhesive — sheet vinyl is glue-down. Tile leftover Floating does not open attached pad or expansion — tile is thinset. Mixed LVP + laminate still asks both branches. Pick the system this product actually uses. Do not invent a per-room editor.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Exclusive laminate leftover Glue-down does not show this — laminate is floating. Exclusive sheet vinyl leftover Floating still asks this — sheet vinyl is glue-down. Mixed LVP still asks. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. Do not invent coverage.'
 where key = 'adhesive';

update public.estimate_questions
   set help = 'Floating LVP / laminate / engineered may have an attached pad. Solid hardwood hides this — floating is not a permitted system. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Yes hides separate underlayment.'
 where key = 'attached_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Do not invent a roll count.'
 where key = 'hs_underlayment';

update public.estimate_questions
   set help = 'Floating floors need expansion at walls and transitions. Solid hardwood hides this — floating is not a permitted system. Exclusive laminate leftover Glue-down still asks this — laminate is floating. Exclusive tile leftover Floating hides this. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.'
 where key = 'laminate_expansion';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0273_flooring_knowledge_sole_leftover.sql

-- BEGIN 0274_flooring_knowledge_carpet_hs_leftover.sql
-- Floor King — flooring knowledge engine, pass 85.
-- Run in the Supabase SQL editor AFTER 0190–0273. Idempotent — safe to re-run.
--
-- Carpet-only leftover Floating / Glue-down (hard-surface install_method)
-- still switched overlay systems: stretch-in opened expansion and
-- underlayment, and leftover Floating undid exclusive carpet-tile 6-mil
-- vapor hide. Hard-surface chips apply only when a hard-surface family is
-- in play. Mixed Carpet + LVP still asks click-floor follow-ups.
-- Unanswered carpet install stays open.
-- Do NOT SQL-gate vapor_barrier on install_method (0142 — unanswered HS and mixed Carpet + LVP leftover Floating must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0274_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Floating floors need expansion at walls and transitions. Solid hardwood hides this — floating is not a permitted system. Exclusive laminate leftover Glue-down still asks this — laminate is floating. Exclusive tile leftover Floating hides this. Carpet-only leftover Floating hides this — click-floor expansion is not a stretch-in question. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.'
 where key = 'laminate_expansion';

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Exclusive laminate leftover Glue-down does not show this — laminate is floating. Exclusive sheet vinyl leftover Floating still asks this — sheet vinyl is glue-down. Carpet-only leftover Glue-down does not show this — carpet glue is on Carpet install. Mixed LVP still asks. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. Do not invent coverage.'
 where key = 'adhesive';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0274_flooring_knowledge_carpet_hs_leftover.sql

-- BEGIN 0275_flooring_knowledge_glue_wood_vapor.sql
-- Floor King — flooring knowledge engine, pass 86.
-- Run in the Supabase SQL editor AFTER 0190–0274. Idempotent — safe to re-run.
--
-- Exclusive glue-down over plywood still asked the 6-mil click-floor vapor
-- sheet. You cannot glue to 6-mil poly — Aqua bar stays on moisture
-- mitigation. Hide vapor_barrier once every substrate pick is Plywood /
-- OSB / Wood and the job is glue-down with no floating. Glue over concrete
-- still asks. Mixed floating + glue still asks. Unanswered substrate stays
-- open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed plywood + concrete must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0275_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly; Aqua bar stays on moisture mitigation. Glue over concrete still asks. Mixed floating still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0275_flooring_knowledge_glue_wood_vapor.sql

-- BEGIN 0276_flooring_knowledge_glue_wood_aqua.sql
-- Floor King — flooring knowledge engine, pass 87.
-- Run in the Supabase SQL editor AFTER 0190–0275. Idempotent — safe to re-run.
--
-- Exclusive glue-down / carpet tile over plywood still asked Aqua bar.
-- Aqua bar is a slab coating — not a wood-deck primer. Hide
-- moisture_mitigation once every substrate pick is Plywood / OSB / Wood
-- and the job is glue-down or carpet tile. Moisture test still asks
-- (wood moisture content). Glue over concrete still asks. Mixed plywood
-- + concrete still asks. A moisture-concern flag still asks. Unanswered
-- substrate and unanswered method stay open.
-- Do NOT SQL-gate moisture_mitigation on substrate (0142 — unanswered substrate and mixed plywood + concrete must still ask Aqua bar).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0276_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier except exclusive carpet tile over plywood — Aqua bar is a slab system. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system. Exclusive glue-down or carpet tile over plywood also hides this. Moisture test still asks. Glue over concrete still asks. Mixed plywood + concrete still asks. A moisture-concern flag still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation'
    or id = '2fc7799c-030c-4276-b6fa-801cb9867082';

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood over concrete, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — 0190 is glue-down or wood over concrete, not a wood deck. Glue-down over plywood still asks. Exclusive glue-down or carpet tile over plywood hides Aqua bar — it is a slab system. Mixed LVP still asks. Unanswered substrate stays open. Wet area still asks.'
 where key = 'moisture_test'
    or id = '9400b1d6-9e58-45f8-929d-57dc35dff3be';

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Glue over concrete still asks. Mixed floating still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0276_flooring_knowledge_glue_wood_aqua.sql

-- BEGIN 0277_flooring_knowledge_underlayment_cover.sql
-- Floor King — flooring knowledge engine, pass 88.
-- Run in the Supabase SQL editor AFTER 0190–0276. Idempotent — safe to re-run.
--
-- Unkeyed product questions with category underlayment treated mixed-job
-- cover as carpet rooms. Laminate foam is not carpet pad. Keyed carpet_pad
-- still covers carpet rooms. Keyed hs_underlayment still covers hard-surface
-- rooms. Mixed unkeyed stays 0 rather than cloning pad onto LVP / laminate.
-- Exclusive carpet still uses carpet rooms. Exclusive hard surface still
-- uses prep/HS rooms. Do not invent a roll count or a 30-yard pad default
-- when the catalog SKU has no sold-by unit.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0277_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Do not invent a roll count.'
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0277_flooring_knowledge_underlayment_cover.sql

-- BEGIN 0278_flooring_knowledge_underlayment_units.sql
-- Floor King — flooring knowledge engine, pass 89.
-- Run in the Supabase SQL editor AFTER 0190–0277. Idempotent — safe to re-run.
--
-- Catalog category underlayment is pad yards (SQYD_CATEGORIES). Laminate / LVP
-- foam is the same category but bills by the square foot. Guided Estimate uses
-- the question key + SKU unit so hs_underlayment is not converted to yards.
-- Product area unit wins when the SKU actually stores sq yd or sq ft.
-- Do not invent a 30-yard foam roll.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (carpet pad would plant square feet).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0278_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0278_flooring_knowledge_underlayment_units.sql

-- BEGIN 0279_flooring_knowledge_bulk_pickup.sql
-- Floor King — flooring knowledge engine, pass 90.
-- Run in the Supabase SQL editor AFTER 0190–0278. Idempotent — safe to re-run.
--
-- Bulk pickup day was UUID-only (0142). Overlay, review, and new-construction
-- hide could not attach. Key it as bulk_pickup. New construction hides it with
-- the other tear-out questions. Live show_if still waits for Placed at curb.
-- Overlay require hides haul-away / dumpster once disposal is answered.
-- Unanswered work_type stays open. Do not invent a dumpster fee.
-- Do NOT SQL-gate bulk_pickup on work_type (0142 — unanswered new-vs-replacement must still ask when curb is in play).
-- Do NOT SQL-gate bulk_pickup on demo_disposal (0142 show_if already waits for Placed at curb; overlay require hides haul-away).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0279_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set key = 'bulk_pickup',
       help = 'Municipal bulk pickup day so the old floor is at the curb on time. New construction hides this. Haul-away / dumpster hides this. Unanswered disposal stays open in overlay. Do not invent a disposal charge here.'
 where id = '81a746cb-5374-46d2-b828-c7f0053b3c8f'
    or key = 'bulk_pickup';

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, and toilet pull/reset — substrate, prep, appliances, and door shaves still apply. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab.'
 where key = 'work_type';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0279_flooring_knowledge_bulk_pickup.sql

-- BEGIN 0280_flooring_knowledge_wall_climate.sql
-- Floor King — flooring knowledge engine, pass 91.
-- Run in the Supabase SQL editor AFTER 0190–0279. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asked site AC/heat and acclimation. A backsplash
-- is not a hardwood acclimation job. Hide climate_control and acclimation on
-- wall-only jobs. Occupancy, delivery, access, wet area, appliances, substrate,
-- prep, base trim, and setting stay. Mixed LVP or hardwood + wall still asks.
-- Unanswered and Unknown stay open.
-- Do NOT SQL-gate climate_control on tile_application (0142 — unanswered floor vs wall must still ask AC/heat).
-- Do NOT SQL-gate acclimation on tile_application (0142 — leftover Glue-down on unanswered wall must not SQL-hide).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0280_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Site AC/heat and acclimation hide too — a backsplash is not a hardwood acclimation job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, occupancy, delivery, access, and setting materials. Exclusive floor tile also hides the 6-mil vapor-barrier question — thinset is not a click-floor vapor barrier; membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down / carpet tile, from this overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Unanswered and Unknown stay open. Legacy AC/heat yes-no answers still count.'
 where key = 'climate_control';

update public.estimate_questions
   set help = 'Hardwood, glue-down (including glue-down carpet), and carpet tile need acclimation / climate notes. Floating laminate and stretch-in hide this — do not invent a day count. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Leftover Glue-down on exclusive wall does not reopen this.'
 where key = 'acclimation';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0280_flooring_knowledge_wall_climate.sql

-- BEGIN 0281_flooring_knowledge_legacy_climate.sql
-- Floor King — flooring knowledge engine, pass 92.
-- Run in the Supabase SQL editor AFTER 0190–0280. Idempotent — safe to re-run.
--
-- 0142 merged AC and heat into climate_control, but leftover ac_available /
-- heat_available keys still sat on the overlay (no families/systems), so
-- every job listed them. Hide them always. climate_control is the source of truth.
-- climateControlConfirmed still reads leftover Yes answers.
-- Do NOT SQL-gate climate_control on install_method (0142 — unanswered hardwood/glue must still ask climate).
-- Do NOT SQL-gate climate_control on tile_application (0142 — unanswered floor vs wall must still ask AC/heat).
-- Do NOT drop legacy Yes reading from climateControlConfirmed.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0281_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Heat available? was deactivated in 0142. Re-assert. Any leftover AC/heat
-- yes-no keyed rows stay inactive so they cannot reappear on Guided Estimate.
-- Do not touch climate_control (UUID 4f2ec418) — that is the live question.
update public.estimate_questions
   set active = false
 where key in ('ac_available', 'heat_available')
    or id = 'e3bcf27d-cddd-44ee-8fef-70ff38056649';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down / carpet tile, from this overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Unanswered and Unknown stay open. Legacy AC/heat yes-no answers still count. Leftover AC available / Heat available questions stay off the overlay — climate_control is the source of truth.'
 where key = 'climate_control';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0281_flooring_knowledge_legacy_climate.sql

-- BEGIN 0282_flooring_knowledge_legacy_curb.sql
-- Floor King — flooring knowledge engine, pass 93.
-- Run in the Supabase SQL editor AFTER 0190–0281. Idempotent — safe to re-run.
--
-- 0142 merged Placed on the curb into demo_disposal, but leftover carpet_curb
-- still sat on the overlay (carpet family), so every carpet job listed it.
-- Hide it always. demo_disposal is the source of truth. Review still buckets
-- leftover answers. bulk_pickup still waits for Placed at curb.
-- Do NOT SQL-gate bulk_pickup on demo_disposal (0142 show_if already waits for Placed at curb; overlay require hides haul-away).
-- Do NOT SQL-gate demo_disposal on carpet_curb (0142 — unanswered disposal must still ask haul vs curb).
-- Do NOT drop leftover carpet_curb from review SPECIAL_KEYS.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0282_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Placed on the curb? was deactivated in 0142 (now a demo_disposal chip).
-- Re-assert. Do not touch bulk_pickup (UUID 81a746cb) — that is the live
-- municipal pickup-day follow-up.
update public.estimate_questions
   set active = false
 where key = 'carpet_curb'
    or id = 'a07eb68f-91b6-4fe7-8237-bb0e9986076c';

update public.estimate_questions
   set help = 'Haul away, dumpster, or placed at curb. Placed at curb opens bulk pickup day. Leftover Placed-on-the-curb yes-no stays off the overlay — demo_disposal is the source of truth. New construction hides this. Unanswered stays open. Do not invent a dumpster fee.'
 where key = 'demo_disposal';

update public.estimate_questions
   set help = 'Municipal bulk pickup day so the old floor is at the curb on time. New construction hides this. Haul-away / dumpster hides this. Unanswered disposal stays open in overlay. Leftover Placed-on-the-curb yes-no is not this question — Placed at curb on demo_disposal is. Do not invent a disposal charge here.'
 where key = 'bulk_pickup';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0282_flooring_knowledge_legacy_curb.sql

-- BEGIN 0283_flooring_knowledge_carpet_install_method.sql
-- Floor King — flooring knowledge engine, pass 94.
-- Run in the Supabase SQL editor AFTER 0190–0282. Idempotent — safe to re-run.
--
-- Exclusive carpet still listed the hard-surface Install method picker on
-- overlay walks. Stretch-in / glue-down / carpet tile stay on Carpet install.
-- Hide install_method once the job is carpet-only. Mixed Carpet + LVP still
-- asks. Unanswered hard surface stays open. Leftover Floating / Glue-down
-- chips do not reopen it.
-- Do NOT SQL-gate install_method on carpet_install (0142 — mixed Carpet + LVP leftover Floating must still ask hard-surface method).
-- Do NOT SQL-gate install_method on surface_type (0142 — unanswered HS must still ask install method).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0283_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, or thinset — pick every hard-surface method in play. Exclusive carpet hides this hard-surface method picker. Stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Floating / Glue-down chips do not reopen it on a carpet-only job.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0283_flooring_knowledge_carpet_install_method.sql

-- BEGIN 0284_flooring_knowledge_carpet_surface.sql
-- Floor King — flooring knowledge engine, pass 95.
-- Run in the Supabase SQL editor AFTER 0190–0283. Idempotent — safe to re-run.
--
-- Exclusive carpet still listed Surface type (the hard-surface family picker)
-- on overlay walks. LVP / hardwood / laminate / tile / sheet vinyl are not a
-- carpet-only job. Hide surface_type once the job is exclusive carpet.
-- Mixed Carpet + LVP still asks. Unanswered hard surface stays open.
-- Leftover Hardwood chips do not reopen it.
-- Do NOT SQL-gate surface_type on carpet_install (0142 — mixed Carpet + LVP leftover Hardwood must still ask surface type).
-- Do NOT SQL-gate surface_type on project_type (0142 show_if already waits for Hard surface; overlay hide is exclusive carpet).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0284_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'LVP, hardwood, laminate, tile, or sheet vinyl. Exclusive carpet hides this — stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Hardwood chips do not reopen it on a carpet-only job.'
 where key = 'surface_type';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0284_flooring_knowledge_carpet_surface.sql

-- BEGIN 0285_flooring_knowledge_carpet_surface_leftover.sql
-- Floor King — flooring knowledge engine, pass 96.
-- Run in the Supabase SQL editor AFTER 0190–0284. Idempotent — safe to re-run.
--
-- Leftover Surface type (Hardwood / LVP / …) on exclusive carpet still
-- unioned hard-surface families, so overlay asked finish, fasteners, vapor,
-- and plank stairs. That leftover chip does not switch finish, fasteners, vapor,
-- or Install method — it is not a mixed job. Ignore it for overlay families
-- — same as leftover Floating on install_method (0274). Mixed Carpet + LVP
-- still unions Surface type. Unanswered hard surface stays open. Assigned
-- hardwood products still add the family. Unanswered project_type still
-- reads Surface type (0142).
-- Do NOT SQL-gate hardwood_finish on project_type (0142 — mixed Carpet + hardwood must still ask finish).
-- Do NOT SQL-gate surface_type on carpet_install (0142 — mixed leftover Hardwood must still ask surface type).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0285_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'LVP, hardwood, laminate, tile, or sheet vinyl. Exclusive carpet hides this — stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Hardwood chips do not reopen finish, fasteners, vapor, or Install method on a carpet-only job.'
 where key = 'surface_type';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Leftover Hardwood on Surface type does not reopen finish, fasteners, or vapor. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0285_flooring_knowledge_carpet_surface_leftover.sql

-- BEGIN 0286_flooring_knowledge_hs_carpet_leftover.sql
-- Floor King — flooring knowledge engine, pass 97.
-- Run in the Supabase SQL editor AFTER 0190–0285. Idempotent — safe to re-run.
--
-- Leftover Carpet install (Glue-down / Carpet tile / Stretch-in) on exclusive
-- hard surface still unioned carpet systems, so overlay asked adhesive,
-- moisture test, and acclimation on a floating LVP job. That leftover chip
-- does not switch adhesive, moisture test, or acclimation — it is not a
-- mixed job. Ignore leftover Carpet install when Carpet is not in play —
-- same as leftover Floating on exclusive carpet (0274). Mixed Carpet + LVP
-- still unions Carpet install. Unanswered carpet stays open. Assigned
-- carpet products still add the family.
-- Do NOT SQL-gate adhesive on carpet_install (0142 — mixed Carpet + LVP leftover Glue-down must still ask adhesive).
-- Do NOT SQL-gate carpet_install on surface_type (0142 — mixed leftover Stretch-in must still ask Carpet install).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0286_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Leftover Hardwood on Surface type does not reopen finish, fasteners, or vapor. Leftover Glue-down / Carpet tile on exclusive LVP is a carpet chip — it does not open adhesive, moisture test, or acclimation. Mixed Carpet + LVP still unions Carpet install. Do not invent a box size.'
 where key = 'carpet_install';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0286_flooring_knowledge_hs_carpet_leftover.sql

-- BEGIN 0287_flooring_knowledge_extra_pad_measured.sql
-- Floor King — flooring knowledge engine, pass 98.
-- Run in the Supabase SQL editor AFTER 0190–0286. Idempotent — safe to re-run.
--
-- Additional pad for a specific area (stairs, landing) was labeled Area /
-- sq ft, so a salesperson could type a roll or billing yards into measured
-- square feet. That field is MEASURED sq ft — not a 30-yard roll and not
-- the billing unit. Carpet pad still bills in square yards unless the SKU
-- is feet. Foam stays on hs_underlayment. A pad SKU with no sold-by unit
-- stays How many / Unit TBD, not taped square feet.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (carpet pad would plant square feet).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0287_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0287_flooring_knowledge_extra_pad_measured.sql

-- BEGIN 0288_flooring_knowledge_dead_stair_gate.sql
-- Floor King — flooring knowledge engine, pass 99.
-- Run in the Supabase SQL editor AFTER 0190–0287. Idempotent — safe to re-run.
--
-- Generic Stairs yes/no is a leftover synthesizer. Live stair questions are
-- Carpet stairs, Carpet tile stairs, and hard-surface plank stairs.
-- Overlay hides the dead gate once a family-specific stair question is in
-- play. Landings / open sides still follow those Yes answers via
-- synthesizeStairGate. Unanswered project_type stays open. Exclusive wall
-- already hides stairs. Mixed Carpet + LVP still asks both family stairs.
-- Do NOT SQL-gate stair_landings on carpet_stairs (0142 — synthesizeStairGate copies Yes onto stairs).
-- Do NOT SQL-gate stairs on carpet_install (0142 — unanswered project_type must still ask the leftover gate).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0288_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stairs change material, labor, and trim. Exclusive wall tile hides this — a backsplash is not a stair job. Mixed carpet or LVP + wall still asks the family-specific stair questions. This leftover yes/no hides once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Unanswered project_type stays open. Field verify if you have not seen them.'
 where key = 'stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0288_flooring_knowledge_dead_stair_gate.sql

-- BEGIN 0289_flooring_knowledge_carpet_tile_metals.sql
-- Floor King — flooring knowledge engine, pass 100.
-- Run in the Supabase SQL editor AFTER 0190–0288. Idempotent — safe to re-run.
--
-- Exclusive carpet tile still asked gripper / flat metals. Those are binder
-- bars for roll goods, not modular tile. Overlay hides metals_needed plus
-- qty / type / color once carpet_install is exclusively Carpet tile.
-- Stretch-in and glue-down keep them. Mixed stretch-in + tile still asks.
-- Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars.
-- Leftover Yes on exclusive tile does not reopen qty/type/color.
-- Unanswered carpet install stays open.
-- Do NOT SQL-gate metals_needed on carpet_install (0142 — unanswered carpet and mixed stretch-in + tile must still ask doorway metals).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0289_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Carpet-to-hard-surface doorways and edges. Yes opens the count (EACH) plus type/color. Exclusive carpet tile hides this — gripper and flat metals are binder bars for roll goods, not modular tile. Stretch-in and glue-down keep it. Mixed stretch-in + tile still asks. Unanswered stays open. Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars. Leftover Yes on exclusive tile does not reopen qty/type/color. Do not invent a metal price here.'
 where key = 'metals_needed';

update public.estimate_questions
   set help = 'Count of metals / transitions in EACH — never square feet. Exclusive carpet tile hides this with metals needed — modular tile is not a binder-bar count. Pick a catalog gripper or flat metal in Builder if Floor King sells it.'
 where key = 'metals_qty';

update public.estimate_questions
   set help = 'Gripper vs flat. Exclusive carpet tile hides this with metals needed. The count is the previous step — this does not add a second charge.'
 where key = 'metal_type';

update public.estimate_questions
   set help = 'Silver / titanium / gold. Exclusive carpet tile hides this with metals needed. This does not invent a metal SKU.'
 where key = 'metal_color';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides gripper/flat metals — binder bars for roll goods, not modular tile. Stretch-in and glue-down keep metals. Mixed stretch-in + tile still asks metals. Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Leftover Hardwood on Surface type does not reopen finish, fasteners, or vapor. Leftover Glue-down / Carpet tile on exclusive LVP is a carpet chip — it does not open adhesive, moisture test, or acclimation. Mixed Carpet + LVP still unions Carpet install. Do not invent a box size.'
 where key = 'carpet_install';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0289_flooring_knowledge_carpet_tile_metals.sql

-- BEGIN 0290_flooring_knowledge_glue_existing_vapor.sql
-- Floor King — flooring knowledge engine, pass 101.
-- Run in the Supabase SQL editor AFTER 0190–0289. Idempotent — safe to re-run.
--
-- Exclusive glue-down over Existing flooring still asked the 6-mil click-floor
-- vapor sheet and Aqua bar. You glue to the existing floor or tear it out —
-- not to 6-mil poly. Aqua bar is a slab coating, not an existing-floor primer.
-- Hide vapor_barrier once every substrate pick is Existing flooring and the
-- job is glue-down with no floating. Hide moisture_mitigation once exclusive
-- glue-down or carpet tile is over Existing flooring. Moisture test still
-- asks (unknown what is under). Glue over concrete still asks both. Mixed
-- floating + glue still asks vapor. Mixed existing + concrete stays open.
-- A moisture-concern flag still asks Aqua bar. Unanswered substrate stays
-- open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed existing + concrete must still ask vapor barrier).
-- Do NOT SQL-gate moisture_mitigation on substrate (0142 — unanswered substrate and mixed existing + concrete must still ask Aqua bar).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0290_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Glue over concrete still asks. Mixed floating still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier except exclusive carpet tile over plywood — Aqua bar is a slab system. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system. Exclusive glue-down or carpet tile over plywood also hides this. Exclusive glue-down or carpet tile over existing flooring also hides this — Aqua bar is a slab coating, not an existing-floor primer. Moisture test still asks. Glue over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. A moisture-concern flag still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0290_flooring_knowledge_glue_existing_vapor.sql

-- BEGIN 0291_flooring_knowledge_wood_deck_vapor.sql
-- Floor King — flooring knowledge engine, pass 102.
-- Run in the Supabase SQL editor AFTER 0190–0290. Idempotent — safe to re-run.
--
-- Exclusive floating over plywood still asked the 6-mil click-floor vapor
-- sheet. 6-mil is a slab sheet, not a wood-deck underlayment. Hide
-- vapor_barrier once every substrate pick is Plywood / OSB / Wood and the
-- install method is answered (or inferred). Exclusive floating, glue, and
-- mixed floating + glue over plywood all hide. Glue / floating over
-- concrete still ask. Mixed plywood + concrete stays open. Unanswered
-- substrate and unanswered LVP method stay open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed plywood + concrete must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0291_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive plywood also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not a wood-deck underlayment. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Glue over concrete still asks. Floating over concrete still asks. Mixed plywood + concrete still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0291_flooring_knowledge_wood_deck_vapor.sql

-- BEGIN 0292_flooring_knowledge_existing_floor_vapor.sql
-- Floor King — flooring knowledge engine, pass 103.
-- Run in the Supabase SQL editor AFTER 0190–0291. Idempotent — safe to re-run.
--
-- Exclusive floating over Existing flooring still asked the 6-mil click-floor
-- vapor sheet. 6-mil is a slab sheet, not an existing-floor underlayment.
-- Hide vapor_barrier once every substrate pick is Existing flooring and the
-- install method is answered (or inferred). Exclusive floating, glue, and
-- mixed floating + glue over existing flooring all hide. Glue / floating
-- over concrete still ask. Mixed existing + concrete stays open.
-- Unanswered substrate and unanswered LVP method stay open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed existing + concrete must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0292_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive plywood also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not a wood-deck underlayment. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Exclusive existing flooring also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not an existing-floor underlayment. Glue over concrete still asks. Floating over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0292_flooring_knowledge_existing_floor_vapor.sql

-- BEGIN 0293_flooring_knowledge_dead_stair_followups.sql
-- Floor King — flooring knowledge engine, pass 104.
-- Run in the Supabase SQL editor AFTER 0190–0292. Idempotent — safe to re-run.
--
-- Generic Stairs yes/no is overlay-hidden once family-specific stairs are
-- live. Landings / open sides still required leftover stairs=Yes, so
-- unanswered require on that hidden parent kept them open on every carpet
-- and hard-surface overlay walk. Hide stair_landings and stair_open_sides
-- until Carpet stairs, Carpet tile stairs, or hard-surface plank stairs is
-- Yes. Leftover stairs=Yes without a family Yes does not reopen them —
-- hidden answers do not gate. Unanswered project_type stays open.
-- Do NOT SQL-gate stair_landings on carpet_stairs (0142 — synthesizeStairGate copies family Yes onto stairs; live show_if still waits for that Yes).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0293_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Count of landings in EACH. Measured with the rooms when they are floored the same; this flags extra pieces and noses. Exclusive wall tile hides this — a backsplash is not a stair job. Leftover Stairs yes/no hides this once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Unanswered project_type stays open.'
 where key = 'stair_landings';

update public.estimate_questions
   set help = 'Open sides change wrapped carpet ends and hard-surface nosing. Exclusive wall tile hides this. Leftover Stairs yes/no hides this once family-specific stairs are in play — open sides still follow those Yes answers. Capture the construction — pricing still uses existing stair labor.'
 where key = 'stair_open_sides';

update public.estimate_questions
   set help = 'Stairs change material, labor, and trim. Exclusive wall tile hides this — a backsplash is not a stair job. Mixed carpet or LVP + wall still asks the family-specific stair questions. This leftover yes/no hides once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Leftover landings / open sides hide until a family stair question is Yes. Unanswered project_type stays open. Field verify if you have not seen them.'
 where key = 'stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0293_flooring_knowledge_dead_stair_followups.sql

-- BEGIN 0294_flooring_knowledge_pad_takeoff.sql
-- Floor King — flooring knowledge engine, pass 105.
-- Run in the Supabase SQL editor AFTER 0190–0293. Idempotent — safe to re-run.
--
-- Catalog underlayment maps to family other, so pad / foam never reached
-- Review takeoff. Show measured area vs billing quantity (pad yards, foam
-- feet) instead of skipping the product or inventing a 30-yard roll.
-- Waste stays 0 unless the product has a waste percent. Carton coverage is
-- not invented. A pad SKU with no sold-by unit stays How many / Unit TBD
-- in Builder — Review takeoff is measured vs billing, not a planted qty.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Does NOT invent carton coverage / 30-yard roll.
--
-- Does NOT invent catalog categories or prices.
-- Does NOT enable accounting.

-- P0_0294_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0294_flooring_knowledge_pad_takeoff.sql

-- BEGIN 0295_flooring_knowledge_existing_floor_aqua.sql
-- Floor King — flooring knowledge engine, pass 106.
-- Run in the Supabase SQL editor AFTER 0190–0294. Idempotent — safe to re-run.
--
-- Aqua bar is a slab coating. Exclusive glue / carpet tile over existing
-- flooring already hid it (0290). Exclusive hardwood nail / staple /
-- floating over existing flooring still asked it. Hide moisture_mitigation
-- once every substrate pick is Existing flooring. Moisture test still
-- asks (unknown what's under). Mixed existing + concrete stays open. A
-- moisture-concern flag still asks. Unanswered substrate stays open.
-- Do NOT SQL-gate moisture_mitigation on substrate (0142 — mixed existing + concrete must still ask Aqua bar).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0295_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier except exclusive carpet tile over plywood — Aqua bar is a slab system. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system. Exclusive glue-down or carpet tile over plywood also hides this. Exclusive glue-down or carpet tile over existing flooring also hides this — Aqua bar is a slab coating, not an existing-floor primer. Exclusive hardwood nail/staple/floating over existing flooring also hides this. Moisture test still asks. Glue over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. A moisture-concern flag still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation';

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood over concrete, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — 0190 is glue-down or wood over concrete, not a wood deck. Glue-down over plywood still asks. Exclusive glue-down or carpet tile over plywood hides Aqua bar — it is a slab system. Exclusive hardwood nail/staple/floating over existing flooring also hides Aqua bar — it is a slab coating, not an existing-floor primer. Moisture test still asks. Mixed LVP still asks. Unanswered substrate stays open. Wet area still asks.'
 where key = 'moisture_test';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0295_flooring_knowledge_existing_floor_aqua.sql

-- BEGIN 0296_flooring_knowledge_new_build_furniture.sql
-- Floor King — flooring knowledge engine, pass 107.
-- Run in the Supabase SQL editor AFTER 0190–0295. Idempotent — safe to re-run.
--
-- Furniture moving is for occupied replacement floors. Vacant already hides
-- it. Exclusive new construction still asked light/medium/heavy and piano /
-- pool-table notes — a new slab has no furniture to move. Hide
-- furniture_level and furniture_heavy once every work-type pick is New
-- construction. Mixed Replacement + New construction stays open. Unanswered
-- stays open. Occupied new construction still hides furniture.
-- Do NOT SQL-gate furniture on work_type (0142 — mixed Replacement + New construction must still ask furniture).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0296_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Light / medium / heavy uses Floor King''s furniture-moving labor. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job. Exclusive new construction hides this — a new slab has no furniture to move. Mixed Replacement + New construction still asks. Specialty items (piano, pool table) stay on the next question as scope.'
 where key = 'furniture_level';

update public.estimate_questions
   set help = 'Pianos, pool tables, and loaded cabinets are scope/schedule notes unless this job already has a furniture-moving labor line. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job. Exclusive new construction hides this — a new slab has no furniture to move. Mixed Replacement + New construction still asks.'
 where key = 'furniture_heavy';

update public.estimate_questions
   set help = 'Occupied vs vacant. Vacant hides furniture moving — empty house, do not invent a furniture charge. Exclusive wall tile also hides it — a backsplash is not a furniture-moving job. Exclusive new construction also hides it — a new slab has no furniture to move. Occupied and Unknown still ask light/medium/heavy. Unanswered stays open.'
 where key = 'occupancy';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab.'
 where key = 'work_type';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0296_flooring_knowledge_new_build_furniture.sql

-- BEGIN 0297_flooring_knowledge_loose_lay_vapor.sql
-- Floor King — flooring knowledge engine, pass 108.
-- Run in the Supabase SQL editor AFTER 0190–0296. Idempotent — safe to re-run.
--
-- 6-mil click-floor vapor is a floating / glue sheet. Exclusive loose-lay
-- still asked for it over concrete. Loose-lay is not a click-floor sheet
-- and not glue-down — hide vapor_barrier once the only system is loose-lay,
-- including over concrete. Mixed floating + loose-lay stays open. Mixed
-- Carpet + LVP loose-lay stays open so stretch / glue over concrete still
-- asks. Leftover Loose-lay on exclusive carpet still asks over concrete.
-- Leftover Loose-lay on laminate coalesces to floating and still asks over
-- concrete. Unanswered LVP stays open.
-- Do NOT SQL-gate vapor_barrier on install_method (0142 — mixed floating + loose-lay must still ask 6-mil).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0297_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive plywood also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not a wood-deck underlayment. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Exclusive existing flooring also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not an existing-floor underlayment. Exclusive loose-lay hides this — loose-lay is not a click-floor 6-mil sheet, including over concrete. Mixed floating + loose-lay still asks. Mixed Carpet + LVP loose-lay still asks. Leftover Loose-lay on exclusive carpet still asks over concrete. Leftover Loose-lay on laminate coalesces to floating and still asks over concrete. Unanswered LVP stays open. Glue over concrete still asks. Floating over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0297_flooring_knowledge_loose_lay_vapor.sql

-- BEGIN 0298_flooring_knowledge_non_vinyl_skim.sql
-- Floor King — flooring knowledge engine, pass 109.
-- Run in the Supabase SQL editor AFTER 0190–0297. Idempotent — safe to re-run.
--
-- Existing-vinyl skim is for embossed vinyl, not every sheet-vinyl job.
-- Exclusive carpet / LVP / hardwood / ceramic / luan tear-out still asked
-- it. Hide vinyl_skim once every demo pick names a non-vinyl floor. None
-- stays open — encapsulating existing vinyl has no tear-out chip. Other /
-- Unknown stay open. Sheet vinyl demo still asks. Mixed Carpet + Sheet
-- vinyl stays open. Unanswered stays open. New construction already hides.
-- Do NOT SQL-gate vinyl_skim on hs_demo (0142 — unanswered and mixed Carpet + Sheet vinyl must still ask skim).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0298_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Embossed existing vinyl often needs a skim coat. New construction hides this — there is no existing vinyl. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out also hides this — that demo is not existing vinyl. None still asks — encapsulating existing vinyl has no tear-out chip. Other / Unknown stay open. Sheet vinyl demo still asks. Mixed Carpet + Sheet vinyl still asks. Unanswered stays open. If you cannot see it until demo, pick Field verify — do not invent a bag count here.'
 where key = 'vinyl_skim';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0298_flooring_knowledge_non_vinyl_skim.sql

-- BEGIN 0299_flooring_knowledge_illegal_leftover.sql
-- Floor King — flooring knowledge engine, pass 110.
-- Run in the Supabase SQL editor AFTER 0190–0298. Idempotent — safe to re-run.
--
-- Leftover illegal install chips were switching overlay follow-ups. Exclusive
-- solid hardwood leftover Floating hid fasteners and adhesive that unanswered
-- solid still asks. Exclusive LVP leftover Nail hid pad / expansion.
-- Exclusive engineered leftover Loose-lay hid both branches. leftover illegal chips do not switch
-- overlay follow-ups on an exclusive single hard-surface family. Mixed LVP +
-- hardwood keeps every chip. Laminate leftover Glue still coalesces to floating.
-- Do NOT SQL-gate hardwood_fasteners on install_method (0142 — mixed LVP + hardwood Nail-down must still ask fasteners).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0299_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Nail/staple jobs need fasteners. Pick the catalog item in Builder — this question only records the need. Leftover Floating on exclusive solid hardwood does not hide this — leftover illegal chips do not switch overlay follow-ups. Mixed LVP + hardwood still asks when Nail-down is in play.'
 where key = 'hardwood_fasteners';

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, or thinset — pick every hard-surface method in play. Exclusive carpet hides this hard-surface method picker. Stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Floating / Glue-down chips do not reopen it on a carpet-only job. Leftover Floating on exclusive solid hardwood does not hide fasteners or adhesive — leftover illegal chips do not switch overlay follow-ups.'
 where key = 'install_method';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0299_flooring_knowledge_illegal_leftover.sql

-- BEGIN 0300_flooring_knowledge_lvp_fasteners.sql
-- Floor King — flooring knowledge engine, pass 111.
-- Run in the Supabase SQL editor AFTER 0190–0299. Idempotent — safe to re-run.
--
-- Hardwood fasteners are nail / staple. Exclusive LVP still asked them once
-- leftover Nail-down passed SQL show_if, and live 0191 knowledge_when is
-- systems-only so the overlay systems gate stayed open after 0299 strip.
-- Hide hardwood_fasteners once the surface is exclusive LVP / laminate /
-- vinyl / tile — leftover Nail-down on LVP does not reopen. Mixed LVP +
-- hardwood still asks. Unanswered hard surface stays open.
-- Do NOT SQL-gate hardwood_fasteners on surface_type (0142 — unanswered HS and mixed LVP + hardwood must still ask fasteners).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0300_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Nail/staple jobs need fasteners. Pick the catalog item in Builder — this question only records the need. Exclusive LVP / laminate / vinyl / tile hide this — leftover Nail-down on LVP does not reopen it. Leftover Floating on exclusive solid hardwood does not hide this — leftover illegal chips do not switch overlay follow-ups. Mixed LVP + hardwood still asks when Nail-down is in play. Unanswered hard surface stays open.'
 where key = 'hardwood_fasteners';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0300_flooring_knowledge_lvp_fasteners.sql

-- BEGIN 0301_flooring_knowledge_non_carpet_pad.sql
-- Floor King — flooring knowledge engine, pass 112.
-- Run in the Supabase SQL editor AFTER 0190–0300. Idempotent — safe to re-run.
--
-- Existing pad and tack follow OLD carpet. Installing new carpet still asked
-- them once leftover families carpet kept the overlay open, even after demo
-- was exclusive LVP / hardwood / ceramic / luan / sheet vinyl. Hide
-- existing_pad and existing_tack once every demo pick is non-carpet. Carpet
-- demo still asks. Mixed Carpet + LVP still asks. None / Other / Unknown
-- stay open. Unanswered stays open.
-- Do NOT SQL-gate existing_pad on hs_demo (0142 — unanswered carpet and mixed Carpet + LVP demo must still ask pad).
-- Do NOT SQL-gate existing_tack on hs_demo (0142 — unanswered carpet and mixed Carpet + LVP demo must still ask tack).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0301_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Tearing out carpet — to carpet or to hard surface — usually takes the pad with it. Reuse only when the salesperson explicitly allows it. This follows the existing floor, not only a new-carpet job. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides this — that demo is not old carpet. None / Other / Unknown stay open. Mixed Carpet + LVP still asks. Unanswered stays open. Do not invent a second demo rate; the tear-out line gets a pad note.'
 where key = 'existing_pad';

update public.estimate_questions
   set help = 'Tearing out carpet usually takes tack strip with it. Keep is unusual. This is not new stretch-in tack strip — that stays on the install step. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides this with existing pad — that demo is not old carpet. None / Other / Unknown stay open. Mixed Carpet + LVP still asks. Unanswered stays open. Linear feet stay off until you add a catalog item. Do not invent a linear-foot price.'
 where key = 'existing_tack';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0301_flooring_knowledge_non_carpet_pad.sql

-- BEGIN 0302_flooring_knowledge_none_disposal.sql
-- Floor King — flooring knowledge engine, pass 113.
-- Run in the Supabase SQL editor AFTER 0190–0301. Idempotent — safe to re-run.
--
-- Haul-away / dumpster / curb and bulk pickup still asked after demo was
-- exclusive None. Nothing is coming up, so there is nothing to dispose.
-- Hide demo_disposal and bulk_pickup once every demo pick is None. Carpet /
-- LVP / ceramic demo still asks. Mixed None + Carpet stays open. Other /
-- Unknown stay open. Unanswered stays open.
-- Do NOT SQL-gate demo_disposal on hs_demo (0142 — unanswered demo and Carpet demo must still ask disposal).
-- Do NOT SQL-gate bulk_pickup on hs_demo (0142 — unanswered disposal and Placed at curb must still ask bulk pickup).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0302_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Haul away, dumpster, or placed at curb. Placed at curb opens bulk pickup day. Leftover Placed-on-the-curb yes-no stays off the overlay — demo_disposal is the source of truth. New construction hides this. Exclusive None demo hides this — nothing is coming up, so there is nothing to haul. Other / Unknown still ask. Unanswered stays open. Do not invent a dumpster fee.'
 where key = 'demo_disposal';

update public.estimate_questions
   set help = 'Municipal bulk pickup day so the old floor is at the curb on time. New construction hides this. Haul-away / dumpster hides this. Exclusive None demo hides this with haul-away — nothing is coming up. Unanswered disposal stays open in overlay. Leftover Placed-on-the-curb yes-no is not this question — Placed at curb on demo_disposal is. Do not invent a disposal charge here.'
 where key = 'bulk_pickup';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0302_flooring_knowledge_none_disposal.sql

-- BEGIN 0303_flooring_knowledge_tile_install_method.sql
-- Floor King — flooring knowledge engine, pass 114.
-- Run in the Supabase SQL editor AFTER 0190–0302. Idempotent — safe to re-run.
--
-- Exclusive tile still listed the hard-surface Install method picker.
-- Thinset lives on Tile setting — not Floating / Glue-down / Nail-down.
-- Hide install_method once the job is exclusive tile (floor or wall). Mixed
-- LVP + tile still asks. Unanswered hard surface stays open. Leftover
-- Floating / click does not reopen it.
-- Do NOT SQL-gate install_method on surface_type (0142 — unanswered HS and mixed LVP + tile must still ask install method).
-- Do NOT SQL-gate install_method on tile_application (0142 — unanswered floor vs wall must still ask method on mixed LVP + tile).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0303_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, or thinset — pick every hard-surface method in play. Exclusive carpet hides this hard-surface method picker. Exclusive tile also hides this — thinset stays on Tile setting, not Floating / Glue-down / Nail-down. Mixed LVP + tile still asks. Stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Floating / Glue-down chips do not reopen it on a carpet-only job. Leftover Floating on exclusive solid hardwood does not hide fasteners or adhesive — leftover illegal chips do not switch overlay follow-ups. Leftover Floating / click on exclusive tile does not reopen this.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Thinset, grout, and backer come from the catalog in Builder. This records the need — bag counts stay TBD unless a product with coverage is actually picked. Taped square feet is not bags of thinset. Exclusive tile hides the hard-surface Install method picker — thinset is this question, not Floating / Glue-down / Nail-down. Exclusive tile hides the 6-mil vapor-barrier question; crack isolation / uncoupling membranes belong here, not on that floating-floor sheet.'
 where key = 'tile_setting';

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Site AC/heat and acclimation hide too — a backsplash is not a hardwood acclimation job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, occupancy, delivery, access, and setting materials. Exclusive tile hides the hard-surface Install method picker — thinset stays on Tile setting. Exclusive floor tile also hides the 6-mil vapor-barrier question — thinset is not a click-floor vapor barrier; membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0303_flooring_knowledge_tile_install_method.sql

-- BEGIN 0304_flooring_knowledge_extra_pad_tbd.sql
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

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0304_flooring_knowledge_extra_pad_tbd.sql

-- BEGIN 0305_flooring_knowledge_extra_leftover_sqft.sql
-- Floor King — flooring knowledge engine, pass 116.
-- Run in the Supabase SQL editor AFTER 0190–0304. Idempotent — safe to re-run.
--
-- Extra pad / foam with a count or TBD sold-by unit still carried leftover
-- typed square feet onto Review takeoff as pad yards / foam feet. Review
-- takeoff ignores leftover measured sq ft on a count or TBD extra — do not
-- plant leftover sq ft as pad yards. Area-unit extras still use MEASURED sq ft.
-- Do not invent a 30-yard roll.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0305_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0305_flooring_knowledge_extra_leftover_sqft.sql

-- BEGIN 0306_flooring_knowledge_extra_count_qty.sql
-- Floor King — flooring knowledge engine, pass 117.
-- Run in the Supabase SQL editor AFTER 0190–0305. Idempotent — safe to re-run.
--
-- Extra pad / foam sold by roll / each / gal still emitted as silent TBD
-- with no quantity. A pad SKU with a count unit asks How many in that unit
-- — not taped square feet and not a 30-yard roll. Empty sold-by unit stays
-- TBD in Builder. Area-unit extras still ask MEASURED sq ft.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0306_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. A pad SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. A foam SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0306_flooring_knowledge_extra_count_qty.sql

-- BEGIN 0307_flooring_knowledge_extra_count_review.sql
-- Floor King — flooring knowledge engine, pass 118.
-- Run in the Supabase SQL editor AFTER 0190–0306. Idempotent — safe to re-run.
--
-- Extra pad / foam sold by roll / each / gal asked How many (0306) but Review
-- still skipped the extra because leftover taped sq ft is not pad yards.
-- Typed How many rides onto Review as that count — leftover taped sq ft
-- still is not pad yards and not a 30-yard roll. Empty qty stays off Review
-- (Builder still emits TBD). Do not call computeMaterialTakeoff for count extras.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0307_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. A pad SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. A foam SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0307_flooring_knowledge_extra_count_review.sql

-- BEGIN 0308_flooring_knowledge_main_pad_count.sql
-- Floor King — flooring knowledge engine, pass 119.
-- Run in the Supabase SQL editor AFTER 0190–0307. Idempotent — safe to re-run.
--
-- Main pad / foam sold by roll / each / gal still converted room square
-- feet into Review pad yards (or foam feet). Count / TBD main SKUs skip
-- area Review takeoff — leftover / job sq ft is not pad yards and not a
-- 30-yard roll. Area-unit pad still uses measured vs billing yards.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0308_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. A pad SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main pad SKU sold by roll / each / gal does not convert room square feet into pad yards on Review. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. A foam SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main foam SKU sold by roll / each / gal does not convert room square feet into foam feet on Review. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0308_flooring_knowledge_main_pad_count.sql

-- BEGIN 0309_flooring_knowledge_main_count_qty.sql
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

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. A pad SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main pad SKU sold by roll / each / gal does not convert room square feet into pad yards on Review. A main pad SKU sold by the roll / each / gal asks How many in that unit — room square feet is not pad yards and not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. A foam SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main foam SKU sold by roll / each / gal does not convert room square feet into foam feet on Review. A main foam SKU sold by the roll / each / gal asks How many in that unit — room square feet is not foam feet and not a 30-yard roll. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Exclusive laminate leftover Glue-down does not show this — laminate is floating. Exclusive sheet vinyl leftover Floating still asks this — sheet vinyl is glue-down. Carpet-only leftover Glue-down does not show this — carpet glue is on Carpet install. Mixed LVP still asks. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. A glue SKU sold by the gal / kit / each asks How many in that unit — taped square feet is not a glue order. Do not invent coverage.'
 where key = 'adhesive';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0309_flooring_knowledge_main_count_qty.sql

-- BEGIN 0310_flooring_knowledge_stair_wrap_qty.sql
-- Floor King — flooring knowledge engine, pass 121.
-- Run in the Supabase SQL editor AFTER 0190–0309. Idempotent — safe to re-run.
--
-- Hard-surface stair wrap extra boxes were still silent wrap qty TBD even
-- when the wrap SKU is sold by the box / each / roll. A count wrap SKU
-- asks How many in that unit — not 8 sq ft/step and not leftover taped
-- square feet. Area-unit wrap stays wrap qty TBD (do not convert steps × 8).
-- Empty How many stays wrap qty TBD so Builder cannot reopen an area order.
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + wall tile still asks stairs on the floor rooms).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0310_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0310_flooring_knowledge_stair_wrap_qty.sql

-- BEGIN 0311_flooring_knowledge_prep_count_review.sql
-- Floor King — flooring knowledge engine, pass 122.
-- Run in the Supabase SQL editor AFTER 0190–0310. Idempotent — safe to re-run.
--
-- Self-level bags and subfloor sheets were derived from measured area but
-- stayed off Review, so taped square feet looked like the order. Review
-- prints the bag / sheet count — taped square feet is not a bag order and
-- not a plywood order. Missing coverage stays off Review (Builder still
-- withholds). Field verify still withholds. Do not invent 1/4 inch or a
-- 4×8 (32 sq ft) sheet. Builder still carries coverage + area so the bag
-- calculator stays live.
-- Do NOT SQL-gate selflevel_needed on tile_application (0142 — mixed LVP + wall tile still asks bags on the floor rooms).
-- Do NOT SQL-gate subfloor_needed on surface_type (0142 — mixed jobs still ask sheets on hard-surface rooms).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0311_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Bag count uses Settings coverage at the chosen pour. Pour is the shop default, else the coverage reference — we do not invent 1/4 inch. Field verify withholds bags. Review prints the bag count — taped square feet is not a bag order. Do not invent coverage.'
 where key = 'selflevel_needed';

update public.estimate_questions
   set help = 'Yes emits 4×8 sheets only when Settings has sheet_sqft. Missing coverage is TBD — we do not invent 32 sq ft per sheet. Field verify withholds the count. Exclusive Concrete hides this — a slab is not a plywood overlay. Plywood / wood / existing flooring / Unknown still ask. Self-level stays on Floor prep. Review prints the sheet count — taped square feet is not a plywood order.'
 where key = 'subfloor_needed';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0311_flooring_knowledge_prep_count_review.sql

-- BEGIN 0312_flooring_knowledge_boxed_carton_area.sql
-- Floor King — flooring knowledge engine, pass 123.
-- Run in the Supabase SQL editor AFTER 0190–0311. Idempotent — safe to re-run.
--
-- A boxed LVP / hardwood SKU sold by the carton with catalog coverage still
-- takeoffs from measured area. Carton math uses sqft_per_box — we do not
-- invent a box size and we do not treat leftover taped sq ft as How many
-- boxes. Missing coverage stays TBD. Wrap extras sold by the box still ask
-- How many (0310) — this pass is floor-map / main flooring emit only.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0312_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size.'
 where kind = 'floor_map';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0312_flooring_knowledge_boxed_carton_area.sql

-- BEGIN 0313_flooring_knowledge_carpet_tile_carton.sql
-- Floor King — flooring knowledge engine, pass 124.
-- Run in the Supabase SQL editor AFTER 0190–0312. Idempotent — safe to re-run.
--
-- Exclusive carpet tile sold by the carton with catalog coverage still
-- takeoffs from measured area (sq yd + carton math). Leftover taped sq ft
-- is not How many boxes. Missing coverage stays TBD; do not invent a box
-- size. Stretch-in / glue-down / mixed stretch-in + tile still wait for
-- cuts. Wrap extras sold by the box still ask How many (0310).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0313_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size.'
 where kind = 'floor_map';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0313_flooring_knowledge_carpet_tile_carton.sql

-- BEGIN 0314_flooring_knowledge_carton_tbd_review.sql
-- Floor King — flooring knowledge engine, pass 125.
-- Run in the Supabase SQL editor AFTER 0190–0313. Idempotent — safe to re-run.
--
-- Review was still printing taped square feet as the order when a boxed
-- LVP / hardwood / carpet-tile SKU is sold by the carton but coverage is
-- missing. Missing coverage stays TBD — not How many boxes from leftover
-- taped sq ft, and not measured-plus-waste as if it were billed by the foot.
-- Coverage on the SKU still takeoffs from measured area. Wrap extras sold
-- by the box still ask How many (0310).
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0314_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0314_flooring_knowledge_carton_tbd_review.sql

-- BEGIN 0315_flooring_knowledge_carton_tbd_builder.sql
-- Floor King — flooring knowledge engine, pass 126.
-- Run in the Supabase SQL editor AFTER 0190–0314. Idempotent — safe to re-run.
--
-- Builder was still treating carton-coverage TBD flooring lines as AREA
-- (category stays lvp / hardwood / carpet). Leftover taped sq ft must not
-- reopen as the order. Builder carton-coverage TBD is How many / Unit TBD,
-- never taped square feet. Coverage on the SKU still takeoffs from measured
-- area. Wrap extras sold by the box still ask How many (0310).
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0315_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0315_flooring_knowledge_carton_tbd_builder.sql

-- BEGIN 0316_flooring_knowledge_count_tbd_builder.sql
-- Floor King — flooring knowledge engine, pass 127.
-- Run in the Supabase SQL editor AFTER 0190–0315. Idempotent — safe to re-run.
--
-- Builder was still treating main / extra count SKU and qty TBD flooring
-- lines as AREA because category stays lvp / hardwood / carpet. Leftover
-- taped sq ft must not reopen as the order. Builder count SKU / qty TBD
-- lines are How many / Unit TBD, never taped square feet. Typed wrap How
-- many stays How many in Builder (not 8 sq ft/step). Coverage on a boxed
-- SKU still takeoffs from measured area. Wrap extras sold by the box
-- still ask How many (0310). extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0316_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0316_flooring_knowledge_count_tbd_builder.sql

-- BEGIN 0317_flooring_knowledge_pick_boxed_area.sql
-- Floor King — flooring knowledge engine, pass 128.
-- Run in the Supabase SQL editor AFTER 0190–0316. Idempotent — safe to re-run.
--
-- Picking a boxed LVP / hardwood SKU in Builder planted catalog unit box as
-- How many and stripped wrap / carton-coverage TBD / qty TBD stamps, so
-- leftover taped square feet could reopen as the order. Picking a boxed SKU
-- with coverage still takeoffs from measured area — catalog unit box is not
-- How many boxes. Wrap extras stay How many even when the wrap SKU has
-- carton coverage (0310). extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0317_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0317_flooring_knowledge_pick_boxed_area.sql

-- BEGIN 0318_flooring_knowledge_po_carton_count.sql
-- Floor King — flooring knowledge engine, pass 129.
-- Run in the Supabase SQL editor AFTER 0190–0317. Idempotent — safe to re-run.
--
-- Picking a boxed wrap / carton-coverage TBD / qty TBD SKU copied sq ft/box
-- onto a How many line, so PO / warehouse / work-order carton math treated
-- 8 boxes as 8 sq ft and printed 1 carton. PO / warehouse / work-order carton
-- math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD /
-- qty TBD How many — those are already the order, not taped square feet.
-- Area-billed LVP / hardwood with coverage still carton-maths from measured
-- sq ft. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0318_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0318_flooring_knowledge_po_carton_count.sql

-- BEGIN 0319_flooring_knowledge_hydrate_count_sqft.sql
-- Floor King — flooring knowledge engine, pass 130.
-- Run in the Supabase SQL editor AFTER 0190–0318. Idempotent — safe to re-run.
--
-- Reloading Builder recovered wrap How many into sqft when the wrap SKU had
-- an empty / area unit (isAreaUnit("") is true). Builder hydrate does not
-- plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD —
-- leftover quantity is not measured area. Switching those lines to sq ft
-- stays How many. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0319_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0319_flooring_knowledge_hydrate_count_sqft.sql

-- BEGIN 0320_flooring_knowledge_unit_tbd_hydrate.sql
-- Floor King — flooring knowledge engine, pass 131.
-- Run in the Supabase SQL editor AFTER 0190–0319. Idempotent — safe to re-run.
--
-- Reloading Builder recovered Unit TBD adhesive / pad / AI addon How many
-- into sqft because empty unit is treated as area globally. Builder hydrate
-- does not plant How many as taped sq ft on Unit TBD (empty unit) count
-- lines — leftover quantity is not measured area. Flooring still recovers
-- Amount into sqft. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0320_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0320_flooring_knowledge_unit_tbd_hydrate.sql

-- BEGIN 0321_flooring_knowledge_customer_identity.sql
-- Floor King — flooring knowledge engine, pass 132.
-- Run in the Supabase SQL editor AFTER 0190–0320. Idempotent — safe to re-run.
--
-- Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer copy is the product name, not How many and not measured square feet. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0321_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0321_flooring_knowledge_customer_identity.sql

-- BEGIN 0322_flooring_knowledge_unit_tbd_qty.sql
-- Floor King — flooring knowledge engine, pass 133.
-- Run in the Supabase SQL editor AFTER 0190–0321. Idempotent — safe to re-run.
--
-- Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. 0320 hydrate cleared leftover sqft on Builder reload; invoice / work-order / estimate totals still billed leftover taped sq ft until this pass. Flooring still recovers Amount into sqft. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0322_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0322_flooring_knowledge_unit_tbd_qty.sql

-- BEGIN 0323_flooring_knowledge_customer_notes.sql
-- Floor King — flooring knowledge engine, pass 134.
-- Run in the Supabase SQL editor AFTER 0190–0322. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0323_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0323_flooring_knowledge_customer_notes.sql

-- BEGIN 0324_flooring_knowledge_customer_takeoff.sql
-- Floor King — flooring knowledge engine, pass 135.
-- Run in the Supabase SQL editor AFTER 0190–0323. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0324_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0324_flooring_knowledge_customer_takeoff.sql

-- BEGIN 0325_flooring_knowledge_customer_rooms.sql
-- Floor King — flooring knowledge engine, pass 136.
-- Run in the Supabase SQL editor AFTER 0190–0324. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0325_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0325_flooring_knowledge_customer_rooms.sql

-- BEGIN 0326_flooring_knowledge_customer_line_notes.sql
-- Floor King — flooring knowledge engine, pass 137.
-- Run in the Supabase SQL editor AFTER 0190–0325. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0326_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0326_flooring_knowledge_customer_line_notes.sql

-- BEGIN 0327_flooring_knowledge_customer_uncertainty.sql
-- Floor King — flooring knowledge engine, pass 138.
-- Run in the Supabase SQL editor AFTER 0190–0326. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0327_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0327_flooring_knowledge_customer_uncertainty.sql

-- BEGIN 0328_flooring_knowledge_mixed_new_build.sql
-- Floor King — flooring knowledge engine, pass 139.
-- Run in the Supabase SQL editor AFTER 0190–0327. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0328_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0328_flooring_knowledge_mixed_new_build.sql

-- BEGIN 0329_flooring_knowledge_customer_prep_confidence.sql
-- Floor King — flooring knowledge engine, pass 140.
-- Run in the Supabase SQL editor AFTER 0190–0328. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0329_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0329_flooring_knowledge_customer_prep_confidence.sql

-- BEGIN 0330_flooring_knowledge_customer_site_prep.sql
-- Floor King — flooring knowledge engine, pass 141.
-- Run in the Supabase SQL editor AFTER 0190–0329. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0330_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0330_flooring_knowledge_customer_site_prep.sql

-- BEGIN 0331_flooring_knowledge_customer_stair_steps.sql
-- Floor King — flooring knowledge engine, pass 142.
-- Run in the Supabase SQL editor AFTER 0190–0330. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0331_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0331_flooring_knowledge_customer_stair_steps.sql

-- BEGIN 0332_flooring_knowledge_customer_prep_suffix.sql
-- Floor King — flooring knowledge engine, pass 143.
-- Run in the Supabase SQL editor AFTER 0190–0331. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0332_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0332_flooring_knowledge_customer_prep_suffix.sql

-- BEGIN 0333_flooring_knowledge_customer_line_steps.sql
-- Floor King — flooring knowledge engine, pass 144.
-- Run in the Supabase SQL editor AFTER 0190–0332. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0333_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0333_flooring_knowledge_customer_line_steps.sql

-- BEGIN 0334_flooring_knowledge_customer_review_headers.sql
-- Floor King — flooring knowledge engine, pass 145.
-- Run in the Supabase SQL editor AFTER 0190–0333. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0334_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0334_flooring_knowledge_customer_review_headers.sql

-- BEGIN 0335_flooring_knowledge_customer_review_buckets.sql
-- Floor King — flooring knowledge engine, pass 146.
-- Run in the Supabase SQL editor AFTER 0190–0334. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0335_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0335_flooring_knowledge_customer_review_buckets.sql

-- BEGIN 0336_flooring_knowledge_customer_review_steps.sql
-- Floor King — flooring knowledge engine, pass 147.
-- Run in the Supabase SQL editor AFTER 0190–0335. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0336_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0336_flooring_knowledge_customer_review_steps.sql

-- BEGIN 0337_flooring_knowledge_customer_stair_types.sql
-- Floor King — flooring knowledge engine, pass 148.
-- Run in the Supabase SQL editor AFTER 0190–0336. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0337_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0337_flooring_knowledge_customer_stair_types.sql

-- BEGIN 0338_flooring_knowledge_customer_count_qty.sql
-- Floor King — flooring knowledge engine, pass 149.
-- Run in the Supabase SQL editor AFTER 0190–0337. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0338_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0338_flooring_knowledge_customer_count_qty.sql

-- BEGIN 0339_flooring_knowledge_customer_dash_qty.sql
-- Floor King — flooring knowledge engine, pass 150.
-- Run in the Supabase SQL editor AFTER 0190–0338. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0339_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0339_flooring_knowledge_customer_dash_qty.sql

-- BEGIN 0340_flooring_knowledge_customer_bare_qty.sql
-- Floor King — flooring knowledge engine, pass 151.
-- Run in the Supabase SQL editor AFTER 0190–0339. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0340_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0340_flooring_knowledge_customer_bare_qty.sql

-- BEGIN 0341_flooring_knowledge_customer_dimensions.sql
-- Floor King — flooring knowledge engine, pass 152.
-- Run in the Supabase SQL editor AFTER 0190–0340. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0341_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0341_flooring_knowledge_customer_dimensions.sql

-- BEGIN 0342_flooring_knowledge_customer_product_ft.sql
-- Floor King — flooring knowledge engine, pass 153.
-- Run in the Supabase SQL editor AFTER 0190–0341. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0342_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0342_flooring_knowledge_customer_product_ft.sql

-- BEGIN 0343_flooring_knowledge_customer_paren_ft.sql
-- Floor King — flooring knowledge engine, pass 154.
-- Run in the Supabase SQL editor AFTER 0190–0342. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0343_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0343_flooring_knowledge_customer_paren_ft.sql

-- BEGIN 0344_flooring_knowledge_customer_paren_qty.sql
-- Floor King — flooring knowledge engine, pass 155.
-- Run in the Supabase SQL editor AFTER 0190–0343. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0344_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0344_flooring_knowledge_customer_paren_qty.sql

-- BEGIN 0345_flooring_knowledge_customer_dash_paren.sql
-- Floor King — flooring knowledge engine, pass 156.
-- Run in the Supabase SQL editor AFTER 0190–0344. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. extraAsksCountQty(lvp + box) stays true. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0345_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0345_flooring_knowledge_customer_dash_paren.sql

-- BEGIN 0346_flooring_knowledge_customer_lead_qty.sql
-- Floor King — flooring knowledge engine, pass 157.
-- Run in the Supabase SQL editor AFTER 0190–0345. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. extraAsksCountQty(lvp + box) stays true. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0346_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0346_flooring_knowledge_customer_lead_qty.sql

-- BEGIN 0347_flooring_knowledge_customer_lead_ft.sql
-- Floor King — flooring knowledge engine, pass 158.
-- Run in the Supabase SQL editor AFTER 0190–0346. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. extraAsksCountQty(lvp + box) stays true. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0347_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0347_flooring_knowledge_customer_lead_ft.sql

-- BEGIN 0348_flooring_knowledge_customer_trail_ft.sql
-- Floor King — flooring knowledge engine, pass 159.
-- Run in the Supabase SQL editor AFTER 0190–0347. Idempotent — safe to re-run.
--
-- Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. extraAsksCountQty(lvp + box) stays true. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0348_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'hs_plank_stairs';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12'' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12'' product names stay. 5mm product names stay.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count in EACH. Uses Floor King''s pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0348_flooring_knowledge_customer_trail_ft.sql
COMMIT;
