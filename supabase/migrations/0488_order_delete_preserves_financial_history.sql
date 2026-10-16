-- Order delete must not erase posted invoices or payments.
--
-- deleteOrder used the service role to delete invoices. payments.invoice_id
-- is ON DELETE CASCADE, so those deletes also erased payment rows.
-- This trigger rejects that delete. Draft invoices with no payments, credit
-- applications, deposit applications, or write-offs can still be removed.
-- Payment rows themselves are never deleted; void them.
--
-- Does not enable accounting. Does not update posting flags. Does not change
-- existing rows. Safe to re-run.
-- Rollback: drop both triggers, then drop both functions.

create or replace function public.refuse_posted_invoice_delete()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_payments int;
  v_credits int;
  v_deposits int;
  v_writeoffs int;
begin
  if old.status is distinct from 'draft'::public.invoice_status then
    raise exception 'POSTED_INVOICE'
      using errcode = 'P0001',
            hint = 'Void the invoice. Do not delete posted invoice history.';
  end if;

  select count(*) into v_payments
  from public.payments
  where invoice_id = old.id;
  if v_payments > 0 then
    raise exception 'PAYMENT_HISTORY'
      using errcode = 'P0001',
            hint = 'Void payments. Do not delete payment history.';
  end if;

  select count(*) into v_credits
  from public.credit_applications
  where invoice_id = old.id;
  if v_credits > 0 then
    raise exception 'CREDIT_APPLICATION'
      using errcode = 'P0001',
            hint = 'Void the credit application. Do not delete the invoice.';
  end if;

  select count(*) into v_deposits
  from public.customer_deposit_applications
  where invoice_id = old.id;
  if v_deposits > 0 then
    raise exception 'DEPOSIT_APPLICATION'
      using errcode = 'P0001',
            hint = 'Void the deposit application. Do not delete the invoice.';
  end if;

  select count(*) into v_writeoffs
  from public.invoice_write_offs
  where invoice_id = old.id;
  if v_writeoffs > 0 then
    raise exception 'WRITE_OFF'
      using errcode = 'P0001',
            hint = 'Void the write-off. Do not delete the invoice.';
  end if;

  return old;
end;
$$;

revoke all on function public.refuse_posted_invoice_delete() from public, anon;
grant execute on function public.refuse_posted_invoice_delete() to authenticated, service_role;

drop trigger if exists invoices_refuse_posted_delete on public.invoices;
create trigger invoices_refuse_posted_delete
  before delete on public.invoices
  for each row execute function public.refuse_posted_invoice_delete();

create or replace function public.refuse_payment_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'PAYMENT_HISTORY'
    using errcode = 'P0001',
          hint = 'Void the payment. Payment rows are not deleted.';
end;
$$;

revoke all on function public.refuse_payment_delete() from public, anon;
grant execute on function public.refuse_payment_delete() to authenticated, service_role;

drop trigger if exists payments_refuse_delete on public.payments;
create trigger payments_refuse_delete
  before delete on public.payments
  for each row execute function public.refuse_payment_delete();
