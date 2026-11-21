-- Price-book logins. Each person has a gross margin. They see a sell price
-- and nothing else. The margin stays in this table. Their login is a customer
-- role with no customer record, so staff policies that exclude customers
-- already hide cost, jobs, and the catalog.
--
-- Run in the Supabase SQL editor. Idempotent.
-- Does NOT write product prices. Does NOT enable accounting.

begin;

create table if not exists public.price_book_access (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  margin_pct numeric(6, 3) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_book_margin_range check (margin_pct >= 0 and margin_pct < 100)
);

alter table public.price_book_access enable row level security;

revoke all on public.price_book_access from public, anon, authenticated;
grant all on public.price_book_access to service_role;

create or replace function public.is_price_book_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.price_book_access a
     where a.profile_id = auth.uid()
       and a.active
  );
$$;

revoke all on function public.is_price_book_viewer() from public, anon;
grant execute on function public.is_price_book_viewer() to authenticated;

-- Open read policies a signed-in customer can use. A price-book login is not
-- a customer of the shop, so those lists stay closed.
drop policy if exists ls_read on public.lead_sources;
create policy ls_read on public.lead_sources
  for select to authenticated
  using (not public.is_price_book_viewer());

drop policy if exists lsd_read on public.lead_source_details;
create policy lsd_read on public.lead_source_details
  for select to authenticated
  using (not public.is_price_book_viewer());

drop policy if exists cancel_reasons_read on public.cancel_reasons;
create policy cancel_reasons_read on public.cancel_reasons
  for select to authenticated
  using (not public.is_price_book_viewer());

drop policy if exists appointment_types_read on public.appointment_types;
create policy appointment_types_read on public.appointment_types
  for select to authenticated
  using (not public.is_price_book_viewer());

drop policy if exists showroom_settings_read on public.showroom_settings;
create policy showroom_settings_read on public.showroom_settings
  for select to authenticated
  using (not public.is_price_book_viewer());

drop policy if exists eq_read on public.estimate_questions;
create policy eq_read on public.estimate_questions
  for select to authenticated
  using (not public.is_price_book_viewer());

drop policy if exists qq_read on public.qualifying_questions;
create policy qq_read on public.qualifying_questions
  for select to authenticated
  using (not public.is_price_book_viewer());

drop policy if exists workflow_stages_read on public.workflow_stages;
create policy workflow_stages_read on public.workflow_stages
  for select to authenticated
  using (not public.is_price_book_viewer());

drop policy if exists handoffs_mine on public.handoffs;
create policy handoffs_mine on public.handoffs
  for select to authenticated
  using (
    not public.is_price_book_viewer()
    and (to_user = auth.uid() or from_user = auth.uid())
  );

commit;
