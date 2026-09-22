-- Floor King — flooring knowledge engine, pass 44.
-- Run in the Supabase SQL editor AFTER 0190–0232. Idempotent — safe to re-run.
--
-- Missing unit metadata is unit TBD, not invented "each". Questionnaire
-- emits, Builder add-ons, catalog snapshots, stock POs, and customer-order
-- invoices keep an empty unit until a real unit is known.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0233_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Count of toilets to pull and reset, in EACH. Type the number and keep the unit as each. A Yes is not 1 toilet. Missing unit is TBD, not a guessed each. Field verify if you have not seen the bath yet.'
 where key = 'toilets';

update public.estimate_questions
   set help = 'Doors to shave / undercut, in EACH. Type the number. We do not invent 1 door from a Yes, and we do not label an unknown unit as each.'
 where key = 'doors_shave';

commit;
