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

begin;

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

commit;
