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

begin;

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

commit;
