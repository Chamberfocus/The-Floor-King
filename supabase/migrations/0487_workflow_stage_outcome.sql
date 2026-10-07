-- workflow_stages.outcome is the Lost/Parked authority.
-- Display names stay editable. This file does not move customers, jobs,
-- invoices, payments, tasks, or stock, and it does not insert or delete stages.
--
-- Backfill matches the application name rules in src/lib/customer-lifecycle.ts:
--   stageNameMeansLost  -> lost
--   else stageNameMeansParked -> parked
--   else -> active
-- won is allowed by the check and is not written here.
--
-- Lost name rule: lost | declin | dead | cancel (case insensitive substring).
-- Parked name rule: not material|deliver, then a word-boundary match for
-- waiting, "on hold", hold, or a word starting with park (park, parked).
-- PostgreSQL \y is the word boundary. JavaScript \b is the same test.
--
-- Rows that already have an outcome are left alone, so applying this file
-- twice does not recompute a renamed label back into a semantic change.
-- On a database that has never had the column, every existing stage is null
-- and therefore classified once.
--
-- The default is attached AFTER that classification. PostgreSQL 11+ stores a
-- constant ADD COLUMN default in the catalog and existing rows then read as
-- that default, so WHERE outcome IS NULL would classify nothing. New inserts
-- that omit the column, including the app that is running before this code
-- deploys, store active. An explicit NULL is still accepted.
--
-- Safe to re-run. Does not enable accounting.

alter table public.workflow_stages
  add column if not exists outcome text;

alter table public.workflow_stages
  drop constraint if exists workflow_stages_outcome_check;

alter table public.workflow_stages
  add constraint workflow_stages_outcome_check
  check (outcome is null or outcome in ('active', 'won', 'lost', 'parked'));

update public.workflow_stages
set outcome = case
  when coalesce(name, '') ~* 'lost|declin|dead|cancel' then 'lost'
  when coalesce(name, '') ~* 'material|deliver' then 'active'
  when coalesce(name, '') ~* $park$\ywaiting\y|\yon hold\y|\yhold\y|\ypark$park$ then 'parked'
  else 'active'
end
where outcome is null;

alter table public.workflow_stages
  alter column outcome set default 'active';
