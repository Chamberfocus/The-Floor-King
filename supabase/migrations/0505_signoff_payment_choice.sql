-- Finished-job sign-off: the customer pays the balance now, or will contact the store.
-- Does not enable accounting. Does not change posting. Does not text the customer.

alter table public.job_satisfaction
  add column if not exists payment_choice text;

alter table public.job_satisfaction
  drop constraint if exists job_satisfaction_payment_choice_check;

alter table public.job_satisfaction
  add constraint job_satisfaction_payment_choice_check
  check (
    payment_choice is null
    or payment_choice in ('pay_now', 'contact_store')
  );

comment on column public.job_satisfaction.payment_choice is
  'pay_now = the customer will pay the balance at sign-off. contact_store = the customer will contact the store to pay. Null on older signatures and when nothing is owed.';
