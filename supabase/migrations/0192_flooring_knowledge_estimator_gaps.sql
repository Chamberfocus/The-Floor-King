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

begin;

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

commit;
