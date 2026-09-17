-- Floor King — flooring knowledge engine, pass 50.
-- Run in the Supabase SQL editor AFTER 0190–0238. Idempotent — safe to re-run.
--
-- Builder emit, pad, self-leveler bags, subfloor sheets, and the running
-- takeoff strip use the same per-family measured area as Review. Mixed
-- carpet + LVP jobs do not clone whole-job taped sq ft onto every material.
-- Unassigned mixed takeoffs stay empty rather than inventing 500 sq ft of both.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0239_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Builder lines, pad, self-leveler, and subfloor follow those rooms. Fill-empty uses this job''s flooring family. Sold-by for Other / adhesive is TBD until you pick a unit.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Quantity follows CARPET rooms only — mixed jobs do not buy pad for the LVP. Glue-down and carpet tile hide this step.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Self-leveler bags follow hard-surface rooms on a mixed job. Carpet rooms are not poured. Field verify / TBD does not invent a bag count. Coverage and pour thickness come from Settings — we do not invent 1/4".'
 where kind = 'selflevel';

update public.estimate_questions
   set help = 'Subfloor sheets follow hard-surface rooms on a mixed job. Carpet rooms are not sheeted. Field verify / TBD does not invent a sheet count. Missing sheet coverage is not a 4×8.'
 where kind = 'subfloor';

commit;
