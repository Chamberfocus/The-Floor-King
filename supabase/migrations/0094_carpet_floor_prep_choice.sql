-- The carpet "Floor prep / leveling needed?" question was a bare yes/no, so there
-- was no way to say WHAT prep was needed. Make it a choice (like the hard-surface
-- prep question): pick the prep type (which prices the labor) plus a describe
-- note. Idempotent — matches the existing carpet prep question by section+label.
update public.estimate_questions
set kind = 'choice',
    config = '{"note":true,"multi":false,"per_room":true,"show_if":{"in":["Carpet"],"key":"project_type"},"options":[{"label":"None"},{"label":"Patch / skim coat","emit":{"per":"area","cost":0.75,"role":"labor","unit":"sqft","category":"labor","description":"Floor prep — patch / skim coat"}},{"label":"Self-leveling","emit":{"per":"area","cost":1.5,"role":"labor","unit":"sqft","category":"labor","description":"Floor prep — self-leveling"}},{"label":"Grinding / high spots","emit":{"per":"area","cost":0.75,"role":"labor","unit":"sqft","category":"labor","description":"Floor prep — grinding"}},{"label":"Other (describe below)"}]}'::jsonb
where section = 'Carpet' and label ilike '%prep%';
