-- Floor King — Vinyl cove base on the base / quarter round / shoe question.
-- Run in the Supabase SQL editor after 0509.
-- 0507 (drawing takeoff) is already applied. Do not run it again.
--
-- Vinyl cove base is the existing linear-foot cove trim. This does not invent
-- a SKU, a price, or a second base line.
-- Does not enable accounting.

update public.estimate_questions
set
  help = 'Vinyl cove base, baseboard, quarter round, and shoe are linear feet — never square feet. Vinyl cove base is the wall base for vinyl and LVP. Pick it here, then add the footage on Trims. A type chip is not a quantity. Keep existing or Field verify if demo has not happened. Do not invent a SKU or price.',
  config = jsonb_set(
    config,
    '{options}',
    coalesce(config->'options', '[]'::jsonb) || '[{"label":"Vinyl cove base"}]'::jsonb
  )
where key = 'hs_base_trim'
  and not exists (
    select 1
    from jsonb_array_elements(coalesce(config->'options', '[]'::jsonb)) as opt
    where opt->>'label' ~* 'vinyl[[:space:]]*cove|cove[[:space:]]*base'
  );
