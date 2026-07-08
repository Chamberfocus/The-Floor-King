-- Floor King CRM — hard-surface questionnaire (conditional + per-room), seeded
-- as editable data. Run in Supabase: SQL Editor -> paste -> Run. Idempotent.
-- Requires 0076 (questions table) + 0080 (key column + customer_areas).

-- 1) Top-level selector: Carpet vs Hard surface. The areas question stays shared;
--    everything else is gated by this.
insert into public.estimate_questions (section, label, help, kind, config, key, required, position)
select 'Start','What are we installing?',null,'choice',
  '{"note":true,"multi":false,"options":[{"label":"Carpet"},{"label":"Hard surface"}]}'::jsonb,
  'project_type', true, 12
where not exists (select 1 from public.estimate_questions where key = 'project_type');

-- 2) Gate the existing carpet questions to project_type = Carpet (areas stays shared).
update public.estimate_questions
  set config = config || '{"show_if":{"key":"project_type","in":["Carpet"]}}'::jsonb
  where section = 'Carpet' and kind <> 'areas'
    and (config->'show_if') is null;

-- 3) Hard-surface questions. Base ones gate on project_type = Hard surface;
--    sub-questions gate on surface_type / install_method / etc. (chains work
--    because a hidden question's answer doesn't satisfy later conditions).
insert into public.estimate_questions (section, label, help, kind, config, key, required, position)
select v.section, v.label, v.help, v.kind, v.config::jsonb, v.key, v.required, v.position
from (values
  ('Hard surface','Surface type','Drives the branching questions below.','choice',
    '{"note":true,"multi":false,"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"Laminate"},{"label":"LVP / Vinyl"},{"label":"Hardwood"},{"label":"Tile"},{"label":"Engineered"}]}',
    'surface_type', true, 200),
  ('Hard surface','Install method',null,'choice',
    '{"note":true,"multi":false,"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"Floating / click"},{"label":"Glue-down"},{"label":"Nail-down"}]}',
    'install_method', false, 205),
  ('Hard surface','What flooring?','Pick the product from your catalog.','product',
    '{"category":"lvp","ask_source":true,"show_if":{"key":"project_type","in":["Hard surface"]}}',
    null, true, 210),
  ('Hard surface','Include installation?',null,'yesno',
    '{"default":true,"show_if":{"key":"project_type","in":["Hard surface"]},"emit":{"role":"labor","category":"labor","description":"Installation","unit":"sqft","per":"area","cost":2}}',
    null, false, 215),
  -- Conditional: laminate padding
  ('Hard surface','Underlayment / pad (laminate)?','Pulled from the catalog as a material.','product',
    '{"category":"underlayment","ask_source":true,"show_if":{"key":"surface_type","in":["Laminate"]}}',
    null, false, 220),
  -- Conditional: glue-down adhesive
  ('Hard surface','Adhesive (glue-down)','Which glue — pulled from the catalog.','product',
    '{"category":"other","ask_source":true,"show_if":{"key":"install_method","in":["Glue-down"]}}',
    null, false, 225),
  -- Conditional: hardwood
  ('Hard surface','Acclimation period (days)?','Recorded on the work order.','text',
    '{"show_if":{"key":"surface_type","in":["Hardwood"]}}', null, false, 230),
  ('Hard surface','Moisture mitigation method','Aqua bar or primer.','choice',
    '{"multi":false,"show_if":{"key":"surface_type","in":["Hardwood"]},"options":[{"label":"None"},{"label":"Aqua bar","emit":{"role":"material","category":"other","description":"Aqua bar moisture barrier","unit":"sqft","per":"area","cost":0.35}},{"label":"Primer","emit":{"role":"material","category":"other","description":"Moisture primer","unit":"sqft","per":"area","cost":0.4}}]}',
    null, false, 235),
  ('Hard surface','Moisture / humidity test done?',null,'yesno',
    '{"note":true,"show_if":{"key":"surface_type","in":["Hardwood"]}}', null, false, 240),
  -- Surface & prep (per-room capable)
  ('Hard surface','Over concrete or wood?',null,'choice',
    '{"note":true,"per_room":true,"multi":false,"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"Concrete"},{"label":"Wood"}]}',
    null, false, 245),
  ('Hard surface','Moisture mitigation needed?',null,'yesno',
    '{"per_room":true,"show_if":{"key":"project_type","in":["Hard surface"]},"emit":{"role":"material","category":"other","description":"Moisture mitigation","unit":"sqft","per":"area","cost":0.4}}',
    null, false, 250),
  ('Hard surface','Prep — skim coat or self-level?',null,'choice',
    '{"note":true,"per_room":true,"multi":false,"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"None"},{"label":"Skim coat","emit":{"role":"labor","category":"labor","description":"Skim coat","unit":"sqft","per":"area","cost":0.75}},{"label":"Self-level","emit":{"role":"labor","category":"labor","description":"Self-leveling","unit":"sqft","per":"area","cost":1.5}}]}',
    null, false, 255),
  ('Hard surface','Subfloor needed?',null,'yesno',
    '{"show_if":{"key":"project_type","in":["Hard surface"]}}', 'subfloor_needed', false, 260),
  ('Hard surface','Subfloor height',null,'choice',
    '{"note":true,"per_room":true,"multi":false,"show_if":{"key":"subfloor_needed","in":["Yes"]},"options":[{"label":"1/4in","emit":{"role":"material","category":"underlayment","description":"Subfloor 1/4in","unit":"sqft","per":"area","cost":0.9}},{"label":"3/8in","emit":{"role":"material","category":"underlayment","description":"Subfloor 3/8in","unit":"sqft","per":"area","cost":1.1}},{"label":"1/2in","emit":{"role":"material","category":"underlayment","description":"Subfloor 1/2in","unit":"sqft","per":"area","cost":1.3}},{"label":"3/4in","emit":{"role":"material","category":"underlayment","description":"Subfloor 3/4in","unit":"sqft","per":"area","cost":1.6}},{"label":"Other"}]}',
    null, false, 265),
  ('Hard surface','Demo — what type?',null,'choice',
    '{"note":true,"per_room":true,"multi":false,"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"None"},{"label":"Ceramic","emit":{"role":"labor","category":"labor","description":"Tear-out — ceramic","unit":"sqft","per":"area","cost":1.5}},{"label":"Carpet","emit":{"role":"labor","category":"labor","description":"Tear-out — carpet","unit":"sqft","per":"area","cost":0.5}},{"label":"LVP","emit":{"role":"labor","category":"labor","description":"Tear-out — LVP","unit":"sqft","per":"area","cost":0.6}},{"label":"Laminate","emit":{"role":"labor","category":"labor","description":"Tear-out — laminate","unit":"sqft","per":"area","cost":0.6}},{"label":"Other","emit":{"role":"labor","category":"labor","description":"Tear-out","unit":"sqft","per":"area","cost":0.75}}]}',
    null, false, 270),
  ('Hard surface','Demo disposal',null,'choice',
    '{"note":true,"multi":false,"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"Haul away","emit":{"role":"labor","category":"labor","description":"Haul-away & disposal","unit":"flat","per":"flat","cost":150}},{"label":"Dumpster","emit":{"role":"labor","category":"labor","description":"Dumpster","unit":"flat","per":"flat","cost":400}},{"label":"Customer disposes"}]}',
    null, false, 275),
  ('Hard surface','Stairs being done?',null,'yesno',
    '{"show_if":{"key":"project_type","in":["Hard surface"]}}', 'stairs', false, 280),
  ('Hard surface','Stairs — treads or matching staircase?',null,'choice',
    '{"note":true,"multi":false,"show_if":{"key":"stairs","in":["Yes"]},"options":[{"label":"Order stair treads","emit":{"role":"material","category":"trim","description":"Stair treads","unit":"each","per":"each","cost":45}},{"label":"Matching staircase + J-channel","emit":{"role":"material","category":"trim","description":"Matching staircase + J-channel","unit":"each","per":"each","cost":60}}]}',
    null, false, 285),
  ('Hard surface','Molding / trim needed',null,'choice',
    '{"multi":true,"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"Baseboard 3¼ painted","emit":{"role":"material","category":"trim","description":"Baseboard 3¼ painted","unit":"lnft","per":"flat","cost":2.2}},{"label":"Baseboard 4¼ primed","emit":{"role":"material","category":"trim","description":"Baseboard 4¼ primed","unit":"lnft","per":"flat","cost":2.6}},{"label":"Baseboard 5¼ painted","emit":{"role":"material","category":"trim","description":"Baseboard 5¼ painted","unit":"lnft","per":"flat","cost":3.1}},{"label":"Shoe (primed)","emit":{"role":"material","category":"trim","description":"Shoe molding (primed)","unit":"lnft","per":"flat","cost":0.9}},{"label":"Shoe (painted)","emit":{"role":"material","category":"trim","description":"Shoe molding (painted)","unit":"lnft","per":"flat","cost":1.1}},{"label":"Shoe (unfinished)","emit":{"role":"material","category":"trim","description":"Shoe molding (unfinished)","unit":"lnft","per":"flat","cost":0.75}},{"label":"Quarter round (primed)","emit":{"role":"material","category":"trim","description":"Quarter round (primed)","unit":"lnft","per":"flat","cost":0.9}},{"label":"Quarter round (painted)","emit":{"role":"material","category":"trim","description":"Quarter round (painted)","unit":"lnft","per":"flat","cost":1.1}},{"label":"Quarter round (unfinished)","emit":{"role":"material","category":"trim","description":"Quarter round (unfinished)","unit":"lnft","per":"flat","cost":0.75}}]}',
    null, false, 290),
  ('Hard surface','Transitions needed','Set the footage/qty per line on the next screen; note the areas.','choice',
    '{"multi":true,"note":true,"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"End cap","emit":{"role":"material","category":"trim","description":"End cap transition","unit":"each","per":"each","cost":25}},{"label":"T-mold","emit":{"role":"material","category":"trim","description":"T-mold transition","unit":"each","per":"each","cost":25}},{"label":"Reducer","emit":{"role":"material","category":"trim","description":"Reducer transition","unit":"each","per":"each","cost":28}}]}',
    null, false, 295),
  -- Shared job scope
  ('Hard surface','Haul away the old floor?',null,'yesno',
    '{"show_if":{"key":"project_type","in":["Hard surface"]},"emit":{"role":"labor","category":"labor","description":"Haul-away & disposal","unit":"sqft","per":"area","cost":0.25}}',
    null, false, 300),
  ('Hard surface','Placed on the curb?',null,'yesno',
    '{"show_if":{"key":"project_type","in":["Hard surface"]},"emit":{"role":"labor","category":"labor","description":"Old floor placed at curb","unit":"flat","per":"flat","cost":40}}',
    null, false, 305),
  ('Hard surface','Doors to shave — how many?',null,'number',
    '{"show_if":{"key":"project_type","in":["Hard surface"]},"emit":{"role":"labor","category":"labor","description":"Door shaving / undercut","unit":"each","per":"each","cost":15}}',
    null, false, 310),
  ('Hard surface','Furniture — how heavy?',null,'choice',
    '{"multi":false,"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"None"},{"label":"Light","emit":{"role":"labor","category":"labor","description":"Furniture moving (light)","unit":"flat","per":"flat","cost":50}},{"label":"Medium","emit":{"role":"labor","category":"labor","description":"Furniture moving (medium)","unit":"flat","per":"flat","cost":100}},{"label":"Heavy","emit":{"role":"labor","category":"labor","description":"Furniture moving (heavy)","unit":"flat","per":"flat","cost":200}}]}',
    null, false, 315),
  ('Hard surface','Anything else for the crew?',null,'text',
    '{"show_if":{"key":"project_type","in":["Hard surface"]}}', null, false, 320)
) as v(section,label,help,kind,config,key,required,position)
where not exists (
  select 1 from public.estimate_questions w where w.label = v.label and w.section = 'Hard surface'
);
