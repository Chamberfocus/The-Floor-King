-- Floor King CRM — questionnaire: multiple demo types per area, multi-select
-- floor prep, and a new "Prime the floor" prep option. Config-only (updates the
-- estimate_questions rows the builder already renders). Idempotent, reversible.

-- #6 — Hard-surface Tear-out becomes multi-row ("choice_areas"): each demo type
--      gets its OWN area, so one job can be part carpet, part ceramic, etc., with
--      the amount for each. The renderer + line emitter already handle this mode.
update public.estimate_questions
   set config = jsonb_set(config, '{per_area}', 'true'::jsonb)
 where config -> 'options' @> '[{"emit":{"description":"Tear-out — ceramic w/ mortar bed"}}]';

-- #7a — Floor prep questions become MULTI-select, so skim coat AND self-leveling
--       AND prime can be chosen together (not either/or). Emitter already outputs
--       one line per selected option.
update public.estimate_questions
   set config = jsonb_set(config, '{multi}', 'true'::jsonb)
 where config -> 'options' @> '[{"emit":{"description":"Floor prep — self-leveling"}}]';

-- #7b — add "Prime the floor" alongside skim coat / self-leveling / grinding.
--       (Its own separate labor line, per sq ft; rate editable in the builder.)
update public.estimate_questions
   set config = jsonb_set(
         config,
         '{options}',
         (config -> 'options')
           || '[{"label":"Prime the floor","emit":{"per":"area","cost":0.4,"role":"labor","unit":"sqft","category":"labor","description":"Floor prep — prime the floor"}}]'::jsonb
       )
 where config -> 'options' @> '[{"emit":{"description":"Floor prep — self-leveling"}}]'
   and not (config -> 'options' @> '[{"label":"Prime the floor"}]');
