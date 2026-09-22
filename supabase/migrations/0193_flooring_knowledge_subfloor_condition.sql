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

begin;

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

commit;
