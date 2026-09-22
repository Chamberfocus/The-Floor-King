-- Floor King — flooring knowledge engine, pass 37.
-- Run in the Supabase SQL editor AFTER 0190–0225. Idempotent — safe to re-run.
--
-- Self-leveler pour thickness is the Settings default, else the coverage
-- reference. We do not invent 1/4". Count-unit emits never take taped sq ft
-- as gallons / bags / each.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0226_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Bags = area ÷ coverage at the chosen pour thickness. Pour is the Settings default, else the coverage reference. We do not invent 1/4 inch. Field verify / TBD does not add a bag count.'
 where kind = 'selflevel';

commit;
