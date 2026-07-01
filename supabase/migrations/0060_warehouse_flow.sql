-- Floor King CRM — holistic warehouse staging flow.
-- When an install is scheduled the job auto-submits to the warehouse; a warehouse
-- person is assigned and notified, accepts (acknowledging they'll cut the right
-- material), then marks it staged with a location — which notifies the installer,
-- salesperson, admin, and (briefly) the customer. Safe to re-run.

alter table public.jobs
  add column if not exists warehouse_submitted_at timestamptz,
  add column if not exists warehouse_assigned_to  uuid references auth.users (id) on delete set null,
  add column if not exists warehouse_accepted_at  timestamptz,
  add column if not exists warehouse_ack_at        timestamptz,
  add column if not exists staging_location        text,
  add column if not exists warehouse_ready_at      timestamptz;

create index if not exists jobs_warehouse_assigned_idx
  on public.jobs (warehouse_assigned_to);
