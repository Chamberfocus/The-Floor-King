-- Floor King — flooring knowledge engine, pass 2.
-- Run in the Supabase SQL editor AFTER 0190. Idempotent — safe to re-run.
--
-- Closes gaps 0190 left against the estimator workflow:
--   1. Sheet vinyl is roll goods and needs a layout/cuts capture (area ≠ order).
--   2. Tile layout (straight vs diagonal) — waste is a note, not a fake extra %.
--   3. Hardwood nail/staple fasteners as scope (no invented SKU).
--   4. Existing LVP/laminate/vinyl: glued vs floating — removal is not identical.
--   5. Stair extras must sit AFTER both carpet and hard-surface stair questions
--      so they never appear behind the salesperson.
--   6. Demo (existing conditions) moves before Floor prep.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0191_FLOORING_KNOWLEDGE

begin;

-- Stair extras: 0190 parked these at 121 (Carpet). A hard-surface job answers
-- stairs at position 250, so 121 would pop in BEHIND the salesperson.
update public.estimate_questions
   set position = 265, section = 'Stairs'
 where key = 'stair_landings';
update public.estimate_questions
   set position = 266, section = 'Stairs'
 where key = 'stair_open_sides';

-- Existing conditions before prep (still after install method, which gates
-- adhesive / underlayment without appearing behind the user).
update public.estimate_questions
   set position = 270, section = 'Demo & disposal'
 where id = '789950c7-06a2-4c4b-81ca-15b5a4a54f29'; -- Demo — what's coming up?
update public.estimate_questions
   set position = 275, section = 'Demo & disposal'
 where key = 'demo_disposal';
update public.estimate_questions
   set position = 276, section = 'Demo & disposal'
 where id = '81a746cb-5374-46d2-b828-c7f0053b3c8f'; -- Bulk pickup day

-- Sheet vinyl layout (roll goods). Kind `cuts` reuses the roll-length editor;
-- default widths are 6' / 12' (not carpet 12/15).
insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0191a001-c0de-4000-8000-000000000001',
       'Hard surface',
       'Sheet vinyl layout / cuts',
       'Sheet vinyl is roll goods. Enter cut lengths at the product width. Measured room area is not the order quantity — seams and roll width can require more.',
       'cuts', 'vinyl_layout', false, true, 216,
       '{"category":"vinyl","ask_source":true,"widths":[6,12],"install_yd":5,"purpose":"WAREHOUSE","knowledge_when":{"families":["vinyl"],"purpose":"WAREHOUSE"},"show_if":{"key":"surface_type","in":["Sheet vinyl"]}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'vinyl_layout');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0191a001-c0de-4000-8000-000000000002',
       'Hard surface',
       'Tile layout / pattern',
       'Straight vs diagonal vs a special pattern. If Floor King prices these the same, this is still a scope note for waste and labor. Do not invent a waste percent.',
       'choice', 'tile_layout', false, true, 218,
       '{"note":true,"multi":false,"purpose":"INSTALLATION","knowledge_when":{"families":["tile"],"purpose":"INSTALLATION"},"show_if":{"key":"surface_type","in":["Tile"]},"options":[{"label":"Straight"},{"label":"Diagonal / diamond"},{"label":"Herringbone / special"},{"label":"Unknown / field layout"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'tile_layout');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0191a001-c0de-4000-8000-000000000003',
       'Hard surface',
       'Fasteners (nail / staple)',
       'Nail-down and staple-down need fasteners. Capture the need — pick a catalog item in Builder rather than inventing a SKU here.',
       'choice', 'hardwood_fasteners', false, true, 228,
       '{"note":true,"multi":false,"purpose":"MATERIAL","knowledge_when":{"systems":["nail","staple"],"purpose":"MATERIAL"},"show_if":{"key":"install_method","in":["Nail-down","Staple-down"]},"options":[{"label":"Standard — include in material"},{"label":"Customer / builder supplies"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'hardwood_fasteners');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0191a001-c0de-4000-8000-000000000004',
       'Demo & disposal',
       'Is the existing floor glued down?',
       'Glued hard surface is a different removal than floating click. Uses the existing demo labor rates — this is a crew/scope flag, not a second price.',
       'choice', 'existing_bond', false, true, 272,
       '{"note":true,"multi":false,"purpose":"LABOR","show_if":{"key":"hs_demo","in":["LVP","Laminate","Sheet vinyl","LVP / Vinyl"]},"options":[{"label":"Floating / click — not glued"},{"label":"Glued down"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'existing_bond');

commit;
