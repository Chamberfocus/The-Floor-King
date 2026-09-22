-- Floor King — flooring knowledge engine, pass 7.
-- Run in the Supabase SQL editor AFTER 0190–0195. Idempotent — safe to re-run.
--
-- 1. Stair landings / open sides were gated on the deactivated
--    "Stairs being done?" yes/no (`key=stairs`). Live stair capture is the
--    carpet waterfall/upholstered step list and the hard-surface plank
--    steps. Re-gate so those follow-ups appear after a step count is entered.
-- 2. Floating underlayment used to require attached_pad already answered
--    (No / Unknown). Unanswered attached-pad hid the question. Overlay still
--    hides underlayment when attached pad is Yes.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0196_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{show_if}',
           '{"any":[{"key":"stairs","in":["Yes"]},{"key":"carpet_stairs","in":["Yes"]},{"key":"hs_plank_stairs","in":["Yes"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"MEASUREMENT","require":{"key":"stairs","in":["Yes"]}}'::jsonb
       ),
       help = 'Landings are usually measured with the rooms; this flags extra pieces and noses. Count in EACH — never square feet.',
       section = 'Stairs'
 where key in ('stair_landings', 'stair_open_sides');

update public.estimate_questions
   set help = 'Landings are usually measured with the rooms; this flags extra pieces and noses. Count in EACH — never square feet.'
 where key = 'stair_landings';

update public.estimate_questions
   set help = 'Open sides (waterfall vs wrapped) change carpet and hard-surface nosing. Capture it; pricing still uses existing stair labor/products.'
 where key = 'stair_open_sides';

-- Underlayment: floating method is enough. Attached-pad Yes is an overlay hide.
update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{show_if}',
           '{"key":"install_method","in":["Floating / click"]}'::jsonb
         ),
         '{knowledge_when}',
         '{"systems":["floating"],"attachedPad":"no","purpose":"MATERIAL"}'::jsonb
       )
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

commit;
