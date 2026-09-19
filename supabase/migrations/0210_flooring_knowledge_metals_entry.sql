-- Floor King — flooring knowledge engine, pass 21.
-- Run in the Supabase SQL editor AFTER 0190–0209. Idempotent — safe to re-run.
--
-- Carpet doorway metals were a Yes/No with unkeyed type/color follow-ups, so
-- the estimator never captured HOW MANY transitions. Site access (lockbox /
-- homeowner / key) had no key, so review could not file it as scheduling.
-- Occupancy, access conditions, heavy furniture, and climate control already
-- exist on both Carpet and Hard surface — reaffirm knowledge_when so a
-- leftover overlay cannot hide them.
--
--   1. metals_qty — count in EACH after metals_needed Yes. Notes only; do not
--      invent a gripper/flat-metal price. Type and color stay as follow-ups.
--   2. Key Site access as crew_entry (how the crew gets in — not the same as
--      upper-floor / elevator access_conditions).
--   3. Key Metal type / Metal color so review buckets stay ACCESSORY.
--   4. Occupancy / access_conditions / furniture_heavy / climate_control keep
--      show_if Carpet + Hard surface. Climate is install conditions for every
--      path; the acclimation WARNING still fires only on hardwood / glue.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0210_FLOORING_KNOWLEDGE

begin;

-- How many carpet transitions? EACH, never square feet. No invented $ rate.
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0210a001-c0de-4000-8000-000000000001',
       'Carpet',
       'How many metals / transitions?',
       'Count of doorways or edges that need gripper or flat metal, in EACH. Never square feet. Type and color are next. Pick a catalog metal in Builder — this does not invent a price.',
       'number', 'metals_qty', false, true, 113,
       '{"note":true,"purpose":"ACCESSORY","knowledge_when":{"families":["carpet"],"require":{"key":"metals_needed","in":["Yes"]},"purpose":"ACCESSORY"},"show_if":{"key":"metals_needed","in":["Yes"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'metals_qty');

-- Metal type / color already exist from 0107 with no key.
update public.estimate_questions
   set key = 'metal_type',
       position = 114,
       help = 'Gripper (tack) or flat metal. Count is on the previous step — this is type only, not a second price.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"ACCESSORY"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"require":{"key":"metals_needed","in":["Yes"]},"purpose":"ACCESSORY"}'::jsonb
       )
 where (label = 'Metal type' and (key is null or key = '' or key = 'metal_type'));

update public.estimate_questions
   set key = 'metal_color',
       position = 115,
       help = 'Silver / titanium / gold as a crew note. Not a catalog SKU.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"ACCESSORY"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"require":{"key":"metals_needed","in":["Yes"]},"purpose":"ACCESSORY"}'::jsonb
       )
 where (label = 'Metal color' and (key is null or key = '' or key = 'metal_color'));

-- Site access = how the crew gets in (lockbox / homeowner / key). Distinct from
-- access_conditions (upper floor / elevator / long carry).
update public.estimate_questions
   set key = 'crew_entry',
       help = 'Lockbox, homeowner present, or key at the office. Scheduling note — not a price. Upper floor / elevator / long carry is the Access conditions question.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"SCHEDULING"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"SCHEDULING"}'::jsonb
       )
 where id = '53f852a3-dff5-4b24-b933-637cb31d8c18'
    or (label = 'Site access' and (key is null or key = '' or key = 'crew_entry'));

-- Occupancy / access / heavy furniture / climate: both paths. Climate is an
-- install-condition capture on every job; the acclimation warning still reads
-- hardwood / glue-down only and does not invent a day count.
update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"SCHEDULING"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"SCHEDULING"}'::jsonb
       )
 where key in ('occupancy', 'access_conditions');

update public.estimate_questions
   set config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{purpose}',
           '"SCOPE"'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"SCOPE"}'::jsonb
       )
 where key = 'furniture_heavy';

update public.estimate_questions
   set help = 'AC and heat on site. Hardwood and glue-down need both to acclimate or bond — the warning only fires then. Stretch-in and floating still capture it as an install condition, not a price.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{purpose}',
             '"INSTALLATION"'::jsonb
           ),
           '{knowledge_when}',
           '{"purpose":"INSTALLATION"}'::jsonb
         ),
         '{show_if}',
         '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
       )
 where key = 'climate_control'
    or id = '4f2ec418-e4bf-4019-bf99-65dbc5de025f';

commit;
