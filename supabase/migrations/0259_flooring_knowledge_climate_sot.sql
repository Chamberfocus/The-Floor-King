-- Floor King — flooring knowledge engine, pass 70.
-- Run in the Supabase SQL editor AFTER 0190–0258. Idempotent — safe to re-run.
--
-- Climate, radiant, and moisture-untested warnings live on the overlay
-- (knowledgeWarnings), not a second questionnaire list. New-construction
-- warning also names toilet pull/reset (0258). Stretch-in still captures
-- climate as an install condition. Legacy AC/heat yes-no answers still count.
-- Do NOT SQL-gate climate on install_method (0142 — unanswered hardwood/glue
-- must still ask climate). Do not invent an acclimation day count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0259_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, and toilet pull/reset — substrate, prep, appliances, and door shaves still apply. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down, from the overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Legacy AC/heat yes-no answers still count.'
 where key = 'climate_control';

update public.estimate_questions
   set help = 'Carpet pad and many hard-surface products have radiant limits. Yes fires the overlay purchasing warning — do not invent a radiant-rated SKU.'
 where key = 'radiant_heat';

update public.estimate_questions
   set help = 'Glue-down, hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not.'
 where key = 'moisture_test';

commit;
