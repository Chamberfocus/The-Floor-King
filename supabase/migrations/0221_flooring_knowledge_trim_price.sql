-- Floor King — flooring knowledge engine, pass 32.
-- Run in the Supabase SQL editor AFTER 0190–0220. Idempotent — safe to re-run.
--
-- Trim chips name the accessory and its unit (lnft vs each). They do not plant
-- a hidden $1/lnft or $45/nose. Extra roll-goods products stay order TBD —
-- taped square feet is not a carpet order. R&R labor is typed, not $1.50.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0221_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Quarter round, shoe, and base are linear feet; stair noses, T-molds, and reducers are EACH — never square feet. Pick a catalog item or type a rate. Clicking a chip does not invent a price. Extra carpet/sheet on another step stays order TBD until cuts exist.'
 where coalesce(config->>'trim_list', '') = 'true';

commit;
