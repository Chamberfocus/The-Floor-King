-- Floor King CRM — saved default pricing for estimate add-ons.
-- "Set as default" on an add-on line stores its unit/cost/price so it pre-fills
-- on every new estimate. Shared across the team. Run in Supabase SQL editor.

create table if not exists public.addon_defaults (
  label      text primary key,
  unit       text,
  cost       numeric(12, 2),
  sell       numeric(12, 2),
  labor      boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.addon_defaults enable row level security;

drop policy if exists addon_defaults_internal on public.addon_defaults;
create policy addon_defaults_internal on public.addon_defaults
  for all to authenticated
  using (public.my_role() <> 'customer')
  with check (public.my_role() <> 'customer');

grant select, insert, update, delete on public.addon_defaults to authenticated;
