-- Floor King — flooring knowledge engine, pass 69.
-- Run in the Supabase SQL editor AFTER 0190–0257. Idempotent — safe to re-run.
--
-- New construction hides toilet pull & reset. There is no existing toilet to
-- pull. Replacement and unanswered still ask. Appliances and door shaves stay.
-- Do NOT SQL-gate toilets on work_type (0142 — unanswered new-vs-replacement
-- must not hide toilets). Do not invent a toilet count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0258_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, and toilet pull/reset — substrate, prep, appliances, and door shaves still apply. Unknown / field verify keeps demo visible. Do not invent a demo charge on a new slab.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count of toilets to pull and reset, in EACH. Type the number and keep the unit as each. A Yes is not 1 toilet. New construction hides this — there is no toilet to pull. Missing unit is TBD, not a guessed each. Field verify if you have not seen the bath yet.'
 where key = 'toilets';

commit;
