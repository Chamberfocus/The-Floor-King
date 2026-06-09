-- Customer command center: each stage carries its next action + expected time,
-- and each customer tracks when their current step is due (for stall alerts).

alter table public.workflow_stages
  add column if not exists next_action text,
  add column if not exists sla_hours   int not null default 0;  -- 0 = no SLA

alter table public.customers
  add column if not exists next_action_due timestamptz;

create index if not exists customers_next_due_idx
  on public.customers (next_action_due);
