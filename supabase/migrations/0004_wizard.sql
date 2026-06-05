-- Floor King CRM — Phase 2b: Configurable Estimate Wizard questions
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

-- 1) Enums -------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'wizard_question_kind') then
    -- detail = feeds the job description; addon = adds its own line item
    create type public.wizard_question_kind as enum ('detail', 'addon');
  end if;
  if not exists (select 1 from pg_type where typname = 'wizard_question_input') then
    create type public.wizard_question_input as enum ('text', 'yesno', 'number');
  end if;
end $$;

-- 2) Wizard questions (owner-curated; powers the estimate wizard) -------------
create table if not exists public.wizard_questions (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  help           text,
  kind           public.wizard_question_kind not null default 'detail',
  input          public.wizard_question_input not null default 'text',
  default_amount numeric(12, 2),  -- starting price for an add-on line
  position       int not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists wizard_questions_position_idx
  on public.wizard_questions (active, position);

-- 3) RLS (staff manage; everyone signed-in can read to run the wizard) -------
alter table public.wizard_questions enable row level security;

drop policy if exists wizard_questions_staff_all on public.wizard_questions;
create policy wizard_questions_staff_all on public.wizard_questions
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wizard_questions to authenticated;

-- 4) Seed sensible defaults (only if the table is empty) ---------------------
do $$
begin
  if not exists (select 1 from public.wizard_questions) then
    insert into public.wizard_questions (label, help, kind, input, default_amount, position) values
      ('Existing floor type & condition?', 'What is being replaced and what shape is it in?', 'detail', 'text', null, 10),
      ('Subfloor type & condition?', 'Concrete / plywood; level, squeaks, damage?', 'detail', 'text', null, 20),
      ('Any moisture concerns?', 'Basement, bathroom, slab moisture, etc.', 'detail', 'yesno', null, 30),
      ('Preferred timeline / start date?', null, 'detail', 'text', null, 40),
      ('Pets in the home?', null, 'detail', 'yesno', null, 50),
      ('Special access or parking notes?', 'Stairs to unit, elevator, gate codes, etc.', 'detail', 'text', null, 60),
      ('Tear-out & haul-away of existing flooring', 'Remove and dispose of old flooring.', 'addon', 'yesno', 0, 70),
      ('Subfloor prep / leveling', 'Leveling compound, patching, moisture barrier.', 'addon', 'yesno', 0, 80),
      ('Furniture / appliance moving', null, 'addon', 'yesno', 0, 90),
      ('Trim, quarter-round & transitions', null, 'addon', 'yesno', 0, 100),
      ('Stairs', 'Per-job stair charge.', 'addon', 'yesno', 0, 110);
  end if;
end $$;
