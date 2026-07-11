-- Let a background import carry ALREADY-PARSED rows (from the review grid), plus
-- the import options, so the Import button becomes durable + background: the
-- reviewed products go straight to the server and can't be lost by a navigation,
-- refresh, or timeout. Idempotent.

alter table public.import_jobs
  add column if not exists rows      jsonb   not null default '[]'::jsonb,
  add column if not exists do_update boolean not null default false,
  add column if not exists supplier  text;
