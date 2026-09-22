-- Floor King — flooring knowledge engine, pass 77.
-- Run in the Supabase SQL editor AFTER 0190–0265. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asked light/medium/heavy furniture moving.
-- A backsplash is not a furniture-moving job. Hide furniture_level and
-- furniture_heavy on wall-only jobs. Appliances stay. Mixed LVP + wall
-- still asks. Occupied floor jobs still ask. Unanswered stays open.
-- Do NOT SQL-gate furniture on tile_application (0142 — unanswered floor vs wall must still ask furniture).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0266_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Occupied vs vacant. Vacant hides furniture moving — empty house, do not invent a furniture charge. Exclusive wall tile also hides it — a backsplash is not a furniture-moving job. Occupied and Unknown still ask light/medium/heavy. Unanswered stays open.'
 where key = 'occupancy';

update public.estimate_questions
   set help = 'Light / medium / heavy uses Floor King''s furniture-moving labor. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job. Specialty items (piano, pool table) stay on the next question as scope.'
 where key = 'furniture_level';

update public.estimate_questions
   set help = 'Pianos, pool tables, and loaded cabinets are scope/schedule notes unless this job already has a furniture-moving labor line. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job.'
 where key = 'furniture_heavy';

commit;
