-- Floor King — flooring knowledge engine, pass 79.
-- Run in the Supabase SQL editor AFTER 0190–0267. Idempotent — safe to re-run.
--
-- Exclusive tile (floor or wall) still asked the 6-mil vapor-barrier
-- question once substrate was Concrete. Thinset / mortar is not a
-- click-floor vapor sheet — crack isolation and uncoupling membranes
-- stay on Tile setting. Mixed LVP or hardwood + tile still asks.
-- Unanswered HS stays open. Do NOT SQL-gate vapor_barrier on surface_type (0142 — unanswered HS and mixed LVP + tile must still ask vapor barrier over concrete).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0268_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Exclusive floor tile also hides the 6-mil vapor-barrier question — thinset is not a click-floor vapor barrier; membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Thinset, grout, and backer come from the catalog in Builder. This records the need — bag counts stay TBD unless a product with coverage is actually picked. Taped square feet is not bags of thinset. Exclusive tile hides the 6-mil vapor-barrier question; crack isolation / uncoupling membranes belong here, not on that floating-floor sheet.'
 where key = 'tile_setting';

commit;
