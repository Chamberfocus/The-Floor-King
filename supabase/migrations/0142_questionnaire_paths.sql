-- Floor King — guided questionnaire: three clean paths, no double-asking.
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- THE PROBLEMS THIS FIXES
--
-- 1. "What are we installing?" sat at position 8, behind three questions that
--    are gated ON its answer. Visibility is computed to a fixed point, so those
--    three were hidden until you answered — then appeared BEHIND you and the
--    question you'd just answered came round a second time.
--
-- 2. Floor prep was asked TWICE. The carpet version and the hard-surface
--    version are byte-identical: same six options, same costs, same emitted
--    labor. A job with carpet and hard surface got both, and could emit two
--    sets of prep labor for the same floor.
--
-- 3. Demo was asked TWICE, and this one reached customers. The carpet path asks
--    "Tear up the old floor?" ($0.50/sqft, flat rate); the hard-surface path
--    asks "Demo — what type?" whose Carpet option is the SAME $0.50/sqft. Three
--    live estimates carry both lines — Smalley, Bakst and Abington Arms, two of
--    them approved.
--
-- 4. Disposal was asked twice too: "Haul away the old floor?" ($0.25/sqft) on
--    the carpet path, "Demo disposal" (haul $150 / dumpster $400) on the other.
--
-- 5. Sections were "Floor prep", "Flooring", "Start", "Carpet", "trim",
--    "hardsurface" — duplicated, lowercase, and out of order, so the heading
--    above a question often had nothing to do with it. Shared questions (doors,
--    furniture, AC, heat, access, timeline) sat under "Carpet" and showed that
--    heading on a hard-surface-only job.
--
-- THE SHAPE AFTER THIS
--
--   Start           what are we installing            (always)
--   Carpet          cuts · padding · stairs · metals  (carpet only)
--   Hard surface    type · method · rooms · prep-specifics (hard surface only)
--   Floor prep      asked ONCE, whichever path        (either)
--   Demo & disposal asked ONCE, whichever path        (either)
--   Site & schedule doors · furniture · climate · access · timeline (either)
--   Trims           (either)
--
-- A both-surfaces job walks Carpet, then Hard surface, then ONE shared tail.

begin;

-- 1 · START ------------------------------------------------------------------
update public.estimate_questions set position = 10, section = 'Start'
 where id = 'b273a247-8746-481d-8dee-e811b3bfcd81';  -- What are we installing?

-- 2 · CARPET -----------------------------------------------------------------
update public.estimate_questions set position = 100, section = 'Carpet' where id = 'dec741a8-e0d5-4ca1-b481-e561d40322c2'; -- Carpet & cuts
update public.estimate_questions set position = 110, section = 'Carpet' where id = 'c96e8386-c44e-4ca1-95b9-3c24d15c9437'; -- Padding
update public.estimate_questions set position = 120, section = 'Carpet' where id = 'acd9766f-4f47-4208-af64-4ef0b58e1db7'; -- Stairs
update public.estimate_questions set position = 130, section = 'Carpet' where id = 'd7ac9ebd-e76a-4274-bbb3-48b6c631cf05'; -- Metals needed?
update public.estimate_questions set position = 131, section = 'Carpet' where id = '49895620-c098-4335-b7c5-320074c7b368'; -- Metal type
update public.estimate_questions set position = 132, section = 'Carpet' where id = '195ee540-6ac9-4556-8ccb-a1f094c34b79'; -- Metal color

-- 3 · HARD SURFACE -----------------------------------------------------------
update public.estimate_questions set position = 200, section = 'Hard surface' where id = 'dbf16892-ddf3-4536-aabd-a419cb606c07'; -- Surface type
update public.estimate_questions set position = 205, section = 'Hard surface' where id = 'd31db10e-9b44-4b5d-a008-069e0d428051'; -- Install method
update public.estimate_questions set position = 208, section = 'Hard surface' where id = '78fd0c2e-eace-4625-96b2-2080d2f57d55'; -- Radiant heat
update public.estimate_questions set position = 210, section = 'Hard surface' where id = '0a53c264-85da-49e3-9635-bb2b1ed13dc1'; -- Which areas
update public.estimate_questions set position = 215, section = 'Hard surface' where id = 'f6b1987e-c8cf-4743-9075-d43aaae44ffe'; -- What's in each room
update public.estimate_questions set position = 220, section = 'Hard surface' where id = '4dd450f1-d003-445c-9135-6477f2a98e9c'; -- Laminate underlayment
update public.estimate_questions set position = 225, section = 'Hard surface' where id = '75db35d1-5b51-4a58-baeb-437c6b7c2489'; -- Adhesive
update public.estimate_questions set position = 230, section = 'Hard surface' where id = 'f5331bc8-bc96-47f4-a392-eca7d00b694a'; -- Acclimation
update public.estimate_questions set position = 235, section = 'Hard surface' where id = '9400b1d6-9e58-45f8-929d-57dc35dff3be'; -- Moisture test
update public.estimate_questions set position = 240, section = 'Hard surface' where id = 'c7bf81f2-c02f-4e92-94d9-3b3a8a7ed691'; -- Concrete or wood
update public.estimate_questions set position = 245, section = 'Hard surface' where id = '2fc7799c-030c-4276-b6fa-801cb9867082'; -- Moisture mitigation
update public.estimate_questions set position = 250, section = 'Hard surface' where id = '5f83f269-aa2a-49f9-9e8c-0796e91f8724'; -- HS stairs
update public.estimate_questions set position = 255, section = 'Hard surface' where id = '78cbe0e9-7b58-4907-8f6e-8829c507b753'; -- Toilets
update public.estimate_questions set position = 260, section = 'Hard surface' where id = '68d3a7bc-065f-4b02-b88b-e94b8776b2f7'; -- Appliances

-- 4 · FLOOR PREP — one question, either path ---------------------------------
-- The carpet copy is switched off rather than deleted: an estimate built before
-- today still points at it, and its answers stay readable.
update public.estimate_questions set active = false
 where id = '5fb4d6f4-fec4-4d26-9686-a30d00311b0d';  -- Floor prep (carpet duplicate)

update public.estimate_questions
   set position = 300, section = 'Floor prep',
       config = jsonb_set(config, '{show_if,in}', '["Carpet","Hard surface"]'::jsonb)
 where id = '8075de6f-91a3-4905-9599-f8d695472a4f';  -- Prep same across the job?

update public.estimate_questions
   set position = 310, section = 'Floor prep',
       config = jsonb_set(config, '{show_if,in}', '["Carpet","Hard surface"]'::jsonb)
 where id = '07cdad54-20d9-4bba-896f-cf0634da772c';  -- Floor prep / leveling

update public.estimate_questions set position = 320, section = 'Floor prep' where id = 'f5de4729-cf8c-46ee-a020-f541c6478923'; -- Self-leveler?
update public.estimate_questions set position = 330, section = 'Floor prep' where id = 'c1ab6a61-21db-4924-b22b-d9383fc64f75'; -- Self-leveler bags
update public.estimate_questions set position = 340, section = 'Floor prep' where id = 'd33e1543-dd77-4bd7-9d87-ff02459da84b'; -- Subfloor needed?
update public.estimate_questions set position = 350, section = 'Floor prep' where id = '05db6bbc-f571-41ad-bc49-ceaf9f60d210'; -- Subfloor sheets

-- 5 · DEMO & DISPOSAL — one question, either path ----------------------------
-- "Tear up the old floor?" and "Haul away the old floor?" are retired. The
-- hard-surface demo question already prices tear-out BY MATERIAL (carpet $0.50,
-- ceramic with mortar $2.50, nailed hardwood $1.25 …), which is both more
-- accurate and what was double-charging when a job had carpet AND hard surface.
update public.estimate_questions set active = false
 where id in (
   '7cf170ba-7ae4-4c04-b295-22c3f28ef433',  -- Tear up the old floor? (carpet)
   '9a91690f-419a-4282-b86a-580d2e54e59c',  -- Haul away the old floor? (carpet)
   'a07eb68f-91b6-4fe7-8237-bb0e9986076c'   -- Placed on the curb? (now a disposal option)
 );

update public.estimate_questions
   set position = 400, section = 'Demo & disposal',
       label = 'Demo — what''s coming up?',
       config = jsonb_set(config, '{show_if,in}', '["Carpet","Hard surface"]'::jsonb)
 where id = '789950c7-06a2-4c4b-81ca-15b5a4a54f29';

-- Disposal gains the curb option (carrying the same $40 the retired question
-- used) and a key, so the bulk-pickup-day follow-up can hang off it.
update public.estimate_questions
   set position = 410, section = 'Demo & disposal', key = 'demo_disposal',
       config = jsonb_set(
         config, '{options}',
         (config->'options') || '[{"label":"Placed at curb","emit":{"per":"flat","cost":40,"role":"labor","unit":"flat","category":"labor","description":"Old floor placed at curb"}}]'::jsonb
       )
 where id = '6990061f-e48c-4ca4-92c1-1c6ddf53c27e'
   and not (config->'options' @> '[{"label":"Placed at curb"}]'::jsonb);

-- Keep it idempotent: the position/section/key still apply on a re-run.
update public.estimate_questions
   set position = 410, section = 'Demo & disposal', key = 'demo_disposal'
 where id = '6990061f-e48c-4ca4-92c1-1c6ddf53c27e';

update public.estimate_questions
   set position = 420, section = 'Demo & disposal',
       label = 'Bulk pickup day',
       config = jsonb_set(
         jsonb_set(config, '{show_if,key}', '"demo_disposal"'::jsonb),
         '{show_if,in}', '["Placed at curb"]'::jsonb
       )
 where id = '81a746cb-5374-46d2-b828-c7f0053b3c8f';

-- 6 · SITE & SCHEDULE — shared, and no longer filed under "Carpet" -----------
update public.estimate_questions set position = 500, section = 'Site & schedule' where id = '911ca1f0-d0a5-4048-9b1e-2e07fde68231'; -- Doors to shave
update public.estimate_questions set position = 510, section = 'Site & schedule' where id = 'd65f32f1-7448-4106-8cdc-3ea20cedf672'; -- Furniture

-- AC and heat were two yes/no steps asking one thing. One multi-select answers
-- it in a single tap and still distinguishes "heat but no AC", which is what
-- the hardwood/glue-down acclimation warning actually reads.
update public.estimate_questions
   set position = 520, section = 'Site & schedule', key = 'climate_control',
       kind = 'choice',
       label = 'Climate control on site?',
       help = 'Hardwood and glue-down need both before they can acclimate or bond.',
       config = jsonb_build_object(
         'multi', true,
         'note', true,
         'options', '[{"label":"AC"},{"label":"Heat"}]'::jsonb,
         'show_if', jsonb_build_object('key','project_type','in','["Carpet","Hard surface"]'::jsonb)
       )
 where id = '4f2ec418-e4bf-4019-bf99-65dbc5de025f';
update public.estimate_questions set active = false
 where id = 'e3bcf27d-cddd-44ee-8fef-70ff38056649';  -- Heat available? (merged above)

update public.estimate_questions set position = 530, section = 'Site & schedule' where id = '53f852a3-dff5-4b24-b933-637cb31d8c18'; -- Site access
update public.estimate_questions set position = 540, section = 'Site & schedule' where id = '896ea3bf-3a6a-431c-955a-9bd137189a13'; -- Timeline

update public.estimate_questions
   set position = 550, section = 'Site & schedule',
       config = jsonb_set(config, '{show_if,in}', '["Carpet","Hard surface"]'::jsonb)
 where id = 'ffa9f440-def0-4054-a25d-352aaebcacb7';  -- Crew preference

update public.estimate_questions set position = 560, section = 'Site & schedule' where id = 'ec32c314-490a-45d8-a21f-bb5fb6fe75eb'; -- Anything else

-- 7 · TRIMS ------------------------------------------------------------------
update public.estimate_questions set position = 600, section = 'Trims'
 where id = 'b30f4e61-3b5b-4fc0-88e5-789e3cc4807b';

commit;

-- What you should see afterwards: 38 active questions (was 43), the first one
-- being "What are we installing?", and no section named "trim" or "hardsurface".
--   select position, section, key, label from public.estimate_questions
--    where active order by position;
