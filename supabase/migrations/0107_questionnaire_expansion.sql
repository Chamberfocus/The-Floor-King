-- Floor King CRM — guided questionnaire expansion. Adds the newly-requested
-- checklist questions using the EXISTING data-driven kinds (yesno / choice /
-- number / text) so they render immediately with no code change. Run in
-- Supabase: SQL Editor -> paste -> Run. Idempotent (safe to re-run).

-- 0) Give the existing curb question a stable key so the bulk-pickup-day
--    scheduling question can chain off it.
update public.estimate_questions
  set key = 'carpet_curb'
  where section = 'Carpet' and label ilike '%curb%' and key is null;

-- 1) New CARPET questions (all optional / skippable). Job-condition questions
--    carry note:true so they land on the work order, not as priced line items.
insert into public.estimate_questions (section, label, help, kind, config, key, required, position)
select v.section, v.label, v.help, v.kind, v.config::jsonb, v.key, v.required, v.position
from (values
  ('Carpet','Metals / transitions needed?','Gripper or flat metal at doorways / edges.','yesno',
    '{"note":true,"show_if":{"key":"project_type","in":["Carpet"]}}','metals_needed',false,112),
  ('Carpet','Metal type','Gripper (tack) or flat.','choice',
    '{"note":true,"multi":false,"show_if":{"key":"metals_needed","in":["Yes"]},"options":[{"label":"Gripper"},{"label":"Flat"}]}',null,false,113),
  ('Carpet','Metal color',null,'choice',
    '{"note":true,"multi":false,"show_if":{"key":"metals_needed","in":["Yes"]},"options":[{"label":"Silver"},{"label":"Titanium"},{"label":"Gold"}]}',null,false,114),
  ('Carpet','Bulk pickup day (for curb placement)','What day is the municipal bulk pickup — so the old floor is placed out on time.','text',
    '{"note":true,"show_if":{"key":"carpet_curb","in":["Yes"]}}',null,false,72),
  ('Carpet','AC available on site?','Climate control affects install conditions.','yesno',
    '{"note":true,"show_if":{"key":"project_type","in":["Carpet","Hard surface"]}}','ac_available',false,122),
  ('Carpet','Heat available on site?',null,'yesno',
    '{"note":true,"show_if":{"key":"project_type","in":["Carpet","Hard surface"]}}','heat_available',false,123),
  ('Carpet','Site access','How does the crew get in?','choice',
    '{"note":true,"multi":false,"show_if":{"key":"project_type","in":["Carpet","Hard surface"]},"options":[{"label":"Lockbox"},{"label":"Homeowner present"},{"label":"Key at office"}]}',null,false,124),
  ('Carpet','Timeline — how soon?',null,'choice',
    '{"note":true,"multi":false,"show_if":{"key":"project_type","in":["Carpet","Hard surface"]},"options":[{"label":"ASAP"},{"label":"1-2 weeks"},{"label":"3-4 weeks"},{"label":"1-2 months"},{"label":"Flexible"}]}',null,false,125)
) as v(section,label,help,kind,config,key,required,position)
where not exists (
  select 1 from public.estimate_questions w where w.label = v.label and w.section = v.section
);

-- 2) New HARD SURFACE questions.
insert into public.estimate_questions (section, label, help, kind, config, key, required, position)
select v.section, v.label, v.help, v.kind, v.config::jsonb, v.key, v.required, v.position
from (values
  ('Hard surface','Radiant heat present?','If yes, we flag it to confirm the chosen product is rated for radiant heat.','yesno',
    '{"note":true,"show_if":{"key":"project_type","in":["Hard surface"]}}','radiant_heat',false,208),
  ('Hard surface','Stairnose from Versatrim?',null,'yesno',
    '{"note":true,"show_if":{"key":"project_type","in":["Hard surface"]}}',null,false,287),
  ('Hard surface','Transitions — transition to what?','Note what each transition meets (tile, carpet, existing wood…).','text',
    '{"note":true,"show_if":{"key":"project_type","in":["Hard surface"]}}',null,false,296),
  ('Hard surface','J-channel — size & color','Size (2MM / 4-5MM / 6-7MM / 8MM / 10MM / 12MM) and color (titanium / silver / chrome / nickel).','text',
    '{"note":true,"show_if":{"key":"project_type","in":["Hard surface"]}}',null,false,297),
  ('Hard surface','Crew preference',null,'text',
    '{"note":true,"show_if":{"key":"project_type","in":["Hard surface"]}}',null,false,318)
) as v(section,label,help,kind,config,key,required,position)
where not exists (
  select 1 from public.estimate_questions w where w.label = v.label and w.section = v.section
);

-- 3) Expand the DEMO options to the full per-room list, including the
--    mortar-bed distinction (drives the floor-height risk flag) and the extra
--    substrates. Idempotent: only rewrites if the mortar-bed option is missing.
update public.estimate_questions
set config = '{"note":true,"per_room":true,"multi":false,"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"None"},{"label":"Carpet","emit":{"role":"labor","category":"labor","description":"Tear-out — carpet","unit":"sqft","per":"area","cost":0.5}},{"label":"Ceramic WITH mortar bed","emit":{"role":"labor","category":"labor","description":"Tear-out — ceramic w/ mortar bed","unit":"sqft","per":"area","cost":2.5}},{"label":"Ceramic WITHOUT mortar bed","emit":{"role":"labor","category":"labor","description":"Tear-out — ceramic","unit":"sqft","per":"area","cost":1.5}},{"label":"Sheet vinyl","emit":{"role":"labor","category":"labor","description":"Tear-out — sheet vinyl","unit":"sqft","per":"area","cost":0.6}},{"label":"Luan","emit":{"role":"labor","category":"labor","description":"Tear-out — luan","unit":"sqft","per":"area","cost":0.5}},{"label":"LVP","emit":{"role":"labor","category":"labor","description":"Tear-out — LVP","unit":"sqft","per":"area","cost":0.6}},{"label":"Laminate","emit":{"role":"labor","category":"labor","description":"Tear-out — laminate","unit":"sqft","per":"area","cost":0.6}},{"label":"Glue-down hardwood","emit":{"role":"labor","category":"labor","description":"Tear-out — glue-down hardwood","unit":"sqft","per":"area","cost":1.75}},{"label":"Nailed hardwood","emit":{"role":"labor","category":"labor","description":"Tear-out — nailed hardwood","unit":"sqft","per":"area","cost":1.25}},{"label":"Other","emit":{"role":"labor","category":"labor","description":"Tear-out","unit":"sqft","per":"area","cost":0.75}}]}'::jsonb
where section = 'Hard surface' and label = 'Demo — what type?'
  and not (config->'options') @> '[{"label":"Ceramic WITH mortar bed"}]'::jsonb;
