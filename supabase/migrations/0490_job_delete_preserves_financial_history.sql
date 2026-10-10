-- Job, estimate, and customer deletes must not erase financial history.
--
-- deleteJob, deleteEstimate, and deleteCustomer removed invoices (and the
-- payments that cascade from them), labor, installer bills, true-ups, and
-- commissions. Invoice and payment row deletes stay with migration 0488.
-- This file does not recreate those invoice or payment triggers.
--
-- This trigger is the row backstop. A job with cost history, a non-draft
-- invoice, a received or issued purchase order, an expense, a supplier bill,
-- a customer order, pulled stock, allocated rolls, or an outstanding
-- reservation cannot be deleted. Labor, installer bills, true-ups, and
-- commission rows cannot be deleted on their own. An estimate with an
-- approval snapshot or posted invoice cannot be deleted. A customer with
-- that same history cannot be deleted.
--
-- Does not enable accounting. Does not update posting flags. Does not change
-- existing rows. Safe to re-run.
-- Rollback: drop the triggers, then drop the functions.

do $preflight$
begin
  if to_regclass('public.jobs') is null
     or to_regclass('public.job_labor') is null
     or to_regclass('public.installer_bills') is null
     or to_regclass('public.job_true_ups') is null
     or to_regclass('public.job_commission_ledger') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.credit_applications') is null
     or to_regclass('public.customer_deposit_applications') is null
     or to_regclass('public.invoice_write_offs') is null
     or to_regclass('public.expenses') is null
     or to_regclass('public.bills') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.purchase_orders') is null
     or to_regclass('public.po_items') is null
     or to_regclass('public.stock_movements') is null
     or to_regclass('public.stock_rolls') is null
     or to_regclass('public.estimates') is null
     or to_regclass('public.estimate_approval_snapshots') is null
     or to_regclass('public.customers') is null
  then
    raise exception '0490 preflight: required financial relation is missing';
  end if;
end
$preflight$;

create or replace function public.refuse_job_cost_history_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'JOB_FINANCIAL_HISTORY'
    using errcode = 'P0001',
          hint = 'Labor, installer bills, true-ups, and commission rows are not deleted.';
end;
$$;

revoke all on function public.refuse_job_cost_history_delete() from public, anon;
grant execute on function public.refuse_job_cost_history_delete() to authenticated, service_role;

drop trigger if exists job_labor_refuse_delete on public.job_labor;
create trigger job_labor_refuse_delete
  before delete on public.job_labor
  for each row execute function public.refuse_job_cost_history_delete();

drop trigger if exists installer_bills_refuse_delete on public.installer_bills;
create trigger installer_bills_refuse_delete
  before delete on public.installer_bills
  for each row execute function public.refuse_job_cost_history_delete();

drop trigger if exists job_true_ups_refuse_delete on public.job_true_ups;
create trigger job_true_ups_refuse_delete
  before delete on public.job_true_ups
  for each row execute function public.refuse_job_cost_history_delete();

drop trigger if exists job_commission_ledger_refuse_delete on public.job_commission_ledger;
create trigger job_commission_ledger_refuse_delete
  before delete on public.job_commission_ledger
  for each row execute function public.refuse_job_cost_history_delete();

create or replace function public.job_has_posted_invoice(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.invoices i
    where i.job_id = p_job_id
      and (
        i.status is distinct from 'draft'::public.invoice_status
        or exists (select 1 from public.payments p where p.invoice_id = i.id)
        or exists (select 1 from public.credit_applications c where c.invoice_id = i.id)
        or exists (select 1 from public.customer_deposit_applications d where d.invoice_id = i.id)
        or exists (select 1 from public.invoice_write_offs w where w.invoice_id = i.id)
      )
  );
$$;

revoke all on function public.job_has_posted_invoice(uuid) from public, anon;
grant execute on function public.job_has_posted_invoice(uuid) to authenticated, service_role;

create or replace function public.refuse_job_delete_with_financial_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from 'unscheduled'::public.job_status
     or old.scheduled_date is not null
     or old.completed_at is not null
     or old.actual_labor_cost is not null
  then
    raise exception 'OPERATIONAL_JOB'
      using errcode = 'P0001',
            hint = 'Scheduled, in-progress, completed, and cancelled jobs are not deleted.';
  end if;

  if exists (select 1 from public.job_labor where job_id = old.id)
     or exists (select 1 from public.installer_bills where job_id = old.id)
     or exists (select 1 from public.job_true_ups where job_id = old.id)
     or exists (select 1 from public.job_commission_ledger where job_id = old.id)
  then
    raise exception 'JOB_FINANCIAL_HISTORY'
      using errcode = 'P0001',
            hint = 'Job cost history stays on the books.';
  end if;

  if public.job_has_posted_invoice(old.id) then
    raise exception 'POSTED_INVOICE'
      using errcode = 'P0001',
            hint = 'Do not delete a job that still has posted invoice history.';
  end if;

  if exists (select 1 from public.expenses where job_id = old.id) then
    raise exception 'EXPENSE_HISTORY'
      using errcode = 'P0001',
            hint = 'Expenses stay on the books.';
  end if;

  if exists (select 1 from public.bills where job_id = old.id) then
    raise exception 'SUPPLIER_BILL'
      using errcode = 'P0001',
            hint = 'Supplier bills stay on the books.';
  end if;

  if exists (select 1 from public.orders where job_id = old.id) then
    raise exception 'MATERIAL_ORDER'
      using errcode = 'P0001',
            hint = 'Customer orders stay on the books.';
  end if;

  if exists (
    select 1
    from public.purchase_orders po
    join public.po_items pi on pi.po_id = po.id
    where po.job_id = old.id
      and coalesce(pi.received_qty, 0) > 0
  ) then
    raise exception 'PURCHASE_ORDER_RECEIPTS'
      using errcode = 'P0001',
            hint = 'Receiving history stays on the books.';
  end if;

  if exists (
    select 1
    from public.purchase_orders po
    where po.job_id = old.id
      and po.status is distinct from 'draft'::public.po_status
  ) then
    raise exception 'ISSUED_PURCHASE_ORDER'
      using errcode = 'P0001',
            hint = 'Issued purchase orders stay on the books.';
  end if;

  if exists (
    select 1 from public.stock_movements
    where job_id = old.id and kind = 'pull'
  ) then
    raise exception 'INVENTORY_PULL'
      using errcode = 'P0001',
            hint = 'Pulled inventory stays on the books.';
  end if;

  if exists (select 1 from public.stock_rolls where job_id = old.id) then
    raise exception 'STOCK_ALLOCATION'
      using errcode = 'P0001',
            hint = 'Allocated rolls stay on the books.';
  end if;

  if exists (
    select 1
    from (
      select
        coalesce(sum(case when kind in ('reserve', 'release') then qty else 0 end), 0)
          - coalesce(sum(case when kind = 'pull' then abs(qty) else 0 end), 0) as outstanding
      from public.stock_movements
      where job_id = old.id
        and product_id is not null
      group by product_id, line_id
    ) held
    where held.outstanding > 0
  ) then
    raise exception 'RESERVATION_RELEASE_FAILED'
      using errcode = 'P0001',
            hint = 'Release reservations before deleting a bare draft job.';
  end if;

  return old;
end;
$$;

revoke all on function public.refuse_job_delete_with_financial_history() from public, anon;
grant execute on function public.refuse_job_delete_with_financial_history() to authenticated, service_role;

drop trigger if exists jobs_refuse_financial_delete on public.jobs;
create trigger jobs_refuse_financial_delete
  before delete on public.jobs
  for each row execute function public.refuse_job_delete_with_financial_history();

create or replace function public.refuse_estimate_delete_with_financial_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.estimate_approval_snapshots where estimate_id = old.id
  ) then
    raise exception 'APPROVAL_HISTORY'
      using errcode = 'P0001',
            hint = 'Approval snapshots stay on the books.';
  end if;

  if exists (
    select 1
    from public.invoices i
    where i.estimate_id = old.id
      and (
        i.status is distinct from 'draft'::public.invoice_status
        or exists (select 1 from public.payments p where p.invoice_id = i.id)
        or exists (select 1 from public.credit_applications c where c.invoice_id = i.id)
        or exists (select 1 from public.customer_deposit_applications d where d.invoice_id = i.id)
        or exists (select 1 from public.invoice_write_offs w where w.invoice_id = i.id)
      )
  ) then
    raise exception 'POSTED_INVOICE'
      using errcode = 'P0001',
            hint = 'Do not delete an estimate that still has posted invoice history.';
  end if;

  if exists (
    select 1
    from public.jobs j
    where j.estimate_id = old.id
      and (
        j.status is distinct from 'unscheduled'::public.job_status
        or j.scheduled_date is not null
        or j.completed_at is not null
        or j.actual_labor_cost is not null
        or public.job_has_posted_invoice(j.id)
        or exists (select 1 from public.job_labor where job_id = j.id)
        or exists (select 1 from public.installer_bills where job_id = j.id)
        or exists (select 1 from public.job_true_ups where job_id = j.id)
        or exists (select 1 from public.job_commission_ledger where job_id = j.id)
      )
  ) then
    raise exception 'OPERATIONAL_JOB'
      using errcode = 'P0001',
            hint = 'The estimate still has a committed work order.';
  end if;

  return old;
end;
$$;

revoke all on function public.refuse_estimate_delete_with_financial_history() from public, anon;
grant execute on function public.refuse_estimate_delete_with_financial_history() to authenticated, service_role;

drop trigger if exists estimates_refuse_financial_delete on public.estimates;
create trigger estimates_refuse_financial_delete
  before delete on public.estimates
  for each row execute function public.refuse_estimate_delete_with_financial_history();

create or replace function public.refuse_customer_delete_with_financial_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.invoices i
    where i.customer_id = old.id
      and (
        i.status is distinct from 'draft'::public.invoice_status
        or exists (select 1 from public.payments p where p.invoice_id = i.id)
        or exists (select 1 from public.credit_applications c where c.invoice_id = i.id)
        or exists (select 1 from public.customer_deposit_applications d where d.invoice_id = i.id)
        or exists (select 1 from public.invoice_write_offs w where w.invoice_id = i.id)
      )
  ) then
    raise exception 'POSTED_INVOICE'
      using errcode = 'P0001',
            hint = 'Do not delete a customer who still has posted invoice history.';
  end if;

  if exists (
    select 1
    from public.estimates e
    join public.estimate_approval_snapshots s on s.estimate_id = e.id
    where e.customer_id = old.id
  ) then
    raise exception 'APPROVAL_HISTORY'
      using errcode = 'P0001',
            hint = 'Approval snapshots stay on the books.';
  end if;

  if exists (
    select 1
    from public.jobs j
    where j.customer_id = old.id
      and (
        j.status is distinct from 'unscheduled'::public.job_status
        or j.scheduled_date is not null
        or j.completed_at is not null
        or j.actual_labor_cost is not null
        or public.job_has_posted_invoice(j.id)
        or exists (select 1 from public.job_labor where job_id = j.id)
        or exists (select 1 from public.installer_bills where job_id = j.id)
        or exists (select 1 from public.job_true_ups where job_id = j.id)
        or exists (select 1 from public.job_commission_ledger where job_id = j.id)
        or exists (select 1 from public.expenses where job_id = j.id)
        or exists (select 1 from public.bills where job_id = j.id)
        or exists (select 1 from public.orders where job_id = j.id)
        or exists (
          select 1 from public.stock_movements sm
          where sm.job_id = j.id and sm.kind = 'pull'
        )
      )
  ) then
    raise exception 'JOB_FINANCIAL_HISTORY'
      using errcode = 'P0001',
            hint = 'Customer financial history stays on the books.';
  end if;

  if exists (select 1 from public.bills where customer_id = old.id)
     or exists (select 1 from public.orders where customer_id = old.id)
  then
    raise exception 'MATERIAL_ORDER'
      using errcode = 'P0001',
            hint = 'Supplier bills and customer orders stay on the books.';
  end if;

  return old;
end;
$$;

revoke all on function public.refuse_customer_delete_with_financial_history() from public, anon;
grant execute on function public.refuse_customer_delete_with_financial_history() to authenticated, service_role;

drop trigger if exists customers_refuse_financial_history_delete on public.customers;
create trigger customers_refuse_financial_history_delete
  before delete on public.customers
  for each row execute function public.refuse_customer_delete_with_financial_history();
