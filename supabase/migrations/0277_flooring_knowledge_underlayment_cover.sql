-- Floor King — flooring knowledge engine, pass 88.
-- Run in the Supabase SQL editor AFTER 0190–0276. Idempotent — safe to re-run.
--
-- Unkeyed product questions with category underlayment treated mixed-job
-- cover as carpet rooms. Laminate foam is not carpet pad. Keyed carpet_pad
-- still covers carpet rooms. Keyed hs_underlayment still covers hard-surface
-- rooms. Mixed unkeyed stays 0 rather than cloning pad onto LVP / laminate.
-- Exclusive carpet still uses carpet rooms. Exclusive hard surface still
-- uses prep/HS rooms. Do not invent a roll count or a 30-yard pad default
-- when the catalog SKU has no sold-by unit.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0277_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Do not invent a roll count.'
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

commit;
