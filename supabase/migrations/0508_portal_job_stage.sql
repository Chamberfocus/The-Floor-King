-- The customer dashboard reads the same job stage the store moves.
-- jobs_customer omitted workflow_stage_id, so a stage change on a job never
-- reached the signed-in customer. The account stage is only the pre-job phase.
-- Run in the Supabase SQL editor. Safe to re-run.

drop view if exists public.jobs_customer;
create view public.jobs_customer
with (security_barrier = true) as
select
  j.id,
  j.customer_id,
  j.estimate_id,
  j.option_id,
  j.title,
  j.status,
  j.scheduled_date,
  j.scheduled_end,
  j.arrival_window,
  j.site_street,
  j.site_city,
  j.site_state,
  j.site_zip,
  j.delivery_type,
  j.created_at,
  j.updated_at,
  j.workflow_stage_id
from public.jobs j
where j.customer_id = public.my_customer_id();

comment on view public.jobs_customer is
  'Customer JWT SELECT. Includes the job stage the store moves. Omits cost, closeout, and staff user ids.';

grant select on public.jobs_customer to authenticated;
revoke all on public.jobs_customer from anon, public;
