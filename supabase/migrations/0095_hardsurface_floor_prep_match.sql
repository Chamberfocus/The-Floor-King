-- Give the hard-surface prep question the same options as carpet (Patch/skim,
-- Self-leveling, Grinding, Other + describe note) and matching label. Idempotent.
update public.estimate_questions
set kind = 'choice',
    label = 'Floor prep / leveling needed?',
    config = '{"note":true,"multi":false,"per_room":true,"show_if":{"in":["Hard surface"],"key":"project_type"},"options":[{"label":"None"},{"label":"Patch / skim coat","emit":{"per":"area","cost":0.75,"role":"labor","unit":"sqft","category":"labor","description":"Floor prep — patch / skim coat"}},{"label":"Self-leveling","emit":{"per":"area","cost":1.5,"role":"labor","unit":"sqft","category":"labor","description":"Floor prep — self-leveling"}},{"label":"Grinding / high spots","emit":{"per":"area","cost":0.75,"role":"labor","unit":"sqft","category":"labor","description":"Floor prep — grinding"}},{"label":"Other (describe below)"}]}'::jsonb
where section = 'Hard surface' and label ilike '%prep%';
