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

begin;

update public.estimate_questions
   set position = 271,
       help = 'Tearing out carpet — to carpet or to hard surface — usually takes the pad with it. Reuse only when the salesperson explicitly allows it. This follows the existing floor, not only a new-carpet job. Do not invent a second demo rate; the tear-out line gets a pad note.',
       config = coalesce(config, '{}'::jsonb)
         || '{"note":true,"purpose":"LABOR","knowledge_when":{"any":[{"families":["carpet"]},{"demo":["Carpet"]}],"purpose":"LABOR"},"show_if":{"any":[{"key":"project_type","in":["Carpet"]},{"key":"hs_demo","in":["Carpet"]}]}}'::jsonb
 where key = 'existing_pad';

commit;
