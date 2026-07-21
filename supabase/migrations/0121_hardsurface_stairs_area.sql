-- Floor King CRM — hard-surface stairs become an area calculator. Pairs with a new
-- `hs_stairs` questionnaire kind: step count × sq ft/step (8 tread+riser, 4 tread-only)
-- → the flooring that wraps the stairs (material) + stair-install labor at a higher
-- per-sq-ft rate. Matching stairnose stays in the trims step. Config-only, idempotent;
-- already applied to the live DB.
update public.estimate_questions
   set kind = 'hs_stairs',
       label = 'Stairs (hard surface)',
       help = 'Steps wrapped in plank — 8 sq ft/step for tread + riser, 4 sq ft/step tread-only. Matching stairnose is set in the trims step.',
       config = (config - 'options' - 'note')
 where label in ('Stairs — treads or matching staircase?', 'Stairs (hard surface)')
   and config -> 'show_if' -> 'in' ? 'Hard surface';
