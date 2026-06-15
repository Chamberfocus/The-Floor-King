-- Floor King CRM — Showroom booking calendar
-- By-appointment showroom: customizable appointment types, showroom hours +
-- concurrent capacity, client requests (pending) that staff confirm, and
-- per-rep + capacity scheduling. Builds on the existing appointments table.
-- Run in Supabase: SQL Editor -> paste -> Run. Safe to re-run.

-- 1) Appointment types (fully customizable) ----------------------------------
create table if not exists public.appointment_types (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  duration_min  int  not null default 45,
  color         text not null default 'blue',     -- token: blue|green|amber|violet|rose|gray|teal
  kind          text not null default 'showroom', -- showroom|in_home|measure|pickup|other
  requires_rep  boolean not null default false,   -- must a specific rep be assigned?
  active        boolean not null default true,
  position      int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists appointment_types_set_updated_at on public.appointment_types;
create trigger appointment_types_set_updated_at
  before update on public.appointment_types
  for each row execute function public.set_updated_at();

alter table public.appointment_types enable row level security;
-- Anyone signed in (incl. portal customers booking) can read active types.
drop policy if exists appointment_types_read on public.appointment_types;
create policy appointment_types_read on public.appointment_types
  for select to authenticated using (true);
drop policy if exists appointment_types_admin on public.appointment_types;
create policy appointment_types_admin on public.appointment_types
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.appointment_types to authenticated;

-- Seed defaults (showroom consultation active; others ready to flip on).
insert into public.appointment_types (name, duration_min, color, kind, requires_rep, active, position)
select * from (values
  ('Showroom consultation', 45, 'blue',  'showroom', false, true,  0),
  ('In-home estimate',      60, 'green', 'in_home',  true,  false, 1),
  ('Measure',               30, 'amber', 'measure',  true,  false, 2),
  ('Material pickup',       15, 'gray',  'pickup',   false, false, 3)
) as v(name, duration_min, color, kind, requires_rep, active, position)
where not exists (select 1 from public.appointment_types);

-- 2) Showroom settings (single row) ------------------------------------------
-- Independent of field/route scheduling_settings so showroom hours can differ.
create table if not exists public.showroom_settings (
  id               text primary key default 'default',
  open_days        text not null default '1,2,3,4,5,6', -- 0=Sun..6=Sat
  day_start        text not null default '09:00',
  day_end          text not null default '17:00',
  slot_interval_min int  not null default 30,           -- booking grid granularity
  capacity         int  not null default 2,             -- concurrent appointments
  buffer_min       int  not null default 0,             -- gap after each appointment
  booking_enabled  boolean not null default true,       -- public request page on/off
  booking_notice_hours int not null default 2,          -- min lead time for client requests
  updated_at       timestamptz not null default now()
);
insert into public.showroom_settings (id) values ('default')
  on conflict (id) do nothing;

alter table public.showroom_settings enable row level security;
drop policy if exists showroom_settings_read on public.showroom_settings;
create policy showroom_settings_read on public.showroom_settings
  for select to authenticated using (true);
drop policy if exists showroom_settings_admin on public.showroom_settings;
create policy showroom_settings_admin on public.showroom_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.showroom_settings to authenticated;

-- 3) Extend appointments for the booking calendar ----------------------------
alter table public.appointments
  add column if not exists type_id       uuid references public.appointment_types (id) on delete set null,
  add column if not exists is_block      boolean not null default false, -- staff time block (no customer)
  add column if not exists title         text,    -- for blocks / custom labels
  add column if not exists contact_name  text,    -- denormalized for quick display / requests
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists source        text not null default 'staff'; -- staff|client|portal

-- status values now in use: pending | scheduled | completed | cancelled | no_show
create index if not exists appointments_starts_idx on public.appointments (starts_at);
create index if not exists appointments_status_idx on public.appointments (status);

-- Let portal customers create their OWN pending requests and read their own
-- appointments (staff already have full access via the existing policy).
drop policy if exists appointments_customer_read on public.appointments;
create policy appointments_customer_read on public.appointments
  for select to authenticated
  using (customer_id = public.my_customer_id());

drop policy if exists appointments_customer_request on public.appointments;
create policy appointments_customer_request on public.appointments
  for insert to authenticated
  with check (status = 'pending' and customer_id = public.my_customer_id());
