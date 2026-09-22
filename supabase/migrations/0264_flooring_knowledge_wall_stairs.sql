-- Floor King — flooring knowledge engine, pass 75.
-- Run in the Supabase SQL editor AFTER 0190–0263. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asked about stairs, landings, and open sides.
-- hs_plank_stairs was already hidden, but the generic stair gate and its
-- landing / open-side follow-ups stayed visible on a backsplash. Hide them
-- on wall-only jobs. Mixed carpet or LVP + wall still asks. Unanswered
-- and Unknown stay open.
-- Do NOT SQL-gate stairs on tile_application (0142 — unanswered floor vs wall must still ask stairs).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0264_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Stairs change material, labor, and trim. Exclusive wall tile hides this — a backsplash is not a stair job. Mixed carpet or LVP + wall still asks. Field verify if you have not seen them.'
 where key = 'stairs';

update public.estimate_questions
   set help = 'Count of landings in EACH. Measured with the rooms when they are floored the same; this flags extra pieces and noses. Exclusive wall tile hides this — a backsplash is not a stair job.'
 where key = 'stair_landings';

update public.estimate_questions
   set help = 'Open sides change wrapped carpet ends and hard-surface nosing. Exclusive wall tile hides this. Capture the construction — pricing still uses existing stair labor.'
 where key = 'stair_open_sides';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one.'
 where key = 'hs_plank_stairs';

commit;
