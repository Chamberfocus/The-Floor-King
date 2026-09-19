-- Floor King — flooring knowledge engine, pass 31.
-- Run in the Supabase SQL editor AFTER 0190–0219. Idempotent — safe to re-run.
--
-- Install labor is the Settings rate on the floor-map / cuts question (or the
-- product's own labor rate). Application code must not invent $6/yd or $2/ft.
-- Copy the floor-map shop rate onto carpet cuts when that field is missing so
-- live 0087 values stay the source of truth. Sheet vinyl already carries its
-- own install_yd and is left alone.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0220_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions cuts
   set config = jsonb_set(
         coalesce(cuts.config, '{}'::jsonb),
         '{install_yd}',
         fm.install_yd
       )
  from (
    select config->'install_yd' as install_yd
      from public.estimate_questions
     where kind = 'floor_map'
       and config ? 'install_yd'
       and (config->>'install_yd') ~ '^[0-9]+([.][0-9]+)?$'
       and (config->>'install_yd')::numeric > 0
     order by position
     limit 1
  ) fm
 where cuts.kind = 'cuts'
   and coalesce(cuts.config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout'
   and (
         cuts.config->>'install_yd' is null
      or cuts.config->>'install_yd' = ''
   )
   and fm.install_yd is not null;

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

commit;
