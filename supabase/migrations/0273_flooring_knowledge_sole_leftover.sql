-- Floor King — flooring knowledge engine, pass 84.
-- Run in the Supabase SQL editor AFTER 0190–0272. Idempotent — safe to re-run.
--
-- Leftover install_method chips on a sole-system family still switched
-- follow-ups: Glue-down on laminate opened adhesive and hid expansion;
-- Floating on sheet vinyl hid adhesive; Floating on tile opened attached
-- pad / underlayment / expansion. Overlay now keeps the only legal system
-- (laminate floating, tile thinset, sheet vinyl glue) so leftover chips
-- do not switch follow-ups. Mixed LVP + laminate has no sole system —
-- leftover stays. Unanswered still infers.
-- Do NOT SQL-gate adhesive on surface_type (0142 — unanswered HS and mixed LVP + laminate must still ask adhesive when glue is in play).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0273_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, and thinset ask different follow-ups. Solid hardwood hides attached pad, underlayment, and expansion — floating is not a permitted system. Laminate leftover Glue-down does not open adhesive — laminate is floating. Sheet vinyl leftover Floating still asks adhesive — sheet vinyl is glue-down. Tile leftover Floating does not open attached pad or expansion — tile is thinset. Mixed LVP + laminate still asks both branches. Pick the system this product actually uses. Do not invent a per-room editor.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Exclusive laminate leftover Glue-down does not show this — laminate is floating. Exclusive sheet vinyl leftover Floating still asks this — sheet vinyl is glue-down. Mixed LVP still asks. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. Do not invent coverage.'
 where key = 'adhesive';

update public.estimate_questions
   set help = 'Floating LVP / laminate / engineered may have an attached pad. Solid hardwood hides this — floating is not a permitted system. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Yes hides separate underlayment.'
 where key = 'attached_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Do not invent a roll count.'
 where key = 'hs_underlayment';

update public.estimate_questions
   set help = 'Floating floors need expansion at walls and transitions. Solid hardwood hides this — floating is not a permitted system. Exclusive laminate leftover Glue-down still asks this — laminate is floating. Exclusive tile leftover Floating hides this. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.'
 where key = 'laminate_expansion';

commit;
