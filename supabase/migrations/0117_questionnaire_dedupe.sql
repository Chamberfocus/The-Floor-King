-- Floor King CRM — questionnaire de-duplication (BUG 3). Config-only, idempotent,
-- reversible. Each fact is now asked ONCE; nothing captured is lost (verified: the
-- Trims step already offers Stair nose + T-mold/Reducer/Threshold/J-channel).
-- Already applied to the live estimate_questions; this records the change.

-- Confirmed duplicates + folded gates → deactivate (hidden from the flow, kept for
-- history):
--   #287 "Stairnose from Versatrim?"  → the Trims step captures stair nose
--   #296 "Transitions — transition to what?" → the Trims step captures transitions
--   #250 "Moisture mitigation needed?"       → folded into the method choice (#235)
--   #280 "Stairs being done?"                → folded into the type choice (#285)
update public.estimate_questions
   set active = false
 where label in (
   'Stairnose from Versatrim?',
   'Transitions — transition to what?',
   'Moisture mitigation needed?',
   'Stairs being done?'
 );

-- Self-leveling lives in ONE place: drop it from the HARD-SURFACE floor-prep
-- choice (the bag calculator owns material + bag-based labor). Carpet keeps its
-- self-leveling (there is no bag question in the carpet flow).
update public.estimate_questions q
   set config = jsonb_set(
         config, '{options}',
         (select coalesce(jsonb_agg(o), '[]'::jsonb)
            from jsonb_array_elements(config -> 'options') o
           where o -> 'emit' ->> 'description' is distinct from 'Floor prep — self-leveling')
       )
 where label = 'Floor prep / leveling needed?'
   and config -> 'show_if' -> 'in' ? 'Hard surface';

-- Moisture "method" now covers ALL hard surface (was Hardwood-only) so it replaces
-- the removed "needed?" gate with no loss (its "None" option = not needed).
update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(config, '{show_if}', '{"in":["Hard surface"],"key":"project_type"}'::jsonb),
         '{per_room}', 'true'::jsonb)
 where label = 'Moisture mitigation method';

-- Stairs "type" now shows for all hard surface with a "No stairs" default, replacing
-- the removed yes/no gate.
update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(config, '{show_if}', '{"in":["Hard surface"],"key":"project_type"}'::jsonb),
         '{options}', '[{"label":"No stairs"}]'::jsonb || (config -> 'options'))
 where label = 'Stairs — treads or matching staircase?'
   and not (config -> 'options' @> '[{"label":"No stairs"}]');
