-- 0125 — Add a dedicated "Collect Balance" pipeline stage between
-- "Installed — Follow-up" (pos 110) and "Closed" (pos 130). Before this, the
-- final balance was only gated inside the Follow-up step; now it is its own
-- gated stage (job-flow.ts resolves a stage named "…balance…" to the
-- collect_balance step, gated on the balance being paid). Idempotent.

insert into public.workflow_stages (name, position, color, next_action, sla_hours)
select 'Collect Balance', 115, 'rose', 'Collect the final balance before closing', 48
where not exists (
  select 1 from public.workflow_stages where lower(name) like '%balance%'
);

-- Follow-up is now the sign-off / touch-base step (balance moved to its own
-- stage). Clean up the default guidance text — only if it hasn't been edited.
update public.workflow_stages
set next_action = 'Confirm sign-off & follow up'
where next_action = 'Collect the balance & follow up';
