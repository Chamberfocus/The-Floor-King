-- Floor King CRM — hard-surface estimate engine: conditional questions +
-- saved customer areas. Run in Supabase: SQL Editor -> paste -> Run. Idempotent.

-- Stable slug so a question can be referenced by conditional logic (show_if).
alter table public.estimate_questions
  add column if not exists key text;

-- Saved room/area measurements per customer (sq ft calculator + dashboard card).
create table if not exists public.customer_areas (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  position    int not null default 0,
  name        text not null default '',
  length_in   numeric,
  width_in    numeric,
  sqft        numeric,
  note        text,
  differs     boolean not null default false, -- needs different prep than default
  created_at  timestamptz not null default now()
);
create index if not exists customer_areas_customer_idx on public.customer_areas (customer_id, position);

alter table public.customer_areas enable row level security;
drop policy if exists ca_staff_all on public.customer_areas;
create policy ca_staff_all on public.customer_areas
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.customer_areas to authenticated;
