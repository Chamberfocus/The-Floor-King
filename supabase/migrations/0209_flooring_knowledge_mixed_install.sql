-- Floor King — flooring knowledge engine, pass 20.
-- Run in the Supabase SQL editor AFTER 0190–0208. Idempotent — safe to re-run.
--
-- Mixed hard-surface jobs (LVP + hardwood, laminate + tile, …) were forced
-- through ONE install_method chip. Picking Floating hid fasteners; picking
-- Nail-down hid attached pad. An estimator on a mixed job needs both branches.
--
--   1. install_method is multi-select in the catalog so the Guided Estimate
--      can keep every method in play. The app still uses single-select when
--      only one hard-surface family is on the job (laminate stays floating).
--   2. Help text tells the salesperson to pick every system actually used.
--      Follow-up questions still come from existing adhesive / pad / fastener
--      catalog picks — this does not invent a per-room editor or a SKU.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0209_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'The method changes adhesive, underlayment, fasteners, and moisture questions. If this job has more than one hard-surface product, pick every method in play — one chip still hides the other branch. Confirm what each product actually allows.',
       config = jsonb_set(
         jsonb_set(
           jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{multi}',
             'true'::jsonb
           ),
           '{purpose}',
           '"INSTALLATION"'::jsonb
         ),
         '{note}',
         'true'::jsonb
       )
 where key = 'install_method'
    or id = 'd31db10e-9b44-4b5d-a008-069e0d428051';

commit;
