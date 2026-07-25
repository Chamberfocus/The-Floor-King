-- 0126 — Manageable cancellation reasons (why a job/deal fell through), so lost
-- business is captured as clean, reportable data instead of free text. Idempotent.

-- 1) The manageable reason list ---------------------------------------------
create table if not exists public.cancel_reasons (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  position   int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed the starter set (only when empty, so re-runs don't duplicate).
do $$ begin
  if not exists (select 1 from public.cancel_reasons) then
    insert into public.cancel_reasons (label, position) values
      ('Price too high', 10),
      ('Went with competitor', 20),
      ('Changed their mind', 30),
      ('Couldn''t schedule', 40),
      ('Financing fell through', 50),
      ('Couldn''t reach them', 60),
      ('Other', 900);
  end if;
end $$;

-- 2) Link a cancelled customer to a structured reason (keeps cancel_reason text
--    as the label/free-note snapshot for history + back-compat). ------------
alter table public.customers
  add column if not exists cancel_reason_id uuid references public.cancel_reasons (id) on delete set null;

-- 3) RLS: staff manage the list; everyone signed-in can READ it (needed to
--    pick a reason when cancelling). ----------------------------------------
alter table public.cancel_reasons enable row level security;
drop policy if exists cancel_reasons_staff_all on public.cancel_reasons;
create policy cancel_reasons_staff_all on public.cancel_reasons
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists cancel_reasons_read on public.cancel_reasons;
create policy cancel_reasons_read on public.cancel_reasons
  for select to authenticated using (true);

grant select, insert, update, delete on public.cancel_reasons to authenticated;
