-- Floor King — flooring knowledge engine, pass 100.
-- Run in the Supabase SQL editor AFTER 0190–0288. Idempotent — safe to re-run.
--
-- Exclusive carpet tile still asked gripper / flat metals. Those are binder
-- bars for roll goods, not modular tile. Overlay hides metals_needed plus
-- qty / type / color once carpet_install is exclusively Carpet tile.
-- Stretch-in and glue-down keep them. Mixed stretch-in + tile still asks.
-- Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars.
-- Leftover Yes on exclusive tile does not reopen qty/type/color.
-- Unanswered carpet install stays open.
-- Do NOT SQL-gate metals_needed on carpet_install (0142 — unanswered carpet and mixed stretch-in + tile must still ask doorway metals).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0289_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Carpet-to-hard-surface doorways and edges. Yes opens the count (EACH) plus type/color. Exclusive carpet tile hides this — gripper and flat metals are binder bars for roll goods, not modular tile. Stretch-in and glue-down keep it. Mixed stretch-in + tile still asks. Unanswered stays open. Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars. Leftover Yes on exclusive tile does not reopen qty/type/color. Do not invent a metal price here.'
 where key = 'metals_needed';

update public.estimate_questions
   set help = 'Count of metals / transitions in EACH — never square feet. Exclusive carpet tile hides this with metals needed — modular tile is not a binder-bar count. Pick a catalog gripper or flat metal in Builder if Floor King sells it.'
 where key = 'metals_qty';

update public.estimate_questions
   set help = 'Gripper vs flat. Exclusive carpet tile hides this with metals needed. The count is the previous step — this does not add a second charge.'
 where key = 'metal_type';

update public.estimate_questions
   set help = 'Silver / titanium / gold. Exclusive carpet tile hides this with metals needed. This does not invent a metal SKU.'
 where key = 'metal_color';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides gripper/flat metals — binder bars for roll goods, not modular tile. Stretch-in and glue-down keep metals. Mixed stretch-in + tile still asks metals. Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Leftover Hardwood on Surface type does not reopen finish, fasteners, or vapor. Leftover Glue-down / Carpet tile on exclusive LVP is a carpet chip — it does not open adhesive, moisture test, or acclimation. Mixed Carpet + LVP still unions Carpet install. Do not invent a box size.'
 where key = 'carpet_install';

commit;
