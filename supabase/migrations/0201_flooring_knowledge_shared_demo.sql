-- Floor King — flooring knowledge engine, pass 12.
-- Run in the Supabase SQL editor AFTER 0190–0200. Idempotent — safe to re-run.
--
-- Removal and substrate must be shared across Carpet and Hard surface:
--   1. Demo ("what's coming up?") is the one typed tear-out question. 0142
--      already opened it to Carpet + Hard surface and retired the generic
--      $0.50 "Tear up the old floor?" so mixed jobs could not double-charge.
--      This reaffirms that gate so a knowledge-engine apply sequence
--      (0190–0201) does not depend on re-running 0142. Existing per-material
--      demo rates stay — this does not invent a second carpet tear-out price.
--   2. Demo disposal still hangs off a real demo type (not "None"), so carpet
--      jobs that pick Carpet on demo get haul/dumpster/curb the same way.
--   3. Substrate (concrete / plywood / OSB / existing / unknown) is asked on
--      carpet too. 0193 already asks CONDITION on both paths; identifying the
--      substrate is what moisture / vapor follow-ups hang off. Restores the
--      original carpet Subfloor question without a second copy.
--   4. Vapor barrier show_if also follows carpet glue-down (overlay already
--      treats glue as a system). Stretch-in over plywood still hides it until
--      the salesperson picks Concrete.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0201_FLOORING_KNOWLEDGE

begin;

-- Shared typed demo — Carpet and Hard surface, one question, existing rates.
update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
       )
 where id = '789950c7-06a2-4c4b-81ca-15b5a4a54f29'; -- Demo — what's coming up?

-- Disposal only after a real demo type (0120). Reaffirm so carpet demo counts.
update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"key":"hs_demo","in":["Carpet","Ceramic WITH mortar bed","Ceramic WITHOUT mortar bed","Sheet vinyl","Luan","LVP","Laminate","Glue-down hardwood","Nailed hardwood","Other"]}'::jsonb
       )
 where key = 'demo_disposal';

-- Substrate on either path — unknown/field verify remains an option (0192).
update public.estimate_questions
   set help = 'Concrete, wood, or existing flooring — or Unknown / field verify if you cannot see it until demo. Carpet and hard surface share this question.',
       config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"key":"project_type","in":["Carpet","Hard surface"]}'::jsonb
       )
 where id = 'c7bf81f2-c02f-4e92-94d9-3b3a8a7ed691'; -- substrate

-- Vapor barrier: floating/glue hard surface, carpet glue-down, or a slab.
update public.estimate_questions
   set config = jsonb_set(
         coalesce(config, '{}'::jsonb),
         '{show_if}',
         '{"any":[{"key":"install_method","in":["Floating / click","Glue-down"]},{"key":"carpet_install","in":["Glue-down"]},{"key":"substrate","in":["Concrete"]}]}'::jsonb
       )
 where key = 'vapor_barrier';

commit;
