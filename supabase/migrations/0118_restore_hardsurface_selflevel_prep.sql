-- Floor King CRM — restore "Self-leveling" to the HARD-SURFACE per-room prep choice.
-- Correction to 0117: that migration removed self-leveling from hard-surface prep on
-- the assumption the bag calculator owns it. It doesn't — the two are complementary:
--   * per-room prep "Self-leveling" emits the LABOR line ($1.50/sq ft, per room)
--   * the "Self-leveler bags" calculator emits the MATERIAL (bags) and sets labor to
--     0 on purpose ("labor is the prep question's job").
-- Removing it hid self-leveling from the per-room flow AND dropped its labor entirely.
-- This restores it. No material double-count (prep = labor, calculator = material).
-- Config-only, idempotent; already applied to the live estimate_questions.
update public.estimate_questions
   set config = jsonb_set(
         config, '{options}',
         -- rebuild options: drop any existing Self-leveling (idempotent), then insert it
         -- right after "Patch / skim coat" to match the carpet prep ordering.
         (
           select jsonb_agg(o order by ord)
           from (
             select o, ord from (
               select o, (row_number() over ())::int * 10 as ord
                 from jsonb_array_elements(config -> 'options') o
                where o ->> 'label' is distinct from 'Self-leveling'
             ) base
             union all
             select
               '{"label":"Self-leveling","emit":{"per":"area","cost":1.5,"role":"labor","unit":"sqft","category":"labor","description":"Floor prep — self-leveling"}}'::jsonb,
               (
                 select (row_number() over ())::int * 10 + 5
                   from jsonb_array_elements(config -> 'options') o
                  where o ->> 'label' = 'Patch / skim coat'
                  limit 1
               )
           ) merged
         )
       )
 where label = 'Floor prep / leveling needed?'
   and config -> 'show_if' -> 'in' ? 'Hard surface'
   and not (config -> 'options' @> '[{"label":"Self-leveling"}]');
