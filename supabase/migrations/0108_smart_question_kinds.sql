-- Floor King CRM — smart auto-calc question kinds for the guided questionnaire.
-- Seeds: cuts (carpet yardage), stairs (labor + carpet), subfloor (sheets),
-- selflevel (bags). Run in Supabase: SQL Editor -> paste -> Run. Idempotent.
-- COSTS/ALLOWANCES BELOW ARE SEEDED PLACEHOLDERS — verify them in
-- Settings -> Estimate questions against your real numbers.

-- 1) Retire the simpler questions these supersede (kept in the table, hidden).
update public.estimate_questions set active = false
  where (section = 'Carpet' and label = 'What carpet?')
     or (section = 'Carpet' and label = 'How many steps? (choose the type)')
     or (section = 'Hard surface' and label = 'Subfloor height');

-- 2) CUTS — carpet cuts (length × 12'/15' roll) → total sq yd to order. Carries
--    its own carpet product pick (supports different carpet per area).
insert into public.estimate_questions (section, label, help, kind, config, key, required, position)
select 'Carpet','Carpet & cuts','Pick the carpet and enter each cut (length × 12'' or 15'' roll). We total the square yardage to order.','cuts',
  '{"category":"carpet","ask_source":true,"widths":[12,15],"show_if":{"key":"project_type","in":["Carpet"]}}'::jsonb,
  null, false, 18
where not exists (select 1 from public.estimate_questions where kind = 'cuts');

-- 3) STAIRS — step count + wrap style → step labor + the carpet the steps use.
--    option.cost = labor $/step; option.carpet_sqft = carpet allowance per step.
insert into public.estimate_questions (section, label, help, kind, config, key, required, position)
select 'Carpet','Stairs','How many steps, and the wrap style? We add the step labor and the carpet the stairs consume.','stairs',
  '{"show_if":{"key":"project_type","in":["Carpet"]},"carpet_cost_per_yd":0,"options":[{"label":"Waterfall","cost":18,"carpet_sqft":6},{"label":"Upholstered","cost":28,"carpet_sqft":8}]}'::jsonb,
  null, false, 81
where not exists (select 1 from public.estimate_questions where kind = 'stairs');

-- 4) SUBFLOOR — thickness → sheets = ceil(room sq ft ÷ 32). Shown when subfloor
--    is needed (chains off the existing "Subfloor needed?" question).
insert into public.estimate_questions (section, label, help, kind, config, key, required, position)
select 'Hard surface','Subfloor — thickness & sheets','We figure the 4×8 sheets per room (rounded up).','subfloor',
  '{"sheet_sqft":32,"show_if":{"key":"subfloor_needed","in":["Yes"]},"options":[{"label":"1/4\"","cost":11},{"label":"3/8\"","cost":13},{"label":"1/2\"","cost":15},{"label":"3/4\"","cost":18}]}'::jsonb,
  null, false, 261
where not exists (select 1 from public.estimate_questions where kind = 'subfloor');

-- 5) SELF-LEVELER — bags from area ÷ coverage-at-thickness. Gated by a yes/no so
--    it only counts bags when you're actually self-leveling. (Labor stays on the
--    "Floor prep" question — no double-charge.)
insert into public.estimate_questions (section, label, help, kind, config, key, required, position)
select 'Hard surface','Self-leveler — count the bags?',null,'yesno',
  '{"show_if":{"key":"project_type","in":["Hard surface"]}}'::jsonb,
  'selflevel_needed', false, 256
where not exists (select 1 from public.estimate_questions where key = 'selflevel_needed');

insert into public.estimate_questions (section, label, help, kind, config, key, required, position)
select 'Hard surface','Self-leveler bags','Bags = area ÷ coverage at the chosen pour thickness.','selflevel',
  '{"coverage_sqft":50,"coverage_thickness_in":0.125,"default_thickness_in":0.25,"bag_cost":22,"show_if":{"key":"selflevel_needed","in":["Yes"]}}'::jsonb,
  null, false, 257
where not exists (select 1 from public.estimate_questions where kind = 'selflevel');
