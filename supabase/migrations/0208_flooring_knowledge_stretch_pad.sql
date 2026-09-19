-- Floor King — flooring knowledge engine, pass 19.
-- Run in the Supabase SQL editor AFTER 0190–0207. Idempotent — safe to re-run.
--
-- Stretch-in carpet accessories were still SQL-gated on "Carpet" only:
--   1. Tack strip (0192) had overlay systems stretch_in, but show_if was every
--      carpet job. Glue-down / carpet tile should never ask keep-vs-replace
--      tack strip — they do not use it. Gate show_if on carpet_install
--      Stretch-in so leftover overlay cannot keep the question in play.
--   2. Carpet pad (0194) is the residential stretch-in product picker. Overlay
--      already hid it on glue-down / tile; live show_if must match so a
--      glue-down job does not still present a pad SKU.
--   Existing pad removal (existing_pad) stays on every carpet job — tearing
--      out old pad is not the same as selling new pad.
--   Metals / transitions stay on every carpet job (doorways still exist).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0208_FLOORING_KNOWLEDGE

begin;

-- Tack strip: stretch-in only. Keep / replace / field verify — pick a catalog
-- item in Builder rather than inventing a linear-foot price here.
update public.estimate_questions
   set help = 'Stretch-in needs tack strip. Glue-down and carpet tile hide this. Capture keep vs replace — pick a catalog item in Builder rather than inventing a linear-foot price here.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"carpet_install","in":["Stretch-in"]}'::jsonb
           ),
           '{purpose}',
           '"ACCESSORY"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"systems":["stretch_in"],"require":{"key":"carpet_install","in":["Stretch-in"]},"purpose":"ACCESSORY"}'::jsonb
       )
 where key = 'tack_strip';

-- New residential pad: stretch-in only. Glue-down / carpet tile do not use it.
update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this step — they do not use residential pad. Existing pad removal stays on the demo questions.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"carpet_install","in":["Stretch-in"]}'::jsonb
           ),
           '{purpose}',
           '"MATERIAL"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"systems":["stretch_in"],"require":{"key":"carpet_install","in":["Stretch-in"]},"purpose":"MATERIAL"}'::jsonb
       )
 where key = 'carpet_pad'
    or id = 'c96e8386-c44e-4ca1-95b9-3c24d15c9437';

commit;
