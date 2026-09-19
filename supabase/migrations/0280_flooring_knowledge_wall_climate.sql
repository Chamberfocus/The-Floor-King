-- Floor King — flooring knowledge engine, pass 91.
-- Run in the Supabase SQL editor AFTER 0190–0279. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asked site AC/heat and acclimation. A backsplash
-- is not a hardwood acclimation job. Hide climate_control and acclimation on
-- wall-only jobs. Occupancy, delivery, access, wet area, appliances, substrate,
-- prep, base trim, and setting stay. Mixed LVP or hardwood + wall still asks.
-- Unanswered and Unknown stay open.
-- Do NOT SQL-gate climate_control on tile_application (0142 — unanswered floor vs wall must still ask AC/heat).
-- Do NOT SQL-gate acclimation on tile_application (0142 — leftover Glue-down on unanswered wall must not SQL-hide).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0280_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Site AC/heat and acclimation hide too — a backsplash is not a hardwood acclimation job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, occupancy, delivery, access, and setting materials. Exclusive floor tile also hides the 6-mil vapor-barrier question — thinset is not a click-floor vapor barrier; membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down / carpet tile, from this overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Unanswered and Unknown stay open. Legacy AC/heat yes-no answers still count.'
 where key = 'climate_control';

update public.estimate_questions
   set help = 'Hardwood, glue-down (including glue-down carpet), and carpet tile need acclimation / climate notes. Floating laminate and stretch-in hide this — do not invent a day count. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Leftover Glue-down on exclusive wall does not reopen this.'
 where key = 'acclimation';

commit;
