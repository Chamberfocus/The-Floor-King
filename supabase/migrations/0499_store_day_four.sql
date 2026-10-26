-- Pay stays on the existing payment and deposit functions.
-- This file adds the install hold, the roll identity, and the signed extra.

alter table public.jobs
  add column if not exists install_hold text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_install_hold_check'
  ) then
    alter table public.jobs
      add constraint jobs_install_hold_check
      check (install_hold is null or install_hold in ('requested', 'confirmed'));
  end if;
end $$;

update public.jobs
set install_hold = 'confirmed'
where scheduled_date is not null
  and install_hold is null;

comment on column public.jobs.install_hold is
  'requested = the date is held and the customer has not been told it is locked. confirmed = the customer and the crew were told.';

alter table public.stock_rolls
  add column if not exists dye_lot text,
  add column if not exists roll_number text,
  add column if not exists assigned_job_id uuid references public.jobs (id) on delete set null;

create index if not exists stock_rolls_assigned_job_idx
  on public.stock_rolls (assigned_job_id)
  where assigned_job_id is not null;

comment on column public.stock_rolls.dye_lot is
  'Mill dye lot printed on the install ticket.';
comment on column public.stock_rolls.roll_number is
  'Mill roll number printed on the install ticket.';
comment on column public.stock_rolls.assigned_job_id is
  'The job this roll is staged for. Distinct from job_id, which records which cut created a remnant.';

create table if not exists public.job_extras (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  signer_name text not null,
  signature text not null,
  signed_at timestamptz not null default now(),
  invoice_id uuid references public.invoices (id) on delete set null,
  idempotency_key text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists job_extras_idempotency_uidx
  on public.job_extras (idempotency_key)
  where idempotency_key is not null;

create index if not exists job_extras_job_idx
  on public.job_extras (job_id, created_at desc);

alter table public.job_extras enable row level security;

drop policy if exists job_extras_read on public.job_extras;
create policy job_extras_read on public.job_extras
  for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_extras.job_id
        and (
          public.is_staff()
          or public.my_role() in ('sales_manager', 'scheduler', 'warehouse')
          or (public.my_role() = 'salesman' and public.mine_customer(j.customer_id))
          or (public.my_role() = 'crew' and public.crew_sees_customer(j.customer_id))
        )
    )
  );

drop policy if exists job_extras_insert on public.job_extras;
create policy job_extras_insert on public.job_extras
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.my_role() in ('admin', 'office', 'sales_manager', 'salesman', 'crew')
    and exists (
      select 1 from public.jobs j
      where j.id = job_extras.job_id
        and (
          public.is_staff()
          or public.my_role() = 'sales_manager'
          or (public.my_role() = 'salesman' and public.mine_customer(j.customer_id))
          or (public.my_role() = 'crew' and public.crew_sees_customer(j.customer_id))
        )
    )
  );

grant select, insert on public.job_extras to authenticated;
