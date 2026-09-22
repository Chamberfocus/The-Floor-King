-- Floor King — flooring knowledge engine, pass 42.
-- Run in the Supabase SQL editor AFTER 0190–0230. Idempotent — safe to re-run.
--
-- Opening a carpet or sheet-vinyl cut list does not plant 12' (carpet) or
-- 6' (vinyl) as the first cut width. Catalog roll_width_ft may fill the
-- field. 12'/15' and 6'/12' chips remain one tap. An empty width is still
-- not a roll — emit already refuses to substitute a family chip.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0231_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width. Catalog roll_width_ft may fill the field; 12''/15'' chips are one tap. Opening this question does not plant 12''. An empty width is not a 12-foot roll — converting room square feet into yards is not a cut plan. Carpet tile hides this list and orders from measured area.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. Each piece needs a length AND a roll width. Catalog roll_width_ft may fill the field; 6''/12'' chips are one tap. Opening this question does not plant 6''. An empty width is not a 6-foot roll. Converting room square feet into yards is not a layout.'
 where key = 'vinyl_layout'
    or (kind = 'cuts' and config->>'category' = 'vinyl');

commit;
