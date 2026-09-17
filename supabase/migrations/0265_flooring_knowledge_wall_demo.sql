-- Floor King — flooring knowledge engine, pass 76.
-- Run in the Supabase SQL editor AFTER 0190–0264. Idempotent — safe to re-run.
--
-- Exclusive wall tile still offered floor demo chips (carpet / LVP / hardwood /
-- sheet vinyl / luan) on "what's coming up?". Those are not a backsplash.
-- Hide those chips; ceramic mortar / None / Other stay for wall-tile tear-out.
-- Pad / tack / glued-vs-floating follow-ups hide too. Mixed LVP + wall still
-- shows floor demo. Unanswered and Unknown stay open.
-- Do NOT SQL-gate hs_demo on tile_application (0142 — unanswered floor vs wall must still offer carpet tear-out).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0265_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

commit;
