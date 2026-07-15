-- 0103 — Installer skills (material capability), for Job Board auto-filtering.
-- Which material types an installer works on: 'carpet', 'hard', or both.
-- Empty = unset = treated as "does everything" (no board filtering) so nobody's
-- board goes empty before you've configured them. Idempotent.

alter table install_crews
  add column if not exists skills text[] not null default '{}';

notify pgrst, 'reload schema';
