-- Floor King CRM — estimate questionnaire: unified trim list + de-dupe.
-- Idempotent. Paste into Supabase SQL editor → Run.

-- 1) Merge the carpet/hard-surface duplicates into ONE question shown for both
--    (Doors to shave = pos 90, Furniture = 100, Anything else = 130).
update public.estimate_questions
  set config = jsonb_set(config, '{show_if,in}', '["Carpet","Hard surface"]'::jsonb)
  where position in (90, 100, 130)
    and config ? 'show_if';

-- 2) Deactivate the now-redundant questions:
--    310/315/320 = hard-surface duplicates merged above,
--    300/305     = generic hard-surface haul-away & curb (demo itemizes these now),
--    110/290/292/295 = scattered/generic trims, replaced by the product trim list.
update public.estimate_questions set active = false
  where position in (300, 305, 310, 315, 320, 110, 290, 292, 295);

-- 3) One unified trim list — each trim is a real product (catalog, or a Versatrim
--    / manufacturer item added on the fly) with its own qty, unit and stock/order.
insert into public.estimate_questions (section, label, help, kind, config, required, position)
select 'trim', 'Trims, moldings & transitions',
  'Baseboard, quarter-round, cove base, stairnose, J-channel, transitions — add each as its own product.',
  'product',
  '{"trim_list":true,"category":"trim","ask_source":true,"show_if":{"key":"project_type","in":["Carpet","Hard surface"]}}'::jsonb,
  false, 293
where not exists (
  select 1 from public.estimate_questions e where e.label = 'Trims, moldings & transitions'
);
