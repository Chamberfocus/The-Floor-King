-- Floor King — flooring knowledge engine, pass 114.
-- Run in the Supabase SQL editor AFTER 0190–0302. Idempotent — safe to re-run.
--
-- Exclusive tile still listed the hard-surface Install method picker.
-- Thinset lives on Tile setting — not Floating / Glue-down / Nail-down.
-- Hide install_method once the job is exclusive tile (floor or wall). Mixed
-- LVP + tile still asks. Unanswered hard surface stays open. Leftover
-- Floating / click does not reopen it.
-- Do NOT SQL-gate install_method on surface_type (0142 — unanswered HS and mixed LVP + tile must still ask install method).
-- Do NOT SQL-gate install_method on tile_application (0142 — unanswered floor vs wall must still ask method on mixed LVP + tile).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0303_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, or thinset — pick every hard-surface method in play. Exclusive carpet hides this hard-surface method picker. Exclusive tile also hides this — thinset stays on Tile setting, not Floating / Glue-down / Nail-down. Mixed LVP + tile still asks. Stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Floating / Glue-down chips do not reopen it on a carpet-only job. Leftover Floating on exclusive solid hardwood does not hide fasteners or adhesive — leftover illegal chips do not switch overlay follow-ups. Leftover Floating / click on exclusive tile does not reopen this.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Thinset, grout, and backer come from the catalog in Builder. This records the need — bag counts stay TBD unless a product with coverage is actually picked. Taped square feet is not bags of thinset. Exclusive tile hides the hard-surface Install method picker — thinset is this question, not Floating / Glue-down / Nail-down. Exclusive tile hides the 6-mil vapor-barrier question; crack isolation / uncoupling membranes belong here, not on that floating-floor sheet.'
 where key = 'tile_setting';

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Site AC/heat and acclimation hide too — a backsplash is not a hardwood acclimation job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, occupancy, delivery, access, and setting materials. Exclusive tile hides the hard-surface Install method picker — thinset stays on Tile setting. Exclusive floor tile also hides the 6-mil vapor-barrier question — thinset is not a click-floor vapor barrier; membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

commit;
