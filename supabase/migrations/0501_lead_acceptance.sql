-- A salesperson must accept a lead after it is assigned to them.
-- Existing assigned customers are already in motion, so they count as accepted.
-- The owner, office, and sales managers still see every customer.
-- Does not enable accounting. Does not change posting. Does not text the customer.

alter table public.customers
  add column if not exists lead_acceptance text,
  add column if not exists lead_acceptance_note text,
  add column if not exists lead_acceptance_at timestamptz,
  add column if not exists lead_assigned_by uuid references public.profiles (id) on delete set null;

alter table public.customers
  drop constraint if exists customers_lead_acceptance_check;

alter table public.customers
  add constraint customers_lead_acceptance_check
  check (
    lead_acceptance is null
    or lead_acceptance in ('pending', 'accepted', 'declined')
  );

update public.customers
   set lead_acceptance = 'accepted',
       lead_acceptance_at = coalesce(lead_acceptance_at, now())
 where assigned_to is not null
   and lead_acceptance is null;

create index if not exists customers_lead_acceptance_idx
  on public.customers (lead_acceptance)
  where lead_acceptance in ('pending', 'declined');

comment on column public.customers.lead_acceptance is
  'pending = assigned salesperson has not accepted. accepted = they took it. declined = they sent it back with a note.';
