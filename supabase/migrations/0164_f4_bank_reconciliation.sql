-- F4 Accounting Integration (2/2): manual bank reconciliation foundation.
-- Non-destructive. No bank feeds. No auto-import.

create table if not exists public.bank_reconciliation_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.gl_accounts (id) on delete restrict,
  statement_start date not null,
  statement_end date not null,
  opening_balance numeric(12, 2) not null default 0,
  ending_balance numeric(12, 2) not null,
  status text not null default 'open'
    check (status in ('open', 'completed', 'cancelled')),
  calculated_ending_balance numeric(12, 2),
  difference numeric(12, 2),
  created_by uuid references auth.users (id) on delete set null,
  completed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  constraint bank_recon_dates_chk check (statement_end >= statement_start)
);

create index if not exists bank_recon_sessions_account_idx
  on public.bank_reconciliation_sessions (account_id, statement_end desc);

create table if not exists public.bank_reconciliation_cleared_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.bank_reconciliation_sessions (id) on delete restrict,
  journal_line_id uuid not null references public.journal_lines (id) on delete restrict,
  cleared boolean not null default true,
  cleared_on date,
  created_at timestamptz not null default now(),
  constraint bank_recon_cleared_unique unique (session_id, journal_line_id)
);

create index if not exists bank_recon_cleared_session_idx
  on public.bank_reconciliation_cleared_lines (session_id);

alter table public.bank_reconciliation_sessions enable row level security;
alter table public.bank_reconciliation_cleared_lines enable row level security;

drop policy if exists bank_recon_sessions_staff on public.bank_reconciliation_sessions;
create policy bank_recon_sessions_staff on public.bank_reconciliation_sessions
  for all to authenticated
  using (public.is_staff())
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

drop policy if exists bank_recon_cleared_staff on public.bank_reconciliation_cleared_lines;
create policy bank_recon_cleared_staff on public.bank_reconciliation_cleared_lines
  for all to authenticated
  using (public.is_staff())
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'office')
    )
  );

grant select, insert, update on public.bank_reconciliation_sessions to authenticated;
grant select, insert, update on public.bank_reconciliation_cleared_lines to authenticated;
-- No DELETE grants — cancel sessions instead.
