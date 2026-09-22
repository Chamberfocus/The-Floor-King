-- Floor King — flooring knowledge engine, pass 22.
-- Run in the Supabase SQL editor AFTER 0190–0210. Idempotent — safe to re-run.
--
-- Tack strip was keep / replace / TBD with no quantity. An estimator who
-- picks Replace still needs linear feet for purchasing — never square feet.
-- Field verify / keep existing / not needed do not invent a footage.
--
--   1. tack_strip_qty — number, ln ft, only after "Replace / new tack strip".
--      Notes only. Do not invent a linear-foot price; pick a catalog tack
--      strip in Builder if Floor King sells it.
--   2. Padding (carpet_pad) moves to 111 so the footage question sits next
--      to the condition chip (109 → 110).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0211_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set position = 111
 where key = 'carpet_pad'
    or id = 'c96e8386-c44e-4ca1-95b9-3c24d15c9437';

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0211a001-c0de-4000-8000-000000000001',
       'Carpet',
       'New tack strip — linear feet?',
       'Linear feet of new tack strip — never square feet. Leave blank or skip if you will measure on site. Pick a catalog tack-strip item in Builder rather than inventing a price here.',
       'number', 'tack_strip_qty', false, true, 110,
       '{"note":true,"purpose":"ACCESSORY","knowledge_when":{"families":["carpet"],"systems":["stretch_in"],"require":{"key":"tack_strip","in":["Replace / new tack strip"]},"purpose":"ACCESSORY"},"show_if":{"key":"tack_strip","in":["Replace / new tack strip"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'tack_strip_qty');

commit;
