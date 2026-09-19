-- Floor King — flooring knowledge engine, pass 17.
-- Run in the Supabase SQL editor AFTER 0190–0205. Idempotent — safe to re-run.
--
-- Floor prep is one shared tail (0142): the carpet duplicate was switched off
-- and hs_prep / prep_scope were opened to Carpet + Hard surface. The knowledge
-- engine apply sequence (0190–0205) never reaffirmed those gates, and
-- "Subfloor needed?" was left on Hard surface only — so a carpet-only job
-- could pick Self-leveling on Floor prep, never see the sheet question, and
-- never record Field verify when the deck is hidden until demo.
--
-- This pass:
--   1. Reaffirms prep_scope and hs_prep on Carpet + Hard surface (0142).
--   2. Opens subfloor_needed on either path. Yes / No stay; Field verify / TBD
--      is added so we do not force a fake Yes that would emit 4×8 sheets.
--      Sheet counts still emit only on Yes (kind=subfloor), and still withhold
--      when prep_confidence is Field verify.
--   3. Reaffirms selflevel bags on hs_prep Self-leveling (0120) so a carpet
--      job that actually self-levels can count bags. Overlay require matches.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0206_FLOORING_KNOWLEDGE

begin;

-- Prep same across the job? — either path, before rooms (0142).
update public.estimate_questions
   set help = 'If prep varies by room, set it on each room. Carpet and hard surface share Floor prep — do not answer it twice.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
           ),
           '{purpose}',
           '"PREP"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP"}'::jsonb
       )
 where key = 'prep_scope'
    or id = '8075de6f-91a3-4905-9599-f8d695472a4f';

-- Floor prep / leveling — one question, either path. Existing labor rates stay.
update public.estimate_questions
   set help = 'Patch, self-level, or grind — asked once for carpet or hard surface. Bag/sheet counts stay on the follow-ups; Field verify on prep confidence withholds them.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
           ),
           '{purpose}',
           '"PREP"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP"}'::jsonb
       )
 where key = 'hs_prep'
    or id = '07cdad54-20d9-4bba-896f-cf0634da772c';

-- Subfloor needed? — either path. Field verify does not invent a sheet count.
update public.estimate_questions
   set kind = 'choice',
       help = 'Plywood / OSB underlayment sheets when the existing deck cannot stay. Carpet and hard surface share this. If you cannot see it until demo, pick Field verify / TBD — do not invent a 4×8 count.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 coalesce(config, '{}'::jsonb),
                 '{show_if}',
                 '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
               ),
               '{purpose}',
               '"PREP"'::jsonb
             ),
             '{knowledge_when}',
             '{"purpose":"PREP"}'::jsonb
           ),
           '{note}',
           'true'::jsonb
         ),
         '{options}',
         '[{"label":"Yes"},{"label":"No"},{"label":"Field verify / TBD"}]'::jsonb
       )
 where key = 'subfloor_needed'
    or (label = 'Subfloor needed?' and (key is null or key = '' or key = 'subfloor_needed'));

-- 4×8 sheets only after a real Yes — never on No or Field verify.
update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"key":"subfloor_needed","in":["Yes"]}'::jsonb
       )
 where kind = 'subfloor';

-- Bag count only when Floor prep includes Self-leveling (carpet or HS).
update public.estimate_questions
   set help = 'Count bags only when Floor prep is Self-leveling. Stretch-in carpet with None / skim hides this. Field verify on prep confidence withholds the bag count.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"hs_prep","in":["Self-leveling"]}'::jsonb
           ),
           '{purpose}',
           '"PREP"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP","require":{"key":"hs_prep","in":["Self-leveling"]}}'::jsonb
       )
 where key = 'selflevel_needed'
    or label = 'Self-leveler — count the bags?';

commit;
