-- Floor King — flooring knowledge engine, pass 73.
-- Run in the Supabase SQL editor AFTER 0190–0261. Idempotent — safe to re-run.
--
-- Exclusive carpet tile is modular / boxed, not a roll cut plan. Pattern match,
-- inches of repeat, and seam/direction notes are broadloom layout. Hide them
-- once carpet_install is exclusively Carpet tile so a new salesperson is not
-- asked for a seam plan that does not exist. Stretch-in and glue-down keep
-- them. Mixed stretch-in + tile still asks them. Unanswered stays open.
-- Do NOT SQL-gate pattern_match on carpet_install (0142 — unanswered method must still ask roll layout).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0262_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Do not invent a box size.'
 where key = 'carpet_install';

update public.estimate_questions
   set help = 'Pattern match and roll direction are for broadloom. Exclusive carpet tile hides this — modular tiles are not a seam plan. Stretch-in and glue-down keep it. Unanswered stays open. This does not generate a cut plan.'
 where key = 'pattern_match';

update public.estimate_questions
   set help = 'Where seams should fall and which way the roll runs. Exclusive carpet tile hides this — there is no roll. Glue-down broadloom still asks. For the cut list — not a generated plan.'
 where key = 'carpet_direction';

update public.estimate_questions
   set help = 'Inches of pattern repeat for purchasing and layout notes. Exclusive carpet tile hides this with pattern match. This does not generate a cut plan.'
 where key = 'pattern_repeat';

commit;
