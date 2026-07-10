-- 0088 — Job-board target window + expected duration.
-- When posting a job to the board, capture the dates you want it done and how
-- long you expect it to take, so installers claiming it know the target.
-- Idempotent.
alter table jobs add column if not exists board_wanted_start date;
alter table jobs add column if not exists board_wanted_end date;
alter table jobs add column if not exists board_expected_days numeric;
