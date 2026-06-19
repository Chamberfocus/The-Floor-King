-- Floor King CRM — saved default pricing per flooring type for the estimate
-- builder. "Set as default" on a room stores its material/labor cost & price and
-- waste, keyed by flooring category, so they pre-fill when you pick that type.
-- Shared across the team. Run in Supabase SQL editor. Safe to re-run.

create table if not exists public.room_defaults (
  category      text primary key,
  material_cost numeric(12, 2),
  material_sell numeric(12, 2),
  labor_cost    numeric(12, 2),
  labor_sell    numeric(12, 2),
  waste         numeric(6, 2),
  updated_at    timestamptz not null default now()
);

alter table public.room_defaults enable row level security;

drop policy if exists room_defaults_internal on public.room_defaults;
create policy room_defaults_internal on public.room_defaults
  for all to authenticated
  using (public.my_role() <> 'customer')
  with check (public.my_role() <> 'customer');

grant select, insert, update, delete on public.room_defaults to authenticated;
