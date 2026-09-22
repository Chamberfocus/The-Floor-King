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

begin;

update public.estimate_questions
   set help = 'Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD.'
 where key = 'hs_plank_stairs';

commit;
