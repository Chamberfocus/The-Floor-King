-- Floor King CRM — per-room-aware gating: later questions recognize what you
-- entered per room and stop re-asking. Pairs with a questionnaire engine change
-- that folds per-room overrides into show_if evaluation. Config-only, idempotent;
-- already applied to the live DB.

-- Give the per-room questions keys so downstream gates can read them.
update public.estimate_questions set key = 'hs_prep'
 where label = 'Floor prep / leveling needed?' and config -> 'show_if' -> 'in' ? 'Hard surface';
update public.estimate_questions set key = 'hs_demo'
 where label = 'Demo — what type?';

-- Self-leveler bag flow appears ONLY when a room's prep includes Self-leveling
-- (was asked for every hard-surface job regardless).
update public.estimate_questions
   set config = jsonb_set(config, '{show_if}', '{"in":["Self-leveling"],"key":"hs_prep"}'::jsonb)
 where label = 'Self-leveler — count the bags?';

-- Demo disposal appears ONLY when a room actually has demo — any non-None type
-- (was asked for every hard-surface job regardless).
update public.estimate_questions
   set config = jsonb_set(
         config, '{show_if}',
         '{"in":["Carpet","Ceramic WITH mortar bed","Ceramic WITHOUT mortar bed","Sheet vinyl","Luan","LVP","Laminate","Glue-down hardwood","Nailed hardwood","Other"],"key":"hs_demo"}'::jsonb)
 where label = 'Demo disposal';
