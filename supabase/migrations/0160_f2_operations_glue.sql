-- F2 Operations Glue: shared tasks, job holds, service callbacks, duplicate overrides.
-- Non-destructive. Safe defaults. No financial schema changes.

-- ---------------------------------------------------------------------------
-- Shared assignable tasks (DB-backed — not localStorage)
-- ---------------------------------------------------------------------------
create table if not exists public.office_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  estimate_id uuid references public.estimates (id) on delete set null,
  source text not null default 'manual',
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent automation: one open/in_progress task per source_key.
create unique index if not exists office_tasks_source_key_open_uidx
  on public.office_tasks (source_key)
  where source_key is not null
    and status in ('open', 'in_progress');

create index if not exists office_tasks_assignee_status_idx
  on public.office_tasks (assigned_to, status, due_at);

create index if not exists office_tasks_job_idx
  on public.office_tasks (job_id)
  where job_id is not null;

-- ---------------------------------------------------------------------------
-- Manual operational hold (does not replace derived blockers)
-- ---------------------------------------------------------------------------
create table if not exists public.job_operational_holds (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  reason text not null,
  note text,
  category text not null default 'other'
    check (category in (
      'customer_delay',
      'financing',
      'site_not_ready',
      'measurement_issue',
      'management_review',
      'other'
    )),
  placed_by uuid references auth.users (id) on delete set null,
  placed_at timestamptz not null default now(),
  released_by uuid references auth.users (id) on delete set null,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists job_operational_holds_active_idx
  on public.job_operational_holds (job_id)
  where released_at is null;

-- ---------------------------------------------------------------------------
-- Service / callback records (operational — not legal warranty engine)
-- ---------------------------------------------------------------------------
create table if not exists public.service_callbacks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  job_id uuid references public.jobs (id) on delete set null,
  category text not null default 'other'
    check (category in (
      'installation',
      'material',
      'damage',
      'transition_trim',
      'floor_movement',
      'repair',
      'manufacturer',
      'other'
    )),
  description text not null default '',
  status text not null default 'open'
    check (status in (
      'open',
      'scheduled',
      'in_progress',
      'waiting',
      'resolved',
      'cancelled'
    )),
  reported_at date not null default (current_date),
  assigned_to uuid references auth.users (id) on delete set null,
  follow_up_at timestamptz,
  resolution_notes text,
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_callbacks_open_idx
  on public.service_callbacks (status, follow_up_at)
  where status in ('open', 'scheduled', 'in_progress', 'waiting');

create index if not exists service_callbacks_customer_idx
  on public.service_callbacks (customer_id, created_at desc);

create index if not exists service_callbacks_job_idx
  on public.service_callbacks (job_id)
  where job_id is not null;

-- ---------------------------------------------------------------------------
-- Explicit duplicate-create overrides (auditable)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_duplicate_overrides (
  id uuid primary key default gen_random_uuid(),
  created_customer_id uuid references public.customers (id) on delete set null,
  matched_customer_id uuid references public.customers (id) on delete set null,
  match_reason text not null,
  override_reason text not null,
  confidence text not null default 'high'
    check (confidence in ('high', 'possible')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  candidate_name text,
  candidate_email text,
  candidate_phone text
);

create index if not exists customer_duplicate_overrides_created_idx
  on public.customer_duplicate_overrides (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.office_tasks enable row level security;
alter table public.job_operational_holds enable row level security;
alter table public.service_callbacks enable row level security;
alter table public.customer_duplicate_overrides enable row level security;

drop policy if exists office_tasks_staff_all on public.office_tasks;
create policy office_tasks_staff_all on public.office_tasks
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists job_operational_holds_staff_all on public.job_operational_holds;
create policy job_operational_holds_staff_all on public.job_operational_holds
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists service_callbacks_staff_all on public.service_callbacks;
create policy service_callbacks_staff_all on public.service_callbacks
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists customer_duplicate_overrides_staff_all on public.customer_duplicate_overrides;
create policy customer_duplicate_overrides_staff_all on public.customer_duplicate_overrides
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select, insert, update on public.office_tasks to authenticated;
grant select, insert, update on public.job_operational_holds to authenticated;
grant select, insert, update on public.service_callbacks to authenticated;
grant select, insert on public.customer_duplicate_overrides to authenticated;
-- No DELETE grants — complete/cancel/release instead.
