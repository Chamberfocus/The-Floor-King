-- One active job per estimate (idempotent approval / concurrent-create safety).
--
-- BEFORE applying in production, check for existing duplicates:
--   select estimate_id, count(*) from public.jobs
--   where estimate_id is not null
--   group by estimate_id having count(*) > 1;
--
-- If duplicates exist, resolve them manually before running this migration.
-- The index creation will FAIL if duplicate estimate_id values remain.

create unique index if not exists jobs_estimate_id_unique
  on public.jobs (estimate_id)
  where estimate_id is not null;
