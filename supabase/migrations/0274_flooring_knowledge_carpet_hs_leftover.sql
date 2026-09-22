-- Floor King — flooring knowledge engine, pass 85.
-- Run in the Supabase SQL editor AFTER 0190–0273. Idempotent — safe to re-run.
--
-- Carpet-only leftover Floating / Glue-down (hard-surface install_method)
-- still switched overlay systems: stretch-in opened expansion and
-- underlayment, and leftover Floating undid exclusive carpet-tile 6-mil
-- vapor hide. Hard-surface chips apply only when a hard-surface family is
-- in play. Mixed Carpet + LVP still asks click-floor follow-ups.
-- Unanswered carpet install stays open.
-- Do NOT SQL-gate vapor_barrier on install_method (0142 — unanswered HS and mixed Carpet + LVP leftover Floating must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0274_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Floating floors need expansion at walls and transitions. Solid hardwood hides this — floating is not a permitted system. Exclusive laminate leftover Glue-down still asks this — laminate is floating. Exclusive tile leftover Floating hides this. Carpet-only leftover Floating hides this — click-floor expansion is not a stretch-in question. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.'
 where key = 'laminate_expansion';

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Exclusive laminate leftover Glue-down does not show this — laminate is floating. Exclusive sheet vinyl leftover Floating still asks this — sheet vinyl is glue-down. Carpet-only leftover Glue-down does not show this — carpet glue is on Carpet install. Mixed LVP still asks. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. Do not invent coverage.'
 where key = 'adhesive';

commit;
