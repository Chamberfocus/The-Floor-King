-- Floor King — a running note log on a work order
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- jobs.notes is STRUCTURED — buildJobScope parses it into job conditions and
-- per-room prep, and the questionnaire writes it. Typing "customer moved the
-- fridge" into that field either gets swallowed as free text or breaks the
-- parse, so day-to-day notes need their own home.
--
-- These are ordered, attributed, and each one decides whether the crew sees it:
-- some notes are for the office, and some MUST reach the installer.

create table if not exists public.job_notes (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  body        text not null check (length(trim(body)) > 0),
  -- True = prints on the installation work order the crew carries.
  on_work_order boolean not null default true,
  author_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists job_notes_job_idx on public.job_notes (job_id, created_at desc);

comment on column public.job_notes.on_work_order is
  'Whether this note prints on the work order the crew carries. Office-only '
  'notes stay off it so the sheet the installer reads is only what they need.';

create or replace function public.touch_job_note()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists job_notes_touch on public.job_notes;
create trigger job_notes_touch before update on public.job_notes
  for each row execute function public.touch_job_note();

alter table public.job_notes enable row level security;

-- Office and admin manage them.
drop policy if exists job_notes_staff_all on public.job_notes;
create policy job_notes_staff_all on public.job_notes for all
  to authenticated using (public.is_staff()) with check (public.is_staff());

-- The crew reads notes on their own jobs, and can add one from the field —
-- "subfloor is worse than we thought" is worth capturing while standing on it.
drop policy if exists job_notes_crew_read on public.job_notes;
create policy job_notes_crew_read on public.job_notes for select
  to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_notes.job_id and j.assigned_to = auth.uid()
    )
  );

drop policy if exists job_notes_crew_insert on public.job_notes;
create policy job_notes_crew_insert on public.job_notes for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.jobs j
      where j.id = job_notes.job_id and j.assigned_to = auth.uid()
    )
  );

grant select, insert, update, delete on public.job_notes to authenticated;
