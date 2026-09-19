-- Floor King — flooring knowledge engine, pass 18.
-- Run in the Supabase SQL editor AFTER 0190–0206. Idempotent — safe to re-run.
--
-- Removal and site conditions the estimator always needs, without a second price:
--   1. Glued vs floating (existing_bond) is only about tearing up LVP / laminate /
--      sheet vinyl. 0191 already gated show_if that way; overlay had no require,
--      so a carpet-only stretch-in job still looked like it should ask "is it
--      glued?" Live knowledge_when must match so a leftover overlay cannot
--      keep that question in play after demo is Carpet / ceramic / hardwood.
--      Demo rates stay the existing per-material lines — this is still a
--      scope flag, not a second tear-out SKU.
--   2. Doors to shave and furniture moving were the original carpet questions
--      (0076) merged onto both paths (0085/0142). Reaffirm Carpet + Hard surface
--      so a knowledge-engine apply sequence does not depend on re-running 0085.
--      Count doors in EACH; furniture uses existing light/medium/heavy labor.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0207_FLOORING_KNOWLEDGE

begin;

-- Glued vs floating only after a demo type that can be either.
update public.estimate_questions
   set help = 'Glued LVP / laminate / sheet vinyl is a different tear-out than floating click. Scope note — existing demo rates stay. Carpet, ceramic, and nailed hardwood already named the bond on the demo pick.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"hs_demo","in":["LVP","Laminate","Sheet vinyl","LVP / Vinyl"]}'::jsonb
           ),
           '{purpose}',
           '"LABOR"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"LABOR","require":{"key":"hs_demo","in":["LVP","Laminate","Sheet vinyl","LVP / Vinyl"]}}'::jsonb
       )
 where key = 'existing_bond';

-- Door undercut — EACH, either path. Existing $15/door labor stays.
update public.estimate_questions
   set help = 'Count of doors to undercut, in EACH. Never square feet. Carpet and hard surface share this — thicker new floor or a metal can bind a door.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
           ),
           '{purpose}',
           '"LABOR"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"LABOR"}'::jsonb
       )
 where key = 'doors_shave'
    or id = '911ca1f0-d0a5-4048-9b1e-2e07fde68231';

-- Furniture light/medium/heavy — existing labor rates, either path.
update public.estimate_questions
   set help = 'Light / medium / heavy uses Floor King furniture-moving labor. Pianos and pool tables stay on the specialty-items question as scope — do not double-charge. Asked on carpet and hard surface.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
           ),
           '{purpose}',
           '"LABOR"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"LABOR"}'::jsonb
       )
 where key = 'furniture_level'
    or id = 'd65f32f1-7448-4106-8cdc-3ea20cedf672';

commit;
