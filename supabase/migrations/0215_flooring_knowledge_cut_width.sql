-- Floor King — flooring knowledge engine, pass 26.
-- Run in the Supabase SQL editor AFTER 0190–0214. Idempotent — safe to re-run.
--
-- Roll-goods cuts: an empty width is not a 12-foot (carpet) or 6-foot
-- (sheet vinyl) roll. The salesperson must enter or chip a width, or the
-- catalog roll_width_ft may pre-fill the field. The app no longer silently
-- substitutes a family chip as the order quantity.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0215_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll — converting room square feet into yards is not a cut plan. Carpet tile hides this list and orders from measured area.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Sheet vinyl is roll goods. Each piece needs a length AND a roll width (catalog width or a 6''/12'' chip). An empty width is not a 6-foot roll. Converting room square feet into yards is not a layout.'
 where key = 'vinyl_layout'
    or (kind = 'cuts' and config->>'category' = 'vinyl');

commit;
