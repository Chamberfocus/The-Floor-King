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

begin;

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

commit;
