-- Floor King — flooring knowledge engine, pass 128.
-- Run in the Supabase SQL editor AFTER 0190–0316. Idempotent — safe to re-run.
--
-- Picking a boxed LVP / hardwood SKU in Builder planted catalog unit box as
-- How many and stripped wrap / carton-coverage TBD / qty TBD stamps, so
-- leftover taped square feet could reopen as the order. Picking a boxed SKU
-- with coverage still takeoffs from measured area — catalog unit box is not
-- How many boxes. Wrap extras stay How many even when the wrap SKU has
-- carton coverage (0310). extraAsksCountQty(lvp + box) stays true.
-- Do NOT SQL-gate floor_map on surface_type (0142 — mixed carpet + LVP still assigns rooms per family).
-- Do NOT SQL-gate carpet_cuts on carpet_install (0142 — mixed stretch-in + tile still asks the cut list).
-- Do NOT SQL-gate hs_plank_stairs on tile_application (0142 — mixed LVP + tile still asks wrap).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0317_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. Review warns when a mixed job still has blank rooms. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes.'
 where kind = 'floor_map';

update public.estimate_questions
   set help = 'Each cut needs a length AND a roll width (catalog width or a 12''/15'' chip). An empty width is not a 12-foot roll. A measured room (12''×14'') is not a warehouse cut — converting room square feet into yards is not a cut plan and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. If you pick the SKU first, Builder keeps it as order TBD until cuts are entered. Carpet tile is modular: Builder shows measured coverage and carton math (carton only if coverage is on the product), not Cuts vs Roll. Floor-map room sizes stay measured, not cuts. Install labor uses this question''s Settings $/sq yd (or the product labor rate) — it does not invent $6. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes.'
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step.'
 where key = 'hs_plank_stairs';

commit;
