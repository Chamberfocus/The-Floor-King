-- Lock in the permanent SALESPERSON owner on existing customers.
--
-- The ownership scoping (migration 0017) already matches a salesman on
-- assigned_to OR workflow_owner_id. But the app only ever set workflow_owner_id,
-- which *moves* when a client is passed down to admin/warehouse — so a
-- passed-down client vanished from its salesperson. This sets assigned_to to the
-- customer's salesperson so it stays theirs permanently:
--   1) the first salesman/sales_manager who owned it (from handoff history), else
--   2) the current workflow owner, if they're a salesperson.
-- Data-only and safe to re-run. Does NOT change any access rule.

update public.customers c
set assigned_to = sp.uid
from (
  select
    c2.id as customer_id,
    coalesce(
      (select h.to_user
         from public.handoffs h
         join public.profiles p on p.id = h.to_user
        where h.customer_id = c2.id
          and p.role in ('salesman', 'sales_manager')
        order by h.created_at asc
        limit 1),
      case
        when exists (
          select 1 from public.profiles p
           where p.id = c2.workflow_owner_id
             and p.role in ('salesman', 'sales_manager')
        ) then c2.workflow_owner_id
        else null
      end
    ) as uid
  from public.customers c2
) sp
where sp.customer_id = c.id
  and sp.uid is not null
  and c.assigned_to is distinct from sp.uid;
