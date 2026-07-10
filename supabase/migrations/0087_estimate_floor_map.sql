-- 0087 — Mixed-material estimates: assign a flooring product per room.
-- Idempotent. Safe to run more than once.

-- 1) "What are we installing?" becomes multi-select so a job can be BOTH carpet
--    and hard surface (every prep step already reveals per its project_type).
update estimate_questions
set config = jsonb_set(coalesce(config, '{}'::jsonb), '{multi}', 'true'::jsonb)
where key = 'project_type';

-- 2) Retire the single-product flooring steps and their install toggles — the new
--    per-room floor map replaces them (and carries install labor per product).
update estimate_questions
set active = false
where label in (
  'What carpet?',
  'What flooring?',
  'Include carpet installation?',
  'Include installation?'
);

-- 3) The areas step now feeds every material, not just carpet.
update estimate_questions
set section = 'Flooring',
    help = 'Add every room in the job with its size. This drives the product, pad, and labor quantities.'
where kind = 'areas';

-- 4) Add the per-room product assignment step (once).
insert into estimate_questions (section, label, help, kind, config, required, active, position, key)
select
  'Flooring',
  'What''s going in each room?',
  'Pick the product for each room — carpet, LVP, or anything else. Mix materials or use different products by area; each room is billed in its own unit, with install labor added automatically.',
  'floor_map',
  jsonb_build_object(
    'show_if', jsonb_build_object('key', 'project_type', 'in', jsonb_build_array('Carpet', 'Hard surface')),
    'ask_source', true,
    'install_yd', 6,   -- carpet install cost, per sq yd
    'install_ft', 2    -- hard-surface install cost, per sq ft
  ),
  true,
  true,
  9,
  null
where not exists (select 1 from estimate_questions where kind = 'floor_map');
