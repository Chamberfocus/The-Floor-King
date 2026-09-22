-- Floor King — flooring knowledge engine, pass 51.
-- Run in the Supabase SQL editor AFTER 0190–0239. Idempotent — safe to re-run.
--
-- Area-based prep labor (self-level / skim / moisture) follows hard-surface
-- rooms on a mixed job — the same split as self-leveler bags. Demo / haul
-- stay whole-job: the old floor is not the new family.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0240_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floor prep for this job. Self-level / skim / grind labor follows hard-surface rooms on a mixed carpet + LVP job — not the carpet. Field verify / TBD is allowed. Bag count is a separate step when Self-leveling is picked.'
 where key = 'hs_prep';

update public.estimate_questions
   set help = 'Moisture mitigation (Aqua bar / primer) follows hard-surface rooms on a mixed job. Carpet rooms are not treated. Field verify allowed — do not invent a roll count.'
 where key = 'moisture_mitigation';

update public.estimate_questions
   set help = 'Sheet vinyl skim / embossing. Quantity follows sheet-vinyl rooms only on a mixed job. Field verify / TBD does not invent a bag count.'
 where key = 'vinyl_skim';

commit;
