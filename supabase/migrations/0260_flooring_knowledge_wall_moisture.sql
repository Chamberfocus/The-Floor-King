-- Floor King — flooring knowledge engine, pass 71.
-- Run in the Supabase SQL editor AFTER 0190–0259. Idempotent — safe to re-run.
--
-- Exclusive wall tile hides slab moisture tests. Aqua-bar mitigation is
-- already hidden (0255); asking whether the slab was tested while hiding the
-- mitigation is floor work on a wall job. Wet area, appliances, floor prep,
-- substrate, and setting materials stay. Mixed carpet or LVP + wall tile
-- still asks the slab test. Unanswered and Unknown stay open.
-- Do NOT SQL-gate moisture_test on tile_application (0142 — unanswered floor
-- vs wall must not hide a hardwood/glue moisture test, and mixed jobs must
-- still ask). Do not invent a moisture reading.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0260_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, and slab moisture tests — those are floor work. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Glue-down, hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Wet area still asks.'
 where key = 'moisture_test';

commit;
