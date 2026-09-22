-- Floor King — flooring knowledge engine, pass 74.
-- Run in the Supabase SQL editor AFTER 0190–0262. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asked whether the FLOOR is flat / uneven / cracked.
-- That is not a backsplash question, and leftover Uneven + Patch/skim fired a
-- self-level warning after Self-leveling chips were already hidden (0261).
-- Hide subfloor_condition on wall-only jobs. Mixed LVP + wall still asks.
-- Unanswered and Unknown stay open.
-- Do NOT SQL-gate subfloor_condition on tile_application (0142 — unanswered floor vs wall must still ask floor flatness).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0263_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, and floor subfloor condition (flat / uneven / cracks) — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Flat vs uneven vs cracks vs a height change. Exclusive wall tile hides this — that is floor work, not a backsplash. Mixed LVP + wall still asks. If demo hasn''t happened, pick Unknown / field verify — do not invent a bag count.'
 where key = 'subfloor_condition';

commit;
