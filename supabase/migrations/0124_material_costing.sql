-- 0124 — Estimated/actual material cost on the job, mirroring the labor fields
-- (0123). Additive only: no existing column is dropped or altered. Safe to
-- re-run.
--   estimated_material_cost: written ONCE when an estimate is approved (job
--     created from it). Never updated afterward.
--   actual_material_cost:    nullable. (The Job Costing view derives actual
--     material spend live from committed POs + stock pulls; this column exists
--     for parity with labor and is not written by the read-only view.)
--   material_variance:       nullable — actual_material_cost − estimated.
alter table public.jobs
  add column if not exists estimated_material_cost numeric(12, 2),
  add column if not exists actual_material_cost    numeric(12, 2),
  add column if not exists material_variance        numeric(12, 2);
