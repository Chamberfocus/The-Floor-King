-- Floor King CRM — auto-save for the estimate BUILDER. One in-progress draft per
-- estimate (the serialized builder state), so typing is never lost on navigate-
-- away / close / logout / session timeout. Cleared on an explicit Save. The real
-- estimate lines are untouched until you Save — this is a safety net only.
create table if not exists public.estimate_builder_drafts (
  estimate_id uuid primary key references public.estimates (id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.estimate_builder_drafts enable row level security;
drop policy if exists ebd_staff on public.estimate_builder_drafts;
create policy ebd_staff on public.estimate_builder_drafts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.estimate_builder_drafts to authenticated;
