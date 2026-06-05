-- Floor King CRM — Phase 8: Expenses (for financial reporting)
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'expense_category') then
    create type public.expense_category as enum
      ('materials', 'labor', 'subcontractor', 'vehicle', 'fuel', 'rent',
       'utilities', 'insurance', 'marketing', 'tools', 'payroll', 'office', 'other');
  end if;
end $$;

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  date        date not null default now(),
  category    public.expense_category not null default 'other',
  amount      numeric(12, 2) not null,
  vendor      text,
  note        text,
  job_id      uuid references public.jobs (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (date desc);
create index if not exists expenses_job_idx on public.expenses (job_id);

alter table public.expenses enable row level security;

drop policy if exists expenses_staff_all on public.expenses;
create policy expenses_staff_all on public.expenses
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.expenses to authenticated;
