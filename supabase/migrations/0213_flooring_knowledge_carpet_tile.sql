-- Floor King — flooring knowledge engine, pass 24.
-- Run in the Supabase SQL editor AFTER 0190–0212. Idempotent — safe to re-run.
--
-- Carpet tile is modular / boxed, not broadloom roll goods.
-- Catalog category stays `carpet` — do not invent a carpet-tile category.
--
-- Glue-down and stretch-in broadloom still need a cut list (area ≠ order).
-- Unanswered carpet_install stays optimistic: this step remains visible so
-- the salesperson can pick the product. Exclusive carpet tile keeps the
-- step for the SKU pick; the app hides the roll cut rows and orders from
-- measured area + waste. Carton count only when the product has coverage
-- — we do not invent a box size.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0213_FLOORING_KNOWLEDGE

begin;

-- Live carpet cuts question (0108): null key, show_if project_type Carpet.
-- Give it a stable key so overlay/registry can find it. Keep show_if as
-- Carpet so unanswered still shows the product pick. Do not gate on
-- carpet_install — that would hide the SKU picker before the method is picked.
update public.estimate_questions
   set key = coalesce(nullif(btrim(key), ''), 'carpet_cuts'),
       help = 'Stretch-in and glue-down broadloom: cuts are the order quantity — converting room square feet into yards is not a cut plan. Carpet tile is modular: pick the product here; order is measured area plus waste. Carton count only if the product has coverage — do not invent a box size.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{show_if}',
             '{"key":"project_type","in":["Carpet"]}'::jsonb
           ),
           '{purpose}',
           '"WAREHOUSE"'::jsonb
         ),
         '{knowledge_when}',
         '{"families":["carpet"],"purpose":"WAREHOUSE"}'::jsonb
       )
 where kind = 'cuts'
   and coalesce(config->>'category', 'carpet') = 'carpet'
   and coalesce(key, '') <> 'vinyl_layout';

commit;
