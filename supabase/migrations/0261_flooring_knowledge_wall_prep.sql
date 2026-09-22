-- Floor King — flooring knowledge engine, pass 72.
-- Run in the Supabase SQL editor AFTER 0190–0260. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asks Floor prep (showers skim). Self-leveling and
-- grinding chips are floor pours — hide them on wall-only jobs so a new
-- salesperson cannot emit self-level labor on a backsplash. Patch / skim and
-- None stay. Mixed LVP + wall tile still shows the floor pours. Unanswered
-- and Unknown stay open.
-- Do NOT SQL-gate hs_prep on tile_application (0142 — unanswered floor vs wall
-- must still offer Self-leveling). Do not invent a bag count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0261_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, and slab moisture tests — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'None / patch / skim / self-level / grind. Exclusive wall tile hides Self-leveling and grinding chips — those pour or grind a floor. Patch / skim stays for showers. Mixed LVP + wall tile still shows the floor pours. Do not invent a bag count here; bags are the next step when Self-leveling is picked.'
 where key = 'hs_prep';

commit;
