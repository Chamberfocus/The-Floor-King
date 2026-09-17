-- Floor King — flooring knowledge engine, pass 65.
-- Run in the Supabase SQL editor AFTER 0190–0253. Idempotent — safe to re-run.
--
-- Exclusive wall tile hides floor-only follow-ups (toilets, vents, door
-- shaves, floor stairs, construction grade, radiant heat) in the overlay.
-- Unanswered / Unknown stay open. Mixed carpet or LVP + wall tile still
-- asks those questions. Do NOT SQL-gate toilets on tile_application (0142).
-- Wet area, appliances, floor prep, and setting materials stay.
-- Do not invent wall-tile labor.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0254_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, and radiant heat — those are floor work. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

commit;
