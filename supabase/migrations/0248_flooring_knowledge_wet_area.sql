-- Floor King — flooring knowledge engine, pass 59.
-- Run in the Supabase SQL editor AFTER 0190–0247. Idempotent — safe to re-run.
--
-- Wet area (bath / laundry / mudroom) is SCOPE/WARNING. Catalog has no
-- waterproof column — confirm the product, do not invent a SKU or a ban.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0248_FLOORING_KNOWLEDGE

begin;

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

commit;
