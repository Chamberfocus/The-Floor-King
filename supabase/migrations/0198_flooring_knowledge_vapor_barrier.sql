-- Floor King — flooring knowledge engine, pass 9.
-- Run in the Supabase SQL editor AFTER 0190–0197. Idempotent — safe to re-run.
--
-- vapor_barrier show_if is already OR(floating/glue, Concrete). The overlay
-- knowledge_when was AND systems floating|glue, so nail-down hardwood over a
-- slab never asked. Align overlay with show_if. Does not invent a vapor-barrier
-- product or a bag count.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0198_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{knowledge_when}',
         '{"purpose":"PREP","any":[{"systems":["floating","glue"]},{"substrate":["Concrete"]}]}'::jsonb
       ),
       help = 'Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed.'
 where key = 'vapor_barrier';

commit;
