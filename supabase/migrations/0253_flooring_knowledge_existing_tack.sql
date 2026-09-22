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

begin;

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

commit;
