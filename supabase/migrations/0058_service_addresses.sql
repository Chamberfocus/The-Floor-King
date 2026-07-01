-- Floor King CRM — multiple service addresses per account (property managers,
-- commercial clients with several properties). The customer's own address stays
-- the primary/billing address; these are additional job sites. Jobs and
-- estimates can point at one; the job's site_* fields are still filled in from
-- whichever address is chosen. Safe to re-run.

create table if not exists public.service_addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  label       text,               -- e.g. "Maple Duplex", "Unit 4B"
  street      text,
  city        text,
  state       text,
  zip         text,
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists service_addresses_customer_idx
  on public.service_addresses (customer_id);

alter table public.service_addresses enable row level security;

drop policy if exists service_addresses_staff on public.service_addresses;
create policy service_addresses_staff on public.service_addresses
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Portal customers may read their own account's service addresses.
drop policy if exists service_addresses_own on public.service_addresses;
create policy service_addresses_own on public.service_addresses
  for select to authenticated
  using (customer_id = public.my_customer_id());

grant select, insert, update, delete on public.service_addresses to authenticated;

drop trigger if exists set_service_addresses_updated_at on public.service_addresses;
create trigger set_service_addresses_updated_at
  before update on public.service_addresses
  for each row execute function public.set_updated_at();

-- Link a job / estimate to the service address it's for (nullable = the
-- account's primary address).
alter table public.jobs
  add column if not exists service_address_id uuid
  references public.service_addresses (id) on delete set null;

alter table public.estimates
  add column if not exists service_address_id uuid
  references public.service_addresses (id) on delete set null;
