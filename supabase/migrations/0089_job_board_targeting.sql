-- 0089 — Job-board targeting: post to specific installers, or everyone.
-- NULL / empty = visible to everyone; otherwise only the listed installers see it.
-- Idempotent.
alter table jobs add column if not exists board_installer_ids uuid[];
