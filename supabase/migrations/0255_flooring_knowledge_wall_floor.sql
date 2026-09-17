-- Floor King — flooring knowledge engine, pass 66.
-- Run in the Supabase SQL editor AFTER 0190–0254. Idempotent — safe to re-run.
--
-- Exclusive wall tile also hides floor doorway T-molds, 4×8 subfloor sheets,
-- self-leveler bags, slab vapor barrier, and aqua-bar mitigation. Unanswered
-- / Unknown stay open. Mixed carpet or LVP + wall tile still asks them.
-- Wet area, appliances, floor prep, substrate, base trim, and setting
-- materials stay. Do NOT SQL-gate these on tile_application (0142).
-- Do not invent wall-tile labor.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0255_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, and aqua-bar mitigation — those are floor work. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

commit;
