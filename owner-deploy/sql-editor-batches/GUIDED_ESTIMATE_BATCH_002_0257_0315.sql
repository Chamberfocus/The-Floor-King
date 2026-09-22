-- Floor King CRM — GUIDED ESTIMATE SQL Editor batch 002
-- Source bundle: GUIDED_ESTIMATE_0190_0476_OWNER_DEPLOY.sql
-- Source SHA-256: b6b5a9f9f0ec5e83bfee6707e97da88d70e77fd92e456c5efcaa763c071a6372
-- Source HEAD: 1703ce2fba7bb1da467873ffa422ae701c4fbdac
-- Range: 0257–0315 (59 numbered files)
-- Apply AFTER 0189 and after batch 001.
-- Independent transaction: a failure rolls back THIS batch only.
-- Do not skip batches. Do not reorder. Do not apply in parallel.
-- Does NOT enable accounting. Do NOT set books_of_record / posting flags.
-- Quote-escape already applied (12' → 12'' in SQL strings; visible 12').

BEGIN;
-- BEGIN 0257_flooring_knowledge_new_build_skim.sql
-- Floor King — flooring knowledge engine, pass 68.
-- Run in the Supabase SQL editor AFTER 0190–0256. Idempotent — safe to re-run.
--
-- New construction hides existing-vinyl skim. There is no existing vinyl to
-- skim. Replacement and unanswered still ask. Do NOT SQL-gate vinyl_skim on work_type
-- (0142 — unanswered new-vs-replacement must not hide skim).
-- Substrate and floor prep still apply. Do not invent a bag count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0257_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, and disposal — substrate and prep still apply. Unknown / field verify keeps demo visible. Do not invent a demo charge on a new slab.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Embossed existing vinyl often needs a skim coat. New construction hides this — there is no existing vinyl. If you cannot see it until demo, pick Field verify — do not invent a bag count here.'
 where key = 'vinyl_skim';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0257_flooring_knowledge_new_build_skim.sql

-- BEGIN 0258_flooring_knowledge_new_build_toilets.sql
-- Floor King — flooring knowledge engine, pass 69.
-- Run in the Supabase SQL editor AFTER 0190–0257. Idempotent — safe to re-run.
--
-- New construction hides toilet pull & reset. There is no existing toilet to
-- pull. Replacement and unanswered still ask. Appliances and door shaves stay.
-- Do NOT SQL-gate toilets on work_type (0142 — unanswered new-vs-replacement
-- must not hide toilets). Do not invent a toilet count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0258_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, and toilet pull/reset — substrate, prep, appliances, and door shaves still apply. Unknown / field verify keeps demo visible. Do not invent a demo charge on a new slab.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'Count of toilets to pull and reset, in EACH. Type the number and keep the unit as each. A Yes is not 1 toilet. New construction hides this — there is no toilet to pull. Missing unit is TBD, not a guessed each. Field verify if you have not seen the bath yet.'
 where key = 'toilets';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0258_flooring_knowledge_new_build_toilets.sql

-- BEGIN 0259_flooring_knowledge_climate_sot.sql
-- Floor King — flooring knowledge engine, pass 70.
-- Run in the Supabase SQL editor AFTER 0190–0258. Idempotent — safe to re-run.
--
-- Climate, radiant, and moisture-untested warnings live on the overlay
-- (knowledgeWarnings), not a second questionnaire list. New-construction
-- warning also names toilet pull/reset (0258). Stretch-in still captures
-- climate as an install condition. Legacy AC/heat yes-no answers still count.
-- Do NOT SQL-gate climate on install_method (0142 — unanswered hardwood/glue
-- must still ask climate). Do not invent an acclimation day count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0259_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, and toilet pull/reset — substrate, prep, appliances, and door shaves still apply. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab.'
 where key = 'work_type';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down, from the overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Legacy AC/heat yes-no answers still count.'
 where key = 'climate_control';

update public.estimate_questions
   set help = 'Carpet pad and many hard-surface products have radiant limits. Yes fires the overlay purchasing warning — do not invent a radiant-rated SKU.'
 where key = 'radiant_heat';

update public.estimate_questions
   set help = 'Glue-down, hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not.'
 where key = 'moisture_test';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0259_flooring_knowledge_climate_sot.sql

-- BEGIN 0260_flooring_knowledge_wall_moisture.sql
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

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, and slab moisture tests — those are floor work. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Glue-down, hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Wet area still asks.'
 where key = 'moisture_test';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0260_flooring_knowledge_wall_moisture.sql

-- BEGIN 0261_flooring_knowledge_wall_prep.sql
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

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, and slab moisture tests — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'None / patch / skim / self-level / grind. Exclusive wall tile hides Self-leveling and grinding chips — those pour or grind a floor. Patch / skim stays for showers. Mixed LVP + wall tile still shows the floor pours. Do not invent a bag count here; bags are the next step when Self-leveling is picked.'
 where key = 'hs_prep';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0261_flooring_knowledge_wall_prep.sql

-- BEGIN 0262_flooring_knowledge_carpet_tile_layout.sql
-- Floor King — flooring knowledge engine, pass 73.
-- Run in the Supabase SQL editor AFTER 0190–0261. Idempotent — safe to re-run.
--
-- Exclusive carpet tile is modular / boxed, not a roll cut plan. Pattern match,
-- inches of repeat, and seam/direction notes are broadloom layout. Hide them
-- once carpet_install is exclusively Carpet tile so a new salesperson is not
-- asked for a seam plan that does not exist. Stretch-in and glue-down keep
-- them. Mixed stretch-in + tile still asks them. Unanswered stays open.
-- Do NOT SQL-gate pattern_match on carpet_install (0142 — unanswered method must still ask roll layout).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0262_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Do not invent a box size.'
 where key = 'carpet_install';

update public.estimate_questions
   set help = 'Pattern match and roll direction are for broadloom. Exclusive carpet tile hides this — modular tiles are not a seam plan. Stretch-in and glue-down keep it. Unanswered stays open. This does not generate a cut plan.'
 where key = 'pattern_match';

update public.estimate_questions
   set help = 'Where seams should fall and which way the roll runs. Exclusive carpet tile hides this — there is no roll. Glue-down broadloom still asks. For the cut list — not a generated plan.'
 where key = 'carpet_direction';

update public.estimate_questions
   set help = 'Inches of pattern repeat for purchasing and layout notes. Exclusive carpet tile hides this with pattern match. This does not generate a cut plan.'
 where key = 'pattern_repeat';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0262_flooring_knowledge_carpet_tile_layout.sql

-- BEGIN 0263_flooring_knowledge_wall_subfloor.sql
-- Floor King — flooring knowledge engine, pass 74.
-- Run in the Supabase SQL editor AFTER 0190–0262. Idempotent — safe to re-run.
--
-- Exclusive wall tile still asked whether the FLOOR is flat / uneven / cracked.
-- That is not a backsplash question, and leftover Uneven + Patch/skim fired a
-- self-level warning after Self-leveling chips were already hidden (0261).
-- Hide subfloor_condition on wall-only jobs. Mixed LVP + wall still asks.
-- Unanswered and Unknown stay open.
-- Do NOT SQL-gate subfloor_condition on tile_application (0142 — unanswered floor vs wall must still ask floor flatness).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0263_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, and floor subfloor condition (flat / uneven / cracks) — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Flat vs uneven vs cracks vs a height change. Exclusive wall tile hides this — that is floor work, not a backsplash. Mixed LVP + wall still asks. If demo hasn''t happened, pick Unknown / field verify — do not invent a bag count.'
 where key = 'subfloor_condition';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0263_flooring_knowledge_wall_subfloor.sql

-- BEGIN 0264_flooring_knowledge_wall_stairs.sql
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

-- original begin; absorbed into the single owner-bundle transaction

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

-- original commit; absorbed into the single owner-bundle transaction
-- END 0264_flooring_knowledge_wall_stairs.sql

-- BEGIN 0265_flooring_knowledge_wall_demo.sql
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

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0265_flooring_knowledge_wall_demo.sql

-- BEGIN 0266_flooring_knowledge_wall_furniture.sql
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

-- original begin; absorbed into the single owner-bundle transaction

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

-- original commit; absorbed into the single owner-bundle transaction
-- END 0266_flooring_knowledge_wall_furniture.sql

-- BEGIN 0267_flooring_knowledge_solid_floating.sql
-- Floor King — flooring knowledge engine, pass 78.
-- Run in the Supabase SQL editor AFTER 0190–0266. Idempotent — safe to re-run.
--
-- Solid hardwood is typically nail, staple, or glue — not a click floor.
-- Unanswered install method still asked attached pad / underlayment /
-- expansion because those gates stay open until a method is picked.
-- Hide them once the surface is exclusive solid hardwood. Engineered and
-- mixed Hardwood + Engineered stay open. Unanswered HS stays open.
-- Do NOT SQL-gate attached_pad on surface_type (0142 — unanswered HS must still ask attached pad for LVP / laminate).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0267_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, and thinset ask different follow-ups. Solid hardwood hides attached pad, underlayment, and expansion — floating is not a permitted system. Pick the system this product actually uses. Do not invent a per-room editor.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Floating LVP / laminate / engineered may have an attached pad. Solid hardwood hides this — floating is not a permitted system. Glue-down hides this. Yes hides separate underlayment.'
 where key = 'attached_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Do not invent a roll count.'
 where key = 'hs_underlayment';

update public.estimate_questions
   set help = 'Floating floors need expansion at walls and transitions. Solid hardwood hides this — floating is not a permitted system. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.'
 where key = 'laminate_expansion';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0267_flooring_knowledge_solid_floating.sql

-- BEGIN 0268_flooring_knowledge_tile_vapor.sql
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

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Exclusive floor tile also hides the 6-mil vapor-barrier question — thinset is not a click-floor vapor barrier; membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'Thinset, grout, and backer come from the catalog in Builder. This records the need — bag counts stay TBD unless a product with coverage is actually picked. Taped square feet is not bags of thinset. Exclusive tile hides the 6-mil vapor-barrier question; crack isolation / uncoupling membranes belong here, not on that floating-floor sheet.'
 where key = 'tile_setting';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0268_flooring_knowledge_tile_vapor.sql

-- BEGIN 0269_flooring_knowledge_vapor_underlayment.sql
-- Floor King — flooring knowledge engine, pass 80.
-- Run in the Supabase SQL editor AFTER 0190–0268. Idempotent — safe to re-run.
--
-- Glue-down, carpet tile, nail-down, and stretch-in still offered
-- "Included with underlayment" on the vapor-barrier question. That chip
-- is a floating-floor 6-mil sheet — you cannot glue to it. Aqua bar /
-- primer stays on moisture mitigation. Floating and unanswered LVP /
-- engineered still offer the chip. Exclusive solid hardwood hides it
-- even before a method is picked. Do NOT SQL-gate vapor_barrier options on install_method (0142 — unanswered LVP must still offer Included with underlayment).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0269_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Aqua bar stays on moisture mitigation. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0269_flooring_knowledge_vapor_underlayment.sql

-- BEGIN 0270_flooring_knowledge_concrete_sheets.sql
-- Floor King — flooring knowledge engine, pass 81.
-- Run in the Supabase SQL editor AFTER 0190–0269. Idempotent — safe to re-run.
--
-- Exclusive Concrete still asked for 4×8 plywood overlay sheets. A slab
-- is patch / self-level, not a wood-deck repair. Hide subfloor_needed
-- once every substrate pick is Concrete. Plywood / wood / existing
-- flooring / Unknown stay open. Unanswered stays open. Sit the question
-- after substrate so it does not appear behind the salesperson.
-- Do NOT SQL-gate subfloor_needed on substrate (0142 — unanswered substrate must still ask 4×8).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0270_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'If you cannot see the substrate until demo, pick Unknown / field verify rather than guessing plywood vs concrete. Exclusive Concrete hides 4×8 subfloor sheets — a slab is patch / self-level, not plywood overlay. Plywood / wood / existing flooring still ask.',
       position = 350
 where key = 'substrate';

update public.estimate_questions
   set help = 'Yes emits 4×8 sheets only when Settings has sheet_sqft. Missing coverage is TBD — we do not invent 32 sq ft per sheet. Field verify withholds the count. Exclusive Concrete hides this — a slab is not a plywood overlay. Plywood / wood / existing flooring / Unknown still ask. Self-level stays on Floor prep.',
       position = 355
 where key = 'subfloor_needed';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0270_flooring_knowledge_concrete_sheets.sql

-- BEGIN 0271_flooring_knowledge_carpet_tile_vapor.sql
-- Floor King — flooring knowledge engine, pass 82.
-- Run in the Supabase SQL editor AFTER 0190–0270. Idempotent — safe to re-run.
--
-- Exclusive carpet tile over Concrete still asked the 6-mil click-floor
-- vapor-barrier question and skipped acclimation / moisture / Aqua bar.
-- Modular tile uses adhesive — not a floating-floor sheet. Hide vapor
-- barrier once carpet_install is exclusively Carpet tile and no click/glue
-- hard-surface family is also on the job. Ask acclimation, moisture test,
-- and Aqua bar instead (positive expander, like 0205 glue-down carpet).
-- Mixed LVP or hardwood + carpet tile still asks vapor barrier.
-- Unanswered carpet install stays open. Stretch-in still hides moisture.
-- Do NOT SQL-gate vapor_barrier on carpet_install (0142 — unanswered carpet and mixed stretch-in + tile over concrete must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0271_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation. Mixed LVP or hardwood + tile or carpet tile still asks. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Do not invent a box size.'
 where key = 'carpet_install';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down / carpet tile, from this overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Legacy AC/heat yes-no answers still count.'
 where key = 'climate_control';

update public.estimate_questions
   set help = 'Hardwood, glue-down (including glue-down carpet), and carpet tile need acclimation / climate notes. Floating laminate and stretch-in hide this — do not invent a day count.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down","Carpet tile"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"INSTALLATION","any":[{"families":["hardwood"]},{"systems":["glue","carpet_tile"]}]}'::jsonb
       )
 where key = 'acclimation'
    or id = 'f5331bc8-bc96-47f4-a392-eca7d00b694a';

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Wet area still asks.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down","Carpet tile"]},{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"subfloor_condition","in":["Moisture concerns"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP","any":[{"families":["hardwood"]},{"systems":["glue","carpet_tile"]},{"subfloor":["Moisture concerns"]}]}'::jsonb
       )
 where key = 'moisture_test'
    or id = '9400b1d6-9e58-45f8-929d-57dc35dff3be';

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Existing catalog rates — do not invent a new product.',
       config = jsonb_set(
         jsonb_set(
           coalesce(config, '{}'::jsonb),
           '{show_if}',
           '{"any":[{"key":"install_method","in":["Glue-down"]},{"key":"carpet_install","in":["Glue-down","Carpet tile"]},{"key":"surface_type","in":["Hardwood","Engineered hardwood"]},{"key":"subfloor_condition","in":["Moisture concerns"]}]}'::jsonb
         ),
         '{knowledge_when}',
         '{"purpose":"PREP","any":[{"families":["hardwood"]},{"systems":["glue","carpet_tile"]},{"subfloor":["Moisture concerns"]}]}'::jsonb
       )
 where key = 'moisture_mitigation'
    or id = '2fc7799c-030c-4276-b6fa-801cb9867082';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0271_flooring_knowledge_carpet_tile_vapor.sql

-- BEGIN 0272_flooring_knowledge_wood_moisture.sql
-- Floor King — flooring knowledge engine, pass 83.
-- Run in the Supabase SQL editor AFTER 0190–0271. Idempotent — safe to re-run.
--
-- Exclusive hardwood nail/staple/floating over plywood still asked the slab
-- moisture test and Aqua bar. 0190: moisture test is glue-down or wood over
-- concrete — not a wood deck and not floating click. Hide moisture_test and
-- moisture_mitigation once every substrate pick is Plywood / OSB / Wood and
-- the job is exclusive hardwood that is not glue-down. Glue-down over plywood
-- still asks. Mixed LVP still asks. A moisture-concern flag still asks.
-- Unanswered substrate and unanswered method stay open.
-- Do NOT SQL-gate moisture_test on substrate (0142 — unanswered substrate and mixed LVP + hardwood must still ask a slab moisture test).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0272_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood over concrete, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — 0190 is glue-down or wood over concrete, not a wood deck. Glue-down over plywood still asks. Mixed LVP still asks. Unanswered substrate stays open. Wet area still asks.'
 where key = 'moisture_test'
    or id = '9400b1d6-9e58-45f8-929d-57dc35dff3be';

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system; glue-down over wood still asks. Mixed LVP still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation'
    or id = '2fc7799c-030c-4276-b6fa-801cb9867082';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0272_flooring_knowledge_wood_moisture.sql

-- BEGIN 0273_flooring_knowledge_sole_leftover.sql
-- Floor King — flooring knowledge engine, pass 84.
-- Run in the Supabase SQL editor AFTER 0190–0272. Idempotent — safe to re-run.
--
-- Leftover install_method chips on a sole-system family still switched
-- follow-ups: Glue-down on laminate opened adhesive and hid expansion;
-- Floating on sheet vinyl hid adhesive; Floating on tile opened attached
-- pad / underlayment / expansion. Overlay now keeps the only legal system
-- (laminate floating, tile thinset, sheet vinyl glue) so leftover chips
-- do not switch follow-ups. Mixed LVP + laminate has no sole system —
-- leftover stays. Unanswered still infers.
-- Do NOT SQL-gate adhesive on surface_type (0142 — unanswered HS and mixed LVP + laminate must still ask adhesive when glue is in play).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0273_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, and thinset ask different follow-ups. Solid hardwood hides attached pad, underlayment, and expansion — floating is not a permitted system. Laminate leftover Glue-down does not open adhesive — laminate is floating. Sheet vinyl leftover Floating still asks adhesive — sheet vinyl is glue-down. Tile leftover Floating does not open attached pad or expansion — tile is thinset. Mixed LVP + laminate still asks both branches. Pick the system this product actually uses. Do not invent a per-room editor.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Exclusive laminate leftover Glue-down does not show this — laminate is floating. Exclusive sheet vinyl leftover Floating still asks this — sheet vinyl is glue-down. Mixed LVP still asks. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. Do not invent coverage.'
 where key = 'adhesive';

update public.estimate_questions
   set help = 'Floating LVP / laminate / engineered may have an attached pad. Solid hardwood hides this — floating is not a permitted system. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Yes hides separate underlayment.'
 where key = 'attached_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Do not invent a roll count.'
 where key = 'hs_underlayment';

update public.estimate_questions
   set help = 'Floating floors need expansion at walls and transitions. Solid hardwood hides this — floating is not a permitted system. Exclusive laminate leftover Glue-down still asks this — laminate is floating. Exclusive tile leftover Floating hides this. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.'
 where key = 'laminate_expansion';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0273_flooring_knowledge_sole_leftover.sql

-- BEGIN 0274_flooring_knowledge_carpet_hs_leftover.sql
-- Floor King — flooring knowledge engine, pass 85.
-- Run in the Supabase SQL editor AFTER 0190–0273. Idempotent — safe to re-run.
--
-- Carpet-only leftover Floating / Glue-down (hard-surface install_method)
-- still switched overlay systems: stretch-in opened expansion and
-- underlayment, and leftover Floating undid exclusive carpet-tile 6-mil
-- vapor hide. Hard-surface chips apply only when a hard-surface family is
-- in play. Mixed Carpet + LVP still asks click-floor follow-ups.
-- Unanswered carpet install stays open.
-- Do NOT SQL-gate vapor_barrier on install_method (0142 — unanswered HS and mixed Carpet + LVP leftover Floating must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0274_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Floating floors need expansion at walls and transitions. Solid hardwood hides this — floating is not a permitted system. Exclusive laminate leftover Glue-down still asks this — laminate is floating. Exclusive tile leftover Floating hides this. Carpet-only leftover Floating hides this — click-floor expansion is not a stretch-in question. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.'
 where key = 'laminate_expansion';

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Exclusive laminate leftover Glue-down does not show this — laminate is floating. Exclusive sheet vinyl leftover Floating still asks this — sheet vinyl is glue-down. Carpet-only leftover Glue-down does not show this — carpet glue is on Carpet install. Mixed LVP still asks. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. Do not invent coverage.'
 where key = 'adhesive';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0274_flooring_knowledge_carpet_hs_leftover.sql

-- BEGIN 0275_flooring_knowledge_glue_wood_vapor.sql
-- Floor King — flooring knowledge engine, pass 86.
-- Run in the Supabase SQL editor AFTER 0190–0274. Idempotent — safe to re-run.
--
-- Exclusive glue-down over plywood still asked the 6-mil click-floor vapor
-- sheet. You cannot glue to 6-mil poly — Aqua bar stays on moisture
-- mitigation. Hide vapor_barrier once every substrate pick is Plywood /
-- OSB / Wood and the job is glue-down with no floating. Glue over concrete
-- still asks. Mixed floating + glue still asks. Unanswered substrate stays
-- open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed plywood + concrete must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0275_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly; Aqua bar stays on moisture mitigation. Glue over concrete still asks. Mixed floating still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0275_flooring_knowledge_glue_wood_vapor.sql

-- BEGIN 0276_flooring_knowledge_glue_wood_aqua.sql
-- Floor King — flooring knowledge engine, pass 87.
-- Run in the Supabase SQL editor AFTER 0190–0275. Idempotent — safe to re-run.
--
-- Exclusive glue-down / carpet tile over plywood still asked Aqua bar.
-- Aqua bar is a slab coating — not a wood-deck primer. Hide
-- moisture_mitigation once every substrate pick is Plywood / OSB / Wood
-- and the job is glue-down or carpet tile. Moisture test still asks
-- (wood moisture content). Glue over concrete still asks. Mixed plywood
-- + concrete still asks. A moisture-concern flag still asks. Unanswered
-- substrate and unanswered method stay open.
-- Do NOT SQL-gate moisture_mitigation on substrate (0142 — unanswered substrate and mixed plywood + concrete must still ask Aqua bar).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0276_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier except exclusive carpet tile over plywood — Aqua bar is a slab system. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system. Exclusive glue-down or carpet tile over plywood also hides this. Moisture test still asks. Glue over concrete still asks. Mixed plywood + concrete still asks. A moisture-concern flag still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation'
    or id = '2fc7799c-030c-4276-b6fa-801cb9867082';

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood over concrete, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — 0190 is glue-down or wood over concrete, not a wood deck. Glue-down over plywood still asks. Exclusive glue-down or carpet tile over plywood hides Aqua bar — it is a slab system. Mixed LVP still asks. Unanswered substrate stays open. Wet area still asks.'
 where key = 'moisture_test'
    or id = '9400b1d6-9e58-45f8-929d-57dc35dff3be';

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Glue over concrete still asks. Mixed floating still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0276_flooring_knowledge_glue_wood_aqua.sql

-- BEGIN 0277_flooring_knowledge_underlayment_cover.sql
-- Floor King — flooring knowledge engine, pass 88.
-- Run in the Supabase SQL editor AFTER 0190–0276. Idempotent — safe to re-run.
--
-- Unkeyed product questions with category underlayment treated mixed-job
-- cover as carpet rooms. Laminate foam is not carpet pad. Keyed carpet_pad
-- still covers carpet rooms. Keyed hs_underlayment still covers hard-surface
-- rooms. Mixed unkeyed stays 0 rather than cloning pad onto LVP / laminate.
-- Exclusive carpet still uses carpet rooms. Exclusive hard surface still
-- uses prep/HS rooms. Do not invent a roll count or a 30-yard pad default
-- when the catalog SKU has no sold-by unit.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0277_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Do not invent a roll count.'
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0277_flooring_knowledge_underlayment_cover.sql

-- BEGIN 0278_flooring_knowledge_underlayment_units.sql
-- Floor King — flooring knowledge engine, pass 89.
-- Run in the Supabase SQL editor AFTER 0190–0277. Idempotent — safe to re-run.
--
-- Catalog category underlayment is pad yards (SQYD_CATEGORIES). Laminate / LVP
-- foam is the same category but bills by the square foot. Guided Estimate uses
-- the question key + SKU unit so hs_underlayment is not converted to yards.
-- Product area unit wins when the SKU actually stores sq yd or sq ft.
-- Do not invent a 30-yard foam roll.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (carpet pad would plant square feet).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0278_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0278_flooring_knowledge_underlayment_units.sql

-- BEGIN 0279_flooring_knowledge_bulk_pickup.sql
-- Floor King — flooring knowledge engine, pass 90.
-- Run in the Supabase SQL editor AFTER 0190–0278. Idempotent — safe to re-run.
--
-- Bulk pickup day was UUID-only (0142). Overlay, review, and new-construction
-- hide could not attach. Key it as bulk_pickup. New construction hides it with
-- the other tear-out questions. Live show_if still waits for Placed at curb.
-- Overlay require hides haul-away / dumpster once disposal is answered.
-- Unanswered work_type stays open. Do not invent a dumpster fee.
-- Do NOT SQL-gate bulk_pickup on work_type (0142 — unanswered new-vs-replacement must still ask when curb is in play).
-- Do NOT SQL-gate bulk_pickup on demo_disposal (0142 show_if already waits for Placed at curb; overlay require hides haul-away).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0279_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set key = 'bulk_pickup',
       help = 'Municipal bulk pickup day so the old floor is at the curb on time. New construction hides this. Haul-away / dumpster hides this. Unanswered disposal stays open in overlay. Do not invent a disposal charge here.'
 where id = '81a746cb-5374-46d2-b828-c7f0053b3c8f'
    or key = 'bulk_pickup';

update public.estimate_questions
   set help = 'Replacement asks what is coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, and toilet pull/reset — substrate, prep, appliances, and door shaves still apply. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab.'
 where key = 'work_type';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0279_flooring_knowledge_bulk_pickup.sql

-- BEGIN 0280_flooring_knowledge_wall_climate.sql
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

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Site AC/heat and acclimation hide too — a backsplash is not a hardwood acclimation job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, occupancy, delivery, access, and setting materials. Exclusive floor tile also hides the 6-mil vapor-barrier question — thinset is not a click-floor vapor barrier; membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down / carpet tile, from this overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Unanswered and Unknown stay open. Legacy AC/heat yes-no answers still count.'
 where key = 'climate_control';

update public.estimate_questions
   set help = 'Hardwood, glue-down (including glue-down carpet), and carpet tile need acclimation / climate notes. Floating laminate and stretch-in hide this — do not invent a day count. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Leftover Glue-down on exclusive wall does not reopen this.'
 where key = 'acclimation';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0280_flooring_knowledge_wall_climate.sql

-- BEGIN 0281_flooring_knowledge_legacy_climate.sql
-- Floor King — flooring knowledge engine, pass 92.
-- Run in the Supabase SQL editor AFTER 0190–0280. Idempotent — safe to re-run.
--
-- 0142 merged AC and heat into climate_control, but leftover ac_available /
-- heat_available keys still sat on the overlay (no families/systems), so
-- every job listed them. Hide them always. climate_control is the source of truth.
-- climateControlConfirmed still reads leftover Yes answers.
-- Do NOT SQL-gate climate_control on install_method (0142 — unanswered hardwood/glue must still ask climate).
-- Do NOT SQL-gate climate_control on tile_application (0142 — unanswered floor vs wall must still ask AC/heat).
-- Do NOT drop legacy Yes reading from climateControlConfirmed.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0281_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Heat available? was deactivated in 0142. Re-assert. Any leftover AC/heat
-- yes-no keyed rows stay inactive so they cannot reappear on Guided Estimate.
-- Do not touch climate_control (UUID 4f2ec418) — that is the live question.
update public.estimate_questions
   set active = false
 where key in ('ac_available', 'heat_available')
    or id = 'e3bcf27d-cddd-44ee-8fef-70ff38056649';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down / carpet tile, from this overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Unanswered and Unknown stay open. Legacy AC/heat yes-no answers still count. Leftover AC available / Heat available questions stay off the overlay — climate_control is the source of truth.'
 where key = 'climate_control';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0281_flooring_knowledge_legacy_climate.sql

-- BEGIN 0282_flooring_knowledge_legacy_curb.sql
-- Floor King — flooring knowledge engine, pass 93.
-- Run in the Supabase SQL editor AFTER 0190–0281. Idempotent — safe to re-run.
--
-- 0142 merged Placed on the curb into demo_disposal, but leftover carpet_curb
-- still sat on the overlay (carpet family), so every carpet job listed it.
-- Hide it always. demo_disposal is the source of truth. Review still buckets
-- leftover answers. bulk_pickup still waits for Placed at curb.
-- Do NOT SQL-gate bulk_pickup on demo_disposal (0142 show_if already waits for Placed at curb; overlay require hides haul-away).
-- Do NOT SQL-gate demo_disposal on carpet_curb (0142 — unanswered disposal must still ask haul vs curb).
-- Do NOT drop leftover carpet_curb from review SPECIAL_KEYS.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0282_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

-- Placed on the curb? was deactivated in 0142 (now a demo_disposal chip).
-- Re-assert. Do not touch bulk_pickup (UUID 81a746cb) — that is the live
-- municipal pickup-day follow-up.
update public.estimate_questions
   set active = false
 where key = 'carpet_curb'
    or id = 'a07eb68f-91b6-4fe7-8237-bb0e9986076c';

update public.estimate_questions
   set help = 'Haul away, dumpster, or placed at curb. Placed at curb opens bulk pickup day. Leftover Placed-on-the-curb yes-no stays off the overlay — demo_disposal is the source of truth. New construction hides this. Unanswered stays open. Do not invent a dumpster fee.'
 where key = 'demo_disposal';

update public.estimate_questions
   set help = 'Municipal bulk pickup day so the old floor is at the curb on time. New construction hides this. Haul-away / dumpster hides this. Unanswered disposal stays open in overlay. Leftover Placed-on-the-curb yes-no is not this question — Placed at curb on demo_disposal is. Do not invent a disposal charge here.'
 where key = 'bulk_pickup';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0282_flooring_knowledge_legacy_curb.sql

-- BEGIN 0283_flooring_knowledge_carpet_install_method.sql
-- Floor King — flooring knowledge engine, pass 94.
-- Run in the Supabase SQL editor AFTER 0190–0282. Idempotent — safe to re-run.
--
-- Exclusive carpet still listed the hard-surface Install method picker on
-- overlay walks. Stretch-in / glue-down / carpet tile stay on Carpet install.
-- Hide install_method once the job is carpet-only. Mixed Carpet + LVP still
-- asks. Unanswered hard surface stays open. Leftover Floating / Glue-down
-- chips do not reopen it.
-- Do NOT SQL-gate install_method on carpet_install (0142 — mixed Carpet + LVP leftover Floating must still ask hard-surface method).
-- Do NOT SQL-gate install_method on surface_type (0142 — unanswered HS must still ask install method).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0283_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, or thinset — pick every hard-surface method in play. Exclusive carpet hides this hard-surface method picker. Stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Floating / Glue-down chips do not reopen it on a carpet-only job.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0283_flooring_knowledge_carpet_install_method.sql

-- BEGIN 0284_flooring_knowledge_carpet_surface.sql
-- Floor King — flooring knowledge engine, pass 95.
-- Run in the Supabase SQL editor AFTER 0190–0283. Idempotent — safe to re-run.
--
-- Exclusive carpet still listed Surface type (the hard-surface family picker)
-- on overlay walks. LVP / hardwood / laminate / tile / sheet vinyl are not a
-- carpet-only job. Hide surface_type once the job is exclusive carpet.
-- Mixed Carpet + LVP still asks. Unanswered hard surface stays open.
-- Leftover Hardwood chips do not reopen it.
-- Do NOT SQL-gate surface_type on carpet_install (0142 — mixed Carpet + LVP leftover Hardwood must still ask surface type).
-- Do NOT SQL-gate surface_type on project_type (0142 show_if already waits for Hard surface; overlay hide is exclusive carpet).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0284_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'LVP, hardwood, laminate, tile, or sheet vinyl. Exclusive carpet hides this — stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Hardwood chips do not reopen it on a carpet-only job.'
 where key = 'surface_type';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0284_flooring_knowledge_carpet_surface.sql

-- BEGIN 0285_flooring_knowledge_carpet_surface_leftover.sql
-- Floor King — flooring knowledge engine, pass 96.
-- Run in the Supabase SQL editor AFTER 0190–0284. Idempotent — safe to re-run.
--
-- Leftover Surface type (Hardwood / LVP / …) on exclusive carpet still
-- unioned hard-surface families, so overlay asked finish, fasteners, vapor,
-- and plank stairs. That leftover chip does not switch finish, fasteners, vapor,
-- or Install method — it is not a mixed job. Ignore it for overlay families
-- — same as leftover Floating on install_method (0274). Mixed Carpet + LVP
-- still unions Surface type. Unanswered hard surface stays open. Assigned
-- hardwood products still add the family. Unanswered project_type still
-- reads Surface type (0142).
-- Do NOT SQL-gate hardwood_finish on project_type (0142 — mixed Carpet + hardwood must still ask finish).
-- Do NOT SQL-gate surface_type on carpet_install (0142 — mixed leftover Hardwood must still ask surface type).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0285_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'LVP, hardwood, laminate, tile, or sheet vinyl. Exclusive carpet hides this — stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Hardwood chips do not reopen finish, fasteners, vapor, or Install method on a carpet-only job.'
 where key = 'surface_type';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Leftover Hardwood on Surface type does not reopen finish, fasteners, or vapor. Mixed Carpet + LVP still asks those. Do not invent a box size.'
 where key = 'carpet_install';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0285_flooring_knowledge_carpet_surface_leftover.sql

-- BEGIN 0286_flooring_knowledge_hs_carpet_leftover.sql
-- Floor King — flooring knowledge engine, pass 97.
-- Run in the Supabase SQL editor AFTER 0190–0285. Idempotent — safe to re-run.
--
-- Leftover Carpet install (Glue-down / Carpet tile / Stretch-in) on exclusive
-- hard surface still unioned carpet systems, so overlay asked adhesive,
-- moisture test, and acclimation on a floating LVP job. That leftover chip
-- does not switch adhesive, moisture test, or acclimation — it is not a
-- mixed job. Ignore leftover Carpet install when Carpet is not in play —
-- same as leftover Floating on exclusive carpet (0274). Mixed Carpet + LVP
-- still unions Carpet install. Unanswered carpet stays open. Assigned
-- carpet products still add the family.
-- Do NOT SQL-gate adhesive on carpet_install (0142 — mixed Carpet + LVP leftover Glue-down must still ask adhesive).
-- Do NOT SQL-gate carpet_install on surface_type (0142 — mixed leftover Stretch-in must still ask Carpet install).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0286_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Leftover Hardwood on Surface type does not reopen finish, fasteners, or vapor. Leftover Glue-down / Carpet tile on exclusive LVP is a carpet chip — it does not open adhesive, moisture test, or acclimation. Mixed Carpet + LVP still unions Carpet install. Do not invent a box size.'
 where key = 'carpet_install';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0286_flooring_knowledge_hs_carpet_leftover.sql

-- BEGIN 0287_flooring_knowledge_extra_pad_measured.sql
-- Floor King — flooring knowledge engine, pass 98.
-- Run in the Supabase SQL editor AFTER 0190–0286. Idempotent — safe to re-run.
--
-- Additional pad for a specific area (stairs, landing) was labeled Area /
-- sq ft, so a salesperson could type a roll or billing yards into measured
-- square feet. That field is MEASURED sq ft — not a 30-yard roll and not
-- the billing unit. Carpet pad still bills in square yards unless the SKU
-- is feet. Foam stays on hs_underlayment. A pad SKU with no sold-by unit
-- stays How many / Unit TBD, not taped square feet.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (carpet pad would plant square feet).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0287_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0287_flooring_knowledge_extra_pad_measured.sql

-- BEGIN 0288_flooring_knowledge_dead_stair_gate.sql
-- Floor King — flooring knowledge engine, pass 99.
-- Run in the Supabase SQL editor AFTER 0190–0287. Idempotent — safe to re-run.
--
-- Generic Stairs yes/no is a leftover synthesizer. Live stair questions are
-- Carpet stairs, Carpet tile stairs, and hard-surface plank stairs.
-- Overlay hides the dead gate once a family-specific stair question is in
-- play. Landings / open sides still follow those Yes answers via
-- synthesizeStairGate. Unanswered project_type stays open. Exclusive wall
-- already hides stairs. Mixed Carpet + LVP still asks both family stairs.
-- Do NOT SQL-gate stair_landings on carpet_stairs (0142 — synthesizeStairGate copies Yes onto stairs).
-- Do NOT SQL-gate stairs on carpet_install (0142 — unanswered project_type must still ask the leftover gate).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0288_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stairs change material, labor, and trim. Exclusive wall tile hides this — a backsplash is not a stair job. Mixed carpet or LVP + wall still asks the family-specific stair questions. This leftover yes/no hides once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Unanswered project_type stays open. Field verify if you have not seen them.'
 where key = 'stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0288_flooring_knowledge_dead_stair_gate.sql

-- BEGIN 0289_flooring_knowledge_carpet_tile_metals.sql
-- Floor King — flooring knowledge engine, pass 100.
-- Run in the Supabase SQL editor AFTER 0190–0288. Idempotent — safe to re-run.
--
-- Exclusive carpet tile still asked gripper / flat metals. Those are binder
-- bars for roll goods, not modular tile. Overlay hides metals_needed plus
-- qty / type / color once carpet_install is exclusively Carpet tile.
-- Stretch-in and glue-down keep them. Mixed stretch-in + tile still asks.
-- Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars.
-- Leftover Yes on exclusive tile does not reopen qty/type/color.
-- Unanswered carpet install stays open.
-- Do NOT SQL-gate metals_needed on carpet_install (0142 — unanswered carpet and mixed stretch-in + tile must still ask doorway metals).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0289_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Carpet-to-hard-surface doorways and edges. Yes opens the count (EACH) plus type/color. Exclusive carpet tile hides this — gripper and flat metals are binder bars for roll goods, not modular tile. Stretch-in and glue-down keep it. Mixed stretch-in + tile still asks. Unanswered stays open. Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars. Leftover Yes on exclusive tile does not reopen qty/type/color. Do not invent a metal price here.'
 where key = 'metals_needed';

update public.estimate_questions
   set help = 'Count of metals / transitions in EACH — never square feet. Exclusive carpet tile hides this with metals needed — modular tile is not a binder-bar count. Pick a catalog gripper or flat metal in Builder if Floor King sells it.'
 where key = 'metals_qty';

update public.estimate_questions
   set help = 'Gripper vs flat. Exclusive carpet tile hides this with metals needed. The count is the previous step — this does not add a second charge.'
 where key = 'metal_type';

update public.estimate_questions
   set help = 'Silver / titanium / gold. Exclusive carpet tile hides this with metals needed. This does not invent a metal SKU.'
 where key = 'metal_color';

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides gripper/flat metals — binder bars for roll goods, not modular tile. Stretch-in and glue-down keep metals. Mixed stretch-in + tile still asks metals. Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Leftover Hardwood on Surface type does not reopen finish, fasteners, or vapor. Leftover Glue-down / Carpet tile on exclusive LVP is a carpet chip — it does not open adhesive, moisture test, or acclimation. Mixed Carpet + LVP still unions Carpet install. Do not invent a box size.'
 where key = 'carpet_install';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0289_flooring_knowledge_carpet_tile_metals.sql

-- BEGIN 0290_flooring_knowledge_glue_existing_vapor.sql
-- Floor King — flooring knowledge engine, pass 101.
-- Run in the Supabase SQL editor AFTER 0190–0289. Idempotent — safe to re-run.
--
-- Exclusive glue-down over Existing flooring still asked the 6-mil click-floor
-- vapor sheet and Aqua bar. You glue to the existing floor or tear it out —
-- not to 6-mil poly. Aqua bar is a slab coating, not an existing-floor primer.
-- Hide vapor_barrier once every substrate pick is Existing flooring and the
-- job is glue-down with no floating. Hide moisture_mitigation once exclusive
-- glue-down or carpet tile is over Existing flooring. Moisture test still
-- asks (unknown what is under). Glue over concrete still asks both. Mixed
-- floating + glue still asks vapor. Mixed existing + concrete stays open.
-- A moisture-concern flag still asks Aqua bar. Unanswered substrate stays
-- open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed existing + concrete must still ask vapor barrier).
-- Do NOT SQL-gate moisture_mitigation on substrate (0142 — unanswered substrate and mixed existing + concrete must still ask Aqua bar).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0290_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Glue over concrete still asks. Mixed floating still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier except exclusive carpet tile over plywood — Aqua bar is a slab system. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system. Exclusive glue-down or carpet tile over plywood also hides this. Exclusive glue-down or carpet tile over existing flooring also hides this — Aqua bar is a slab coating, not an existing-floor primer. Moisture test still asks. Glue over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. A moisture-concern flag still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0290_flooring_knowledge_glue_existing_vapor.sql

-- BEGIN 0291_flooring_knowledge_wood_deck_vapor.sql
-- Floor King — flooring knowledge engine, pass 102.
-- Run in the Supabase SQL editor AFTER 0190–0290. Idempotent — safe to re-run.
--
-- Exclusive floating over plywood still asked the 6-mil click-floor vapor
-- sheet. 6-mil is a slab sheet, not a wood-deck underlayment. Hide
-- vapor_barrier once every substrate pick is Plywood / OSB / Wood and the
-- install method is answered (or inferred). Exclusive floating, glue, and
-- mixed floating + glue over plywood all hide. Glue / floating over
-- concrete still ask. Mixed plywood + concrete stays open. Unanswered
-- substrate and unanswered LVP method stay open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed plywood + concrete must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0291_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive plywood also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not a wood-deck underlayment. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Glue over concrete still asks. Floating over concrete still asks. Mixed plywood + concrete still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0291_flooring_knowledge_wood_deck_vapor.sql

-- BEGIN 0292_flooring_knowledge_existing_floor_vapor.sql
-- Floor King — flooring knowledge engine, pass 103.
-- Run in the Supabase SQL editor AFTER 0190–0291. Idempotent — safe to re-run.
--
-- Exclusive floating over Existing flooring still asked the 6-mil click-floor
-- vapor sheet. 6-mil is a slab sheet, not an existing-floor underlayment.
-- Hide vapor_barrier once every substrate pick is Existing flooring and the
-- install method is answered (or inferred). Exclusive floating, glue, and
-- mixed floating + glue over existing flooring all hide. Glue / floating
-- over concrete still ask. Mixed existing + concrete stays open.
-- Unanswered substrate and unanswered LVP method stay open.
-- Do NOT SQL-gate vapor_barrier on substrate (0142 — unanswered substrate and mixed existing + concrete must still ask vapor barrier).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0292_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive plywood also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not a wood-deck underlayment. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Exclusive existing flooring also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not an existing-floor underlayment. Glue over concrete still asks. Floating over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0292_flooring_knowledge_existing_floor_vapor.sql

-- BEGIN 0293_flooring_knowledge_dead_stair_followups.sql
-- Floor King — flooring knowledge engine, pass 104.
-- Run in the Supabase SQL editor AFTER 0190–0292. Idempotent — safe to re-run.
--
-- Generic Stairs yes/no is overlay-hidden once family-specific stairs are
-- live. Landings / open sides still required leftover stairs=Yes, so
-- unanswered require on that hidden parent kept them open on every carpet
-- and hard-surface overlay walk. Hide stair_landings and stair_open_sides
-- until Carpet stairs, Carpet tile stairs, or hard-surface plank stairs is
-- Yes. Leftover stairs=Yes without a family Yes does not reopen them —
-- hidden answers do not gate. Unanswered project_type stays open.
-- Do NOT SQL-gate stair_landings on carpet_stairs (0142 — synthesizeStairGate copies family Yes onto stairs; live show_if still waits for that Yes).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0293_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Count of landings in EACH. Measured with the rooms when they are floored the same; this flags extra pieces and noses. Exclusive wall tile hides this — a backsplash is not a stair job. Leftover Stairs yes/no hides this once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Unanswered project_type stays open.'
 where key = 'stair_landings';

update public.estimate_questions
   set help = 'Open sides change wrapped carpet ends and hard-surface nosing. Exclusive wall tile hides this. Leftover Stairs yes/no hides this once family-specific stairs are in play — open sides still follow those Yes answers. Capture the construction — pricing still uses existing stair labor.'
 where key = 'stair_open_sides';

update public.estimate_questions
   set help = 'Stairs change material, labor, and trim. Exclusive wall tile hides this — a backsplash is not a stair job. Mixed carpet or LVP + wall still asks the family-specific stair questions. This leftover yes/no hides once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Leftover landings / open sides hide until a family stair question is Yes. Unanswered project_type stays open. Field verify if you have not seen them.'
 where key = 'stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0293_flooring_knowledge_dead_stair_followups.sql

-- BEGIN 0294_flooring_knowledge_pad_takeoff.sql
-- Floor King — flooring knowledge engine, pass 105.
-- Run in the Supabase SQL editor AFTER 0190–0293. Idempotent — safe to re-run.
--
-- Catalog underlayment maps to family other, so pad / foam never reached
-- Review takeoff. Show measured area vs billing quantity (pad yards, foam
-- feet) instead of skipping the product or inventing a 30-yard roll.
-- Waste stays 0 unless the product has a waste percent. Carton coverage is
-- not invented. A pad SKU with no sold-by unit stays How many / Unit TBD
-- in Builder — Review takeoff is measured vs billing, not a planted qty.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Does NOT invent carton coverage / 30-yard roll.
--
-- Does NOT invent catalog categories or prices.
-- Does NOT enable accounting.

-- P0_0294_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment'
    or id = '4dd450f1-d003-445c-9135-6477f2a98e9c';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0294_flooring_knowledge_pad_takeoff.sql

-- BEGIN 0295_flooring_knowledge_existing_floor_aqua.sql
-- Floor King — flooring knowledge engine, pass 106.
-- Run in the Supabase SQL editor AFTER 0190–0294. Idempotent — safe to re-run.
--
-- Aqua bar is a slab coating. Exclusive glue / carpet tile over existing
-- flooring already hid it (0290). Exclusive hardwood nail / staple /
-- floating over existing flooring still asked it. Hide moisture_mitigation
-- once every substrate pick is Existing flooring. Moisture test still
-- asks (unknown what's under). Mixed existing + concrete stays open. A
-- moisture-concern flag still asks. Unanswered substrate stays open.
-- Do NOT SQL-gate moisture_mitigation on substrate (0142 — mixed existing + concrete must still ask Aqua bar).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0295_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier except exclusive carpet tile over plywood — Aqua bar is a slab system. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system. Exclusive glue-down or carpet tile over plywood also hides this. Exclusive glue-down or carpet tile over existing flooring also hides this — Aqua bar is a slab coating, not an existing-floor primer. Exclusive hardwood nail/staple/floating over existing flooring also hides this. Moisture test still asks. Glue over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. A moisture-concern flag still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.'
 where key = 'moisture_mitigation';

update public.estimate_questions
   set help = 'Glue-down, carpet tile, hardwood over concrete, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — 0190 is glue-down or wood over concrete, not a wood deck. Glue-down over plywood still asks. Exclusive glue-down or carpet tile over plywood hides Aqua bar — it is a slab system. Exclusive hardwood nail/staple/floating over existing flooring also hides Aqua bar — it is a slab coating, not an existing-floor primer. Moisture test still asks. Mixed LVP still asks. Unanswered substrate stays open. Wet area still asks.'
 where key = 'moisture_test';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0295_flooring_knowledge_existing_floor_aqua.sql

-- BEGIN 0296_flooring_knowledge_new_build_furniture.sql
-- Floor King — flooring knowledge engine, pass 107.
-- Run in the Supabase SQL editor AFTER 0190–0295. Idempotent — safe to re-run.
--
-- Furniture moving is for occupied replacement floors. Vacant already hides
-- it. Exclusive new construction still asked light/medium/heavy and piano /
-- pool-table notes — a new slab has no furniture to move. Hide
-- furniture_level and furniture_heavy once every work-type pick is New
-- construction. Mixed Replacement + New construction stays open. Unanswered
-- stays open. Occupied new construction still hides furniture.
-- Do NOT SQL-gate furniture on work_type (0142 — mixed Replacement + New construction must still ask furniture).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0296_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Light / medium / heavy uses Floor King''s furniture-moving labor. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job. Exclusive new construction hides this — a new slab has no furniture to move. Mixed Replacement + New construction still asks. Specialty items (piano, pool table) stay on the next question as scope.'
 where key = 'furniture_level';

update public.estimate_questions
   set help = 'Pianos, pool tables, and loaded cabinets are scope/schedule notes unless this job already has a furniture-moving labor line. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job. Exclusive new construction hides this — a new slab has no furniture to move. Mixed Replacement + New construction still asks.'
 where key = 'furniture_heavy';

update public.estimate_questions
   set help = 'Occupied vs vacant. Vacant hides furniture moving — empty house, do not invent a furniture charge. Exclusive wall tile also hides it — a backsplash is not a furniture-moving job. Exclusive new construction also hides it — a new slab has no furniture to move. Occupied and Unknown still ask light/medium/heavy. Unanswered stays open.'
 where key = 'occupancy';

update public.estimate_questions
   set help = 'Replacement asks what''s coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab.'
 where key = 'work_type';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0296_flooring_knowledge_new_build_furniture.sql

-- BEGIN 0297_flooring_knowledge_loose_lay_vapor.sql
-- Floor King — flooring knowledge engine, pass 108.
-- Run in the Supabase SQL editor AFTER 0190–0296. Idempotent — safe to re-run.
--
-- 6-mil click-floor vapor is a floating / glue sheet. Exclusive loose-lay
-- still asked for it over concrete. Loose-lay is not a click-floor sheet
-- and not glue-down — hide vapor_barrier once the only system is loose-lay,
-- including over concrete. Mixed floating + loose-lay stays open. Mixed
-- Carpet + LVP loose-lay stays open so stretch / glue over concrete still
-- asks. Leftover Loose-lay on exclusive carpet still asks over concrete.
-- Leftover Loose-lay on laminate coalesces to floating and still asks over
-- concrete. Unanswered LVP stays open.
-- Do NOT SQL-gate vapor_barrier on install_method (0142 — mixed floating + loose-lay must still ask 6-mil).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0297_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive plywood also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not a wood-deck underlayment. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Exclusive existing flooring also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not an existing-floor underlayment. Exclusive loose-lay hides this — loose-lay is not a click-floor 6-mil sheet, including over concrete. Mixed floating + loose-lay still asks. Mixed Carpet + LVP loose-lay still asks. Leftover Loose-lay on exclusive carpet still asks over concrete. Leftover Loose-lay on laminate coalesces to floating and still asks over concrete. Unanswered LVP stays open. Glue over concrete still asks. Floating over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.'
 where key = 'vapor_barrier';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0297_flooring_knowledge_loose_lay_vapor.sql

-- BEGIN 0298_flooring_knowledge_non_vinyl_skim.sql
-- Floor King — flooring knowledge engine, pass 109.
-- Run in the Supabase SQL editor AFTER 0190–0297. Idempotent — safe to re-run.
--
-- Existing-vinyl skim is for embossed vinyl, not every sheet-vinyl job.
-- Exclusive carpet / LVP / hardwood / ceramic / luan tear-out still asked
-- it. Hide vinyl_skim once every demo pick names a non-vinyl floor. None
-- stays open — encapsulating existing vinyl has no tear-out chip. Other /
-- Unknown stay open. Sheet vinyl demo still asks. Mixed Carpet + Sheet
-- vinyl stays open. Unanswered stays open. New construction already hides.
-- Do NOT SQL-gate vinyl_skim on hs_demo (0142 — unanswered and mixed Carpet + Sheet vinyl must still ask skim).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0298_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Embossed existing vinyl often needs a skim coat. New construction hides this — there is no existing vinyl. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out also hides this — that demo is not existing vinyl. None still asks — encapsulating existing vinyl has no tear-out chip. Other / Unknown stay open. Sheet vinyl demo still asks. Mixed Carpet + Sheet vinyl still asks. Unanswered stays open. If you cannot see it until demo, pick Field verify — do not invent a bag count here.'
 where key = 'vinyl_skim';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0298_flooring_knowledge_non_vinyl_skim.sql

-- BEGIN 0299_flooring_knowledge_illegal_leftover.sql
-- Floor King — flooring knowledge engine, pass 110.
-- Run in the Supabase SQL editor AFTER 0190–0298. Idempotent — safe to re-run.
--
-- Leftover illegal install chips were switching overlay follow-ups. Exclusive
-- solid hardwood leftover Floating hid fasteners and adhesive that unanswered
-- solid still asks. Exclusive LVP leftover Nail hid pad / expansion.
-- Exclusive engineered leftover Loose-lay hid both branches. leftover illegal chips do not switch
-- overlay follow-ups on an exclusive single hard-surface family. Mixed LVP +
-- hardwood keeps every chip. Laminate leftover Glue still coalesces to floating.
-- Do NOT SQL-gate hardwood_fasteners on install_method (0142 — mixed LVP + hardwood Nail-down must still ask fasteners).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0299_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Nail/staple jobs need fasteners. Pick the catalog item in Builder — this question only records the need. Leftover Floating on exclusive solid hardwood does not hide this — leftover illegal chips do not switch overlay follow-ups. Mixed LVP + hardwood still asks when Nail-down is in play.'
 where key = 'hardwood_fasteners';

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, or thinset — pick every hard-surface method in play. Exclusive carpet hides this hard-surface method picker. Stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Floating / Glue-down chips do not reopen it on a carpet-only job. Leftover Floating on exclusive solid hardwood does not hide fasteners or adhesive — leftover illegal chips do not switch overlay follow-ups.'
 where key = 'install_method';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0299_flooring_knowledge_illegal_leftover.sql

-- BEGIN 0300_flooring_knowledge_lvp_fasteners.sql
-- Floor King — flooring knowledge engine, pass 111.
-- Run in the Supabase SQL editor AFTER 0190–0299. Idempotent — safe to re-run.
--
-- Hardwood fasteners are nail / staple. Exclusive LVP still asked them once
-- leftover Nail-down passed SQL show_if, and live 0191 knowledge_when is
-- systems-only so the overlay systems gate stayed open after 0299 strip.
-- Hide hardwood_fasteners once the surface is exclusive LVP / laminate /
-- vinyl / tile — leftover Nail-down on LVP does not reopen. Mixed LVP +
-- hardwood still asks. Unanswered hard surface stays open.
-- Do NOT SQL-gate hardwood_fasteners on surface_type (0142 — unanswered HS and mixed LVP + hardwood must still ask fasteners).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0300_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Nail/staple jobs need fasteners. Pick the catalog item in Builder — this question only records the need. Exclusive LVP / laminate / vinyl / tile hide this — leftover Nail-down on LVP does not reopen it. Leftover Floating on exclusive solid hardwood does not hide this — leftover illegal chips do not switch overlay follow-ups. Mixed LVP + hardwood still asks when Nail-down is in play. Unanswered hard surface stays open.'
 where key = 'hardwood_fasteners';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0300_flooring_knowledge_lvp_fasteners.sql

-- BEGIN 0301_flooring_knowledge_non_carpet_pad.sql
-- Floor King — flooring knowledge engine, pass 112.
-- Run in the Supabase SQL editor AFTER 0190–0300. Idempotent — safe to re-run.
--
-- Existing pad and tack follow OLD carpet. Installing new carpet still asked
-- them once leftover families carpet kept the overlay open, even after demo
-- was exclusive LVP / hardwood / ceramic / luan / sheet vinyl. Hide
-- existing_pad and existing_tack once every demo pick is non-carpet. Carpet
-- demo still asks. Mixed Carpet + LVP still asks. None / Other / Unknown
-- stay open. Unanswered stays open.
-- Do NOT SQL-gate existing_pad on hs_demo (0142 — unanswered carpet and mixed Carpet + LVP demo must still ask pad).
-- Do NOT SQL-gate existing_tack on hs_demo (0142 — unanswered carpet and mixed Carpet + LVP demo must still ask tack).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0301_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Tearing out carpet — to carpet or to hard surface — usually takes the pad with it. Reuse only when the salesperson explicitly allows it. This follows the existing floor, not only a new-carpet job. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides this — that demo is not old carpet. None / Other / Unknown stay open. Mixed Carpet + LVP still asks. Unanswered stays open. Do not invent a second demo rate; the tear-out line gets a pad note.'
 where key = 'existing_pad';

update public.estimate_questions
   set help = 'Tearing out carpet usually takes tack strip with it. Keep is unusual. This is not new stretch-in tack strip — that stays on the install step. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides this with existing pad — that demo is not old carpet. None / Other / Unknown stay open. Mixed Carpet + LVP still asks. Unanswered stays open. Linear feet stay off until you add a catalog item. Do not invent a linear-foot price.'
 where key = 'existing_tack';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0301_flooring_knowledge_non_carpet_pad.sql

-- BEGIN 0302_flooring_knowledge_none_disposal.sql
-- Floor King — flooring knowledge engine, pass 113.
-- Run in the Supabase SQL editor AFTER 0190–0301. Idempotent — safe to re-run.
--
-- Haul-away / dumpster / curb and bulk pickup still asked after demo was
-- exclusive None. Nothing is coming up, so there is nothing to dispose.
-- Hide demo_disposal and bulk_pickup once every demo pick is None. Carpet /
-- LVP / ceramic demo still asks. Mixed None + Carpet stays open. Other /
-- Unknown stay open. Unanswered stays open.
-- Do NOT SQL-gate demo_disposal on hs_demo (0142 — unanswered demo and Carpet demo must still ask disposal).
-- Do NOT SQL-gate bulk_pickup on hs_demo (0142 — unanswered disposal and Placed at curb must still ask bulk pickup).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0302_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Haul away, dumpster, or placed at curb. Placed at curb opens bulk pickup day. Leftover Placed-on-the-curb yes-no stays off the overlay — demo_disposal is the source of truth. New construction hides this. Exclusive None demo hides this — nothing is coming up, so there is nothing to haul. Other / Unknown still ask. Unanswered stays open. Do not invent a dumpster fee.'
 where key = 'demo_disposal';

update public.estimate_questions
   set help = 'Municipal bulk pickup day so the old floor is at the curb on time. New construction hides this. Haul-away / dumpster hides this. Exclusive None demo hides this with haul-away — nothing is coming up. Unanswered disposal stays open in overlay. Leftover Placed-on-the-curb yes-no is not this question — Placed at curb on demo_disposal is. Do not invent a disposal charge here.'
 where key = 'bulk_pickup';

update public.estimate_questions
   set help = 'What''s coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Unanswered stays open. Do not invent a second tear-out rate.'
 where key = 'hs_demo';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0302_flooring_knowledge_none_disposal.sql

-- BEGIN 0303_flooring_knowledge_tile_install_method.sql
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

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Floating/click, glue-down, nail, staple, loose-lay, or thinset — pick every hard-surface method in play. Exclusive carpet hides this hard-surface method picker. Exclusive tile also hides this — thinset stays on Tile setting, not Floating / Glue-down / Nail-down. Mixed LVP + tile still asks. Stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Floating / Glue-down chips do not reopen it on a carpet-only job. Leftover Floating on exclusive solid hardwood does not hide fasteners or adhesive — leftover illegal chips do not switch overlay follow-ups. Leftover Floating / click on exclusive tile does not reopen this.'
 where key = 'install_method';

update public.estimate_questions
   set help = 'Thinset, grout, and backer come from the catalog in Builder. This records the need — bag counts stay TBD unless a product with coverage is actually picked. Taped square feet is not bags of thinset. Exclusive tile hides the hard-surface Install method picker — thinset is this question, not Floating / Glue-down / Nail-down. Exclusive tile hides the 6-mil vapor-barrier question; crack isolation / uncoupling membranes belong here, not on that floating-floor sheet.'
 where key = 'tile_setting';

update public.estimate_questions
   set help = 'Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Site AC/heat and acclimation hide too — a backsplash is not a hardwood acclimation job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, occupancy, delivery, access, and setting materials. Exclusive tile hides the hard-surface Install method picker — thinset stays on Tile setting. Exclusive floor tile also hides the 6-mil vapor-barrier question — thinset is not a click-floor vapor barrier; membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.'
 where key = 'tile_application';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0303_flooring_knowledge_tile_install_method.sql

-- BEGIN 0304_flooring_knowledge_extra_pad_tbd.sql
-- Floor King — flooring knowledge engine, pass 115.
-- Run in the Supabase SQL editor AFTER 0190–0303. Idempotent — safe to re-run.
--
-- Extra pad / foam with no sold-by unit still required typing measured sq ft
-- then discarded it on the count TBD path. A pad SKU with no sold-by unit is
-- How many / Unit TBD in Builder — not taped square feet. Emit TBD without
-- requiring measured sq ft. Area-unit extras still ask MEASURED sq ft.
-- Do not plant leftover sq ft.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0304_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0304_flooring_knowledge_extra_pad_tbd.sql

-- BEGIN 0305_flooring_knowledge_extra_leftover_sqft.sql
-- Floor King — flooring knowledge engine, pass 116.
-- Run in the Supabase SQL editor AFTER 0190–0304. Idempotent — safe to re-run.
--
-- Extra pad / foam with a count or TBD sold-by unit still carried leftover
-- typed square feet onto Review takeoff as pad yards / foam feet. Review
-- takeoff ignores leftover measured sq ft on a count or TBD extra — do not
-- plant leftover sq ft as pad yards. Area-unit extras still use MEASURED sq ft.
-- Do not invent a 30-yard roll.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0305_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0305_flooring_knowledge_extra_leftover_sqft.sql

-- BEGIN 0306_flooring_knowledge_extra_count_qty.sql
-- Floor King — flooring knowledge engine, pass 117.
-- Run in the Supabase SQL editor AFTER 0190–0305. Idempotent — safe to re-run.
--
-- Extra pad / foam sold by roll / each / gal still emitted as silent TBD
-- with no quantity. A pad SKU with a count unit asks How many in that unit
-- — not taped square feet and not a 30-yard roll. Empty sold-by unit stays
-- TBD in Builder. Area-unit extras still ask MEASURED sq ft.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0306_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. A pad SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. A foam SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0306_flooring_knowledge_extra_count_qty.sql

-- BEGIN 0307_flooring_knowledge_extra_count_review.sql
-- Floor King — flooring knowledge engine, pass 118.
-- Run in the Supabase SQL editor AFTER 0190–0306. Idempotent — safe to re-run.
--
-- Extra pad / foam sold by roll / each / gal asked How many (0306) but Review
-- still skipped the extra because leftover taped sq ft is not pad yards.
-- Typed How many rides onto Review as that count — leftover taped sq ft
-- still is not pad yards and not a 30-yard roll. Empty qty stays off Review
-- (Builder still emits TBD). Do not call computeMaterialTakeoff for count extras.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0307_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. A pad SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. A foam SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0307_flooring_knowledge_extra_count_review.sql

-- BEGIN 0308_flooring_knowledge_main_pad_count.sql
-- Floor King — flooring knowledge engine, pass 119.
-- Run in the Supabase SQL editor AFTER 0190–0307. Idempotent — safe to re-run.
--
-- Main pad / foam sold by roll / each / gal still converted room square
-- feet into Review pad yards (or foam feet). Count / TBD main SKUs skip
-- area Review takeoff — leftover / job sq ft is not pad yards and not a
-- 30-yard roll. Area-unit pad still uses measured vs billing yards.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0308_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. A pad SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main pad SKU sold by roll / each / gal does not convert room square feet into pad yards on Review. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. A foam SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main foam SKU sold by roll / each / gal does not convert room square feet into foam feet on Review. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0308_flooring_knowledge_main_pad_count.sql

-- BEGIN 0309_flooring_knowledge_main_count_qty.sql
-- Floor King — flooring knowledge engine, pass 120.
-- Run in the Supabase SQL editor AFTER 0190–0308. Idempotent — safe to re-run.
--
-- Main pad / foam / adhesive sold by roll / each / gal still emitted as
-- silent TBD and the pad question still showed room sq ft as takeoff
-- yards. A main count SKU asks How many in that unit — room square feet
-- is not pad yards, not foam feet, and not a glue order. Empty sold-by
-- unit stays TBD. Area-unit pad still uses measured vs billing yards.
-- Do NOT SQL-gate carpet_pad on surface_type (0142 — mixed Carpet + LVP must still ask pad on the carpet rooms).
-- Do NOT SQL-gate adhesive on surface_type (0142 — mixed LVP still asks glue).
-- Do NOT drop underlayment from SQYD_CATEGORIES (pad still bills yards; foam stay feet via areaBillsBySquareYard).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0309_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. A pad SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main pad SKU sold by roll / each / gal does not convert room square feet into pad yards on Review. A main pad SKU sold by the roll / each / gal asks How many in that unit — room square feet is not pad yards and not a 30-yard roll. Do not invent a 30-yard foam roll.'
 where key = 'carpet_pad';

update public.estimate_questions
   set help = 'Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. A foam SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main foam SKU sold by roll / each / gal does not convert room square feet into foam feet on Review. A main foam SKU sold by the roll / each / gal asks How many in that unit — room square feet is not foam feet and not a 30-yard roll. Do not invent a 30-yard roll.'
 where key = 'hs_underlayment';

update public.estimate_questions
   set help = 'Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Exclusive laminate leftover Glue-down does not show this — laminate is floating. Exclusive sheet vinyl leftover Floating still asks this — sheet vinyl is glue-down. Carpet-only leftover Glue-down does not show this — carpet glue is on Carpet install. Mixed LVP still asks. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. A glue SKU sold by the gal / kit / each asks How many in that unit — taped square feet is not a glue order. Do not invent coverage.'
 where key = 'adhesive';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0309_flooring_knowledge_main_count_qty.sql

-- BEGIN 0310_flooring_knowledge_stair_wrap_qty.sql
-- Floor King — flooring knowledge engine, pass 121.
-- Run in the Supabase SQL editor AFTER 0190–0309. Idempotent — safe to re-run.
--
-- Hard-surface stair wrap extra boxes were still silent wrap qty TBD even
-- when the wrap SKU is sold by the box / each / roll. A count wrap SKU
-- asks How many in that unit — not 8 sq ft/step and not leftover taped
-- square feet. Area-unit wrap stays wrap qty TBD (do not convert steps × 8).
-- Empty How many stays wrap qty TBD so Builder cannot reopen an area order.
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + wall tile still asks stairs on the floor rooms).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0310_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD.'
 where key = 'hs_plank_stairs';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0310_flooring_knowledge_stair_wrap_qty.sql

-- BEGIN 0311_flooring_knowledge_prep_count_review.sql
-- Floor King — flooring knowledge engine, pass 122.
-- Run in the Supabase SQL editor AFTER 0190–0310. Idempotent — safe to re-run.
--
-- Self-level bags and subfloor sheets were derived from measured area but
-- stayed off Review, so taped square feet looked like the order. Review
-- prints the bag / sheet count — taped square feet is not a bag order and
-- not a plywood order. Missing coverage stays off Review (Builder still
-- withholds). Field verify still withholds. Do not invent 1/4 inch or a
-- 4×8 (32 sq ft) sheet. Builder still carries coverage + area so the bag
-- calculator stays live.
-- Do NOT SQL-gate selflevel_needed on tile_application (0142 — mixed LVP + wall tile still asks bags on the floor rooms).
-- Do NOT SQL-gate subfloor_needed on surface_type (0142 — mixed jobs still ask sheets on hard-surface rooms).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0311_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Bag count uses Settings coverage at the chosen pour. Pour is the shop default, else the coverage reference — we do not invent 1/4 inch. Field verify withholds bags. Review prints the bag count — taped square feet is not a bag order. Do not invent coverage.'
 where key = 'selflevel_needed';

update public.estimate_questions
   set help = 'Yes emits 4×8 sheets only when Settings has sheet_sqft. Missing coverage is TBD — we do not invent 32 sq ft per sheet. Field verify withholds the count. Exclusive Concrete hides this — a slab is not a plywood overlay. Plywood / wood / existing flooring / Unknown still ask. Self-level stays on Floor prep. Review prints the sheet count — taped square feet is not a plywood order.'
 where key = 'subfloor_needed';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0311_flooring_knowledge_prep_count_review.sql

-- BEGIN 0312_flooring_knowledge_boxed_carton_area.sql
-- Floor King — flooring knowledge engine, pass 123.
-- Run in the Supabase SQL editor AFTER 0190–0311. Idempotent — safe to re-run.
--
-- A boxed LVP / hardwood SKU sold by the carton with catalog coverage still
-- takeoffs from measured area. Carton math uses sqft_per_box — we do not
-- invent a box size and we do not treat leftover taped sq ft as How many
-- boxes. Missing coverage stays TBD. Wrap extras sold by the box still ask
-- How many (0310) — this pass is floor-map / main flooring emit only.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0312_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size.'
 where kind = 'floor_map';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0312_flooring_knowledge_boxed_carton_area.sql

-- BEGIN 0313_flooring_knowledge_carpet_tile_carton.sql
-- Floor King — flooring knowledge engine, pass 124.
-- Run in the Supabase SQL editor AFTER 0190–0312. Idempotent — safe to re-run.
--
-- Exclusive carpet tile sold by the carton with catalog coverage still
-- takeoffs from measured area (sq yd + carton math). Leftover taped sq ft
-- is not How many boxes. Missing coverage stays TBD; do not invent a box
-- size. Stretch-in / glue-down / mixed stretch-in + tile still wait for
-- cuts. Wrap extras sold by the box still ask How many (0310).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0313_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size.'
 where kind = 'floor_map';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0313_flooring_knowledge_carpet_tile_carton.sql

-- BEGIN 0314_flooring_knowledge_carton_tbd_review.sql
-- Floor King — flooring knowledge engine, pass 125.
-- Run in the Supabase SQL editor AFTER 0190–0313. Idempotent — safe to re-run.
--
-- Review was still printing taped square feet as the order when a boxed
-- LVP / hardwood / carpet-tile SKU is sold by the carton but coverage is
-- missing. Missing coverage stays TBD — not How many boxes from leftover
-- taped sq ft, and not measured-plus-waste as if it were billed by the foot.
-- Coverage on the SKU still takeoffs from measured area. Wrap extras sold
-- by the box still ask How many (0310).
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0314_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0314_flooring_knowledge_carton_tbd_review.sql

-- BEGIN 0315_flooring_knowledge_carton_tbd_builder.sql
-- Floor King — flooring knowledge engine, pass 126.
-- Run in the Supabase SQL editor AFTER 0190–0314. Idempotent — safe to re-run.
--
-- Builder was still treating carton-coverage TBD flooring lines as AREA
-- (category stays lvp / hardwood / carpet). Leftover taped sq ft must not
-- reopen as the order. Builder carton-coverage TBD is How many / Unit TBD,
-- never taped square feet. Coverage on the SKU still takeoffs from measured
-- area. Wrap extras sold by the box still ask How many (0310).
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0315_FLOORING_KNOWLEDGE

-- original begin; absorbed into the single owner-bundle transaction

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

-- original commit; absorbed into the single owner-bundle transaction
-- END 0315_flooring_knowledge_carton_tbd_builder.sql
COMMIT;
