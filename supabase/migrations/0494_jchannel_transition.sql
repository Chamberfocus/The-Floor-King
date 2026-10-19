-- Floor King — J-channel on the doorway transitions question.
-- Run in the Supabase SQL editor after 0493.
--
-- T-mold, reducer, end cap, threshold, and metal stay EACH.
-- J-channel is the existing linear-foot trim. This does not invent a SKU,
-- a price, or a second transition line.
-- Does not enable accounting.

update public.estimate_questions
set
  help = 'T-mold, reducer, end cap, threshold, and metal are EACH. J-channel is linear feet. Never square feet. Pick the types here, then add matching catalog pieces on Trims and type the count. A type chip is not a quantity of 1. Do not invent a SKU or price. Field verify is allowed.',
  config = jsonb_set(
    config,
    '{options}',
    coalesce(config->'options', '[]'::jsonb) || '[{"label":"J-channel"}]'::jsonb
  )
where key = 'hs_transitions'
  and not exists (
    select 1
    from jsonb_array_elements(coalesce(config->'options', '[]'::jsonb)) as opt
    where opt->>'label' ~* 'j-?[[:space:]]*channel'
  );
