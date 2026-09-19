-- Floor King — flooring knowledge engine, pass 36.
-- Run in the Supabase SQL editor AFTER 0190–0224. Idempotent — safe to re-run.
--
-- Carpet stairs: step labor is EACH. We do not invent 6/8 sq ft of carpet per
-- step as an order — include stairs in the cut list. A Settings carpet_sqft
-- allowance is a shop reminder, not billed material.
-- Self-leveling labor in Builder does not plant $15/bag.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0225_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'How many steps, and waterfall vs upholstered. This is carpet stair labor per step — not a hard-surface stair-nose takeoff. Include stairs in your cuts. We do not invent 6/8 sq ft of carpet per step as an order.'
 where kind = 'stairs'
   and (key is null or key = '' or key = 'carpet_stairs');

commit;
