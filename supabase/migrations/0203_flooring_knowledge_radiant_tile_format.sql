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

begin;

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

commit;
