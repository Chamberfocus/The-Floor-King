-- Floor King CRM — "order as roll" for carpet/material lines.
-- Run in Supabase: SQL Editor -> paste -> Run. Idempotent.
-- When a line is ordered as a roll, the PURCHASE ORDER shows one roll (linear
-- feet + yardage) to save money, while the ESTIMATE + WORK ORDER keep the
-- per-room cut sizes so the warehouse cuts it correctly.

alter table public.estimate_line_items
  add column if not exists order_as_roll boolean not null default false;
alter table public.estimate_line_items
  add column if not exists roll_width_ft numeric; -- 12 or 15 (broadloom width)
