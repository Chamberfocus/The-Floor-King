-- Floor King — flooring knowledge engine, pass 43.
-- Run in the Supabase SQL editor AFTER 0190–0231. Idempotent — safe to re-run.
--
-- Yes/No (or choice) emits billed EACH / LN FT without a typed Amount do not
-- invent a quantity of 1. Number questions still pass the count. Flat job
-- charges (delivery, furniture moving, curb) stay one charge. Unknown product
-- units on TBD lines are unit TBD, not invented "each".
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0232_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Count of toilets to pull and reset, in EACH. Type the number — a Yes is not 1 toilet. Field verify if you have not seen the bath yet.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'Doors to shave / undercut, in EACH. Type the number — we do not invent 1 door from a Yes. Skip or Field verify if unknown.'
 where key = 'doors_shave';

update public.estimate_questions
   set help = 'T-mold, reducer, end cap, threshold, or metal — EACH, never square feet. Pick the types here, then add matching catalog pieces on Trims and type the count. A type chip is not a quantity of 1. Do not invent a SKU or price. Field verify is allowed.'
 where key = 'hs_transitions';

commit;
