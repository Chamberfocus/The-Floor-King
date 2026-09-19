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

begin;

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

commit;
