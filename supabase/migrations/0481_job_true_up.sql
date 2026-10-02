-- Floor King CRM — job true-up, actual profitability, and internal sales commission.
-- Operational costing only. NOT the books of record.
--
-- Number 0481 is intentional. Unmerged PR #46 owns 0480_record_lifecycle.sql,
-- which is not on main. This file does not depend on 0480 and does not
-- renumber any earlier migration.
--
-- Does NOT enable accounting.
-- Leaves accounting control columns untouched (books_of_record, posting_enabled, backup_pitr_confirmed_at).
-- Does NOT modify invoices, payments, deposits, credits, refunds, tax,
-- estimate approval snapshots, purchase-order receipts, or inventory quantities.
-- Does NOT post a journal entry when commission is marked paid.
--
-- Apply later in the Supabase SQL editor. Do not run this from the app deploy.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.job_true_ups (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs (id) on delete cascade,
  status text not null default 'needs_true_up'
    check (status in (
      'needs_true_up',
      'missing_costs',
      'ready_for_review',
      'approved',
      'commission_payable',
      'commission_paid'
    )),
  salesperson_id uuid references public.profiles (id) on delete set null,
  formula_version int not null default 1,
  approved_at timestamptz,
  collection_override boolean not null default false,
  collection_override_reason text,
  collection_override_by uuid references public.profiles (id) on delete set null,
  collection_override_at timestamptz,
  gp_override_cents bigint,
  gp_override_reason text,
  gp_override_by uuid references public.profiles (id) on delete set null,
  gp_override_at timestamptz,
  rate_override_bps int,
  rate_override_reason text,
  rate_override_by uuid references public.profiles (id) on delete set null,
  rate_override_at timestamptz,
  amount_override_cents bigint,
  amount_override_reason text,
  amount_override_by uuid references public.profiles (id) on delete set null,
  amount_override_at timestamptz,
  zero_revenue_ack_reason text,
  zero_revenue_ack_by uuid references public.profiles (id) on delete set null,
  zero_revenue_ack_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_true_ups_status_idx on public.job_true_ups (status, updated_at desc);
create index if not exists job_true_ups_salesperson_idx on public.job_true_ups (salesperson_id);

create table if not exists public.job_true_up_entries (
  id uuid primary key default gen_random_uuid(),
  true_up_id uuid not null references public.job_true_ups (id) on delete cascade,
  category text not null check (category in ('material', 'labor', 'freight', 'other')),
  kind text not null check (kind in ('confirm_zero', 'manual_amount')),
  amount_cents bigint not null,
  reason text not null,
  note text,
  entered_by uuid not null references public.profiles (id) on delete restrict,
  entered_at timestamptz not null default now()
);

create index if not exists job_true_up_entries_latest_idx
  on public.job_true_up_entries (true_up_id, category, entered_at desc);

create table if not exists public.job_true_up_snapshots (
  id uuid primary key default gen_random_uuid(),
  true_up_id uuid not null references public.job_true_ups (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  version int not null,
  salesperson_id uuid references public.profiles (id) on delete set null,
  approved_by uuid not null references public.profiles (id) on delete restrict,
  approved_at timestamptz not null default now(),
  formula_version int not null,
  payload jsonb not null,
  unique (true_up_id, version)
);

create index if not exists job_true_up_snapshots_job_idx
  on public.job_true_up_snapshots (job_id, version desc);

create table if not exists public.job_commission_ledger (
  id uuid primary key default gen_random_uuid(),
  salesperson_id uuid not null references public.profiles (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete cascade,
  true_up_id uuid not null references public.job_true_ups (id) on delete cascade,
  snapshot_id uuid references public.job_true_up_snapshots (id) on delete set null,
  snapshot_version int,
  kind text not null check (kind in ('earned', 'adjustment')),
  amount_cents bigint not null,
  status text not null check (status in ('recorded', 'payable', 'paid')),
  earned_at timestamptz,
  payable_at timestamptz,
  paid_at timestamptz,
  source_note text,
  revised_payload jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create unique index if not exists job_commission_ledger_one_earned
  on public.job_commission_ledger (true_up_id)
  where kind = 'earned';

create index if not exists job_commission_ledger_salesperson_idx
  on public.job_commission_ledger (salesperson_id, status, created_at desc);

create table if not exists public.job_commission_payments (
  id uuid primary key default gen_random_uuid(),
  salesperson_id uuid not null references public.profiles (id) on delete restrict,
  period_start date,
  period_end date,
  total_cents bigint not null,
  paid_on date not null,
  paid_by uuid not null references public.profiles (id) on delete restrict,
  reference text,
  note text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.job_commission_payment_lines (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.job_commission_payments (id) on delete cascade,
  ledger_id uuid not null unique references public.job_commission_ledger (id) on delete restrict,
  amount_cents bigint not null check (amount_cents <> 0)
);

create table if not exists public.job_true_up_audit (
  id uuid primary key default gen_random_uuid(),
  true_up_id uuid references public.job_true_ups (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  action text not null,
  reason text,
  actor_id uuid references public.profiles (id) on delete set null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists job_true_up_audit_job_idx
  on public.job_true_up_audit (job_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Money + commission formula (integer cents, formula version 1)
-- gp * 10000 >= revenue * 5000  → 50.00% → 8.00%
-- 49.999% fails that test. 45.00%, 40.00%, and 35.00% are inclusive.
-- ---------------------------------------------------------------------------

create or replace function public.fk_true_up_cents(p_amount numeric)
returns bigint
language sql
immutable
as $$
  select case
    when p_amount is null then null
    else round(p_amount * 100)::bigint
  end;
$$;

create or replace function public.fk_commission_rate_bps(p_gp bigint, p_rev bigint)
returns integer
language sql
immutable
as $$
  select case
    when p_rev is null or p_gp is null or p_rev <= 0 or p_gp <= 0 then 0
    when p_gp * 10000 >= p_rev * 5000 then 800
    when p_gp * 10000 >= p_rev * 4500 then 700
    when p_gp * 10000 >= p_rev * 4000 then 600
    when p_gp * 10000 >= p_rev * 3500 then 500
    else 250
  end;
$$;

create or replace function public.fk_commission_amount_cents(p_gp bigint, p_rev bigint)
returns bigint
language sql
immutable
as $$
  select case
    when p_rev is null or p_gp is null or p_rev <= 0 or p_gp <= 0 then 0
    else (p_gp * public.fk_commission_rate_bps(p_gp, p_rev) + 5000) / 10000
  end;
$$;

create or replace function public.fk_margin_hundredths(p_gp bigint, p_rev bigint)
returns bigint
language sql
immutable
as $$
  select case
    when p_rev is null or p_rev <= 0 or p_gp is null then null
    when p_gp < 0 then -(((-p_gp) * 10000 + p_rev / 2) / p_rev)
    else (p_gp * 10000 + p_rev / 2) / p_rev
  end;
$$;

-- ---------------------------------------------------------------------------
-- Role gate. Sales manager, scheduler, warehouse, crew, and customer are out.
-- ---------------------------------------------------------------------------

create or replace function public.fk_true_up_assert_staff()
returns void
language plpgsql
stable
as $$
begin
  if public.my_role() not in ('admin', 'office') then
    raise exception 'Not authorized.';
  end if;
end;
$$;

create or replace function public.fk_true_up_assert_admin()
returns void
language plpgsql
stable
as $$
begin
  if public.my_role() <> 'admin' then
    raise exception 'Not authorized.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Calculation. Reads canonical records. Does not write them.
-- ---------------------------------------------------------------------------

create or replace function public.job_true_up_calculate(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.my_role();
  v_job public.jobs%rowtype;
  v_sales uuid;
  v_true public.job_true_ups%rowtype;
  v_has_true boolean := false;
  v_freight_pct numeric := 0;
  v_orig bigint;
  v_latest bigint;
  v_change bigint;
  v_est_mat bigint;
  v_est_labor bigint;
  v_est_freight bigint;
  v_est_other bigint := 0;
  v_est_rev bigint;
  v_est_cost bigint;
  v_est_gp bigint;
  v_act_rev bigint := 0;
  v_rev_known boolean := false;
  v_dup int := 0;
  v_mat bigint := 0;
  v_mat_state text := 'unknown';
  v_labor bigint := 0;
  v_labor_state text := 'unknown';
  v_freight bigint := 0;
  v_freight_state text := 'unknown';
  v_other bigint := 0;
  v_other_state text := 'unknown';
  v_pull bigint := 0;
  v_job_return bigint := 0;
  v_missing_cost int := 0;
  v_drop bigint := 0;
  v_po_open int := 0;
  v_freight_open int := 0;
  v_bills_actual bigint := 0;
  v_bills_draft int := 0;
  v_bills_approved int := 0;
  v_legacy int := 0;
  v_exp bigint := 0;
  v_exp_wait int := 0;
  v_issues bigint := 0;
  v_sub_exp bigint := 0;
  v_bill_any int := 0;
  v_open numeric := 0;
  v_invoice_n int := 0;
  v_manual record;
  v_gp bigint;
  v_rate int;
  v_comm bigint;
  v_calc_rate int;
  v_calc_comm bigint;
  v_complete boolean;
  v_blockers text[] := array[]::text[];
  v_flags text[] := array[]::text[];
begin
  if v_role not in ('admin', 'office') then
    raise exception 'Not authorized.';
  end if;

  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    raise exception 'Job not found.';
  end if;

  select * into v_true from public.job_true_ups where job_id = p_job_id;
  v_has_true := found;
  select c.assigned_to into v_sales
  from public.customers c
  where c.id = v_job.customer_id;
  if v_has_true and v_true.salesperson_id is not null then
    v_sales := v_true.salesperson_id;
  end if;

  select coalesce(freight_markup_pct, 0) into v_freight_pct
  from public.org_settings
  limit 1;

  select
    public.fk_true_up_cents((payload->>'total')::numeric - (payload->>'tax_amount')::numeric),
    public.fk_true_up_cents((payload->>'total')::numeric - (payload->>'tax_amount')::numeric)
  into v_orig, v_latest
  from (
    select payload
    from public.estimate_approval_snapshots
    where estimate_id = v_job.estimate_id
    order by version asc
    limit 1
  ) first_snap;

  select public.fk_true_up_cents((payload->>'total')::numeric - (payload->>'tax_amount')::numeric)
  into v_latest
  from public.estimate_approval_snapshots
  where estimate_id = v_job.estimate_id
  order by version desc
  limit 1;

  if v_orig is null then
    v_change := null;
    v_est_rev := null;
  else
    v_change := coalesce(v_latest, v_orig) - v_orig;
    v_est_rev := v_orig + v_change;
  end if;

  v_est_mat := public.fk_true_up_cents(v_job.estimated_material_cost);
  v_est_labor := public.fk_true_up_cents(v_job.estimated_labor_cost);
  if v_est_mat is null then
    v_est_freight := null;
  else
    v_est_freight := public.fk_true_up_cents(round(v_job.estimated_material_cost * v_freight_pct / 100.0, 2));
  end if;

  -- Active invoice pre-tax revenue. Tax, payments, deposits, and refunds are not revenue.
  with active as (
    select
      i.id,
      i.commercial_kind,
      i.created_at,
      t.subtotal,
      t.tax,
      t.total
    from public.invoices i
    join lateral public.invoice_commercial_total(i.id) t on true
    where i.job_id = p_job_id
      and i.status::text in ('sent', 'partial', 'paid')
  ),
  originals as (
    select id, row_number() over (order by created_at, id) as n
    from active
    where commercial_kind = 'original'
  ),
  kept as (
    select a.*
    from active a
    where coalesce(a.commercial_kind, '') <> 'original'
       or a.id in (select id from originals where n = 1)
  )
  select
    coalesce(public.fk_true_up_cents(sum(
      k.subtotal
      - case
          when k.total > 0 then round(coalesce((
            select sum(ca.amount) from public.credit_applications ca
            where ca.invoice_id = k.id and ca.status = 'active'
          ), 0) * k.subtotal / k.total, 2)
          else 0
        end
      - case
          when k.total > 0 then round(coalesce((
            select sum(w.amount) from public.invoice_write_offs w
            where w.invoice_id = k.id and w.status = 'active'
          ), 0) * k.subtotal / k.total, 2)
          else 0
        end
    )), 0),
    count(*)::int,
    (select count(*)::int from originals where n > 1)
  into v_act_rev, v_invoice_n, v_dup
  from kept k;

  v_rev_known := v_invoice_n > 0;

  -- Job material matches inv_job_net_material_actual: non-void pulls minus
  -- non-void job returns. A blank unit cost is incomplete, not $0.
  -- vendor_return is inventory, not a reduction of this job.
  select count(*) into v_missing_cost
  from public.stock_movements sm
  where sm.job_id = p_job_id
    and sm.voided_at is null
    and (
      sm.kind = 'pull'
      or (sm.kind = 'return' and sm.source_type = 'job_return')
    )
    and sm.extended_cost is null
    and sm.unit_cost is null;

  select coalesce(sum(
    case
      when sm.extended_cost is not null then public.fk_true_up_cents(sm.extended_cost)
      else public.fk_true_up_cents(abs(sm.qty) * sm.unit_cost)
    end
  ), 0)
  into v_pull
  from public.stock_movements sm
  where sm.job_id = p_job_id
    and sm.kind = 'pull'
    and sm.voided_at is null
    and (sm.extended_cost is not null or sm.unit_cost is not null);

  select coalesce(sum(
    case
      when sm.extended_cost is not null then public.fk_true_up_cents(sm.extended_cost)
      else public.fk_true_up_cents(abs(sm.qty) * sm.unit_cost)
    end
  ), 0)
  into v_job_return
  from public.stock_movements sm
  where sm.job_id = p_job_id
    and sm.kind = 'return'
    and sm.source_type = 'job_return'
    and sm.voided_at is null
    and (sm.extended_cost is not null or sm.unit_cost is not null);

  v_pull := v_pull - v_job_return;

  -- Drop-ship / untracked lines supplement cost only when fully received,
  -- priced, and not already represented by a pull. Tracked receipts are inventory.
  select coalesce(sum(public.fk_true_up_cents(pi.received_qty * pi.unit_cost)), 0)
  into v_drop
  from public.po_items pi
  join public.purchase_orders po on po.id = pi.po_id
  left join public.products p on p.id = pi.product_id
  where po.status::text in ('ordered', 'received', 'closed')
    and (po.job_id = p_job_id or pi.for_job_id = p_job_id)
    and coalesce(pi.received_qty, 0) > 0
    and pi.unit_cost is not null
    and coalesce(pi.quantity, 0) <= coalesce(pi.received_qty, 0)
    and pi.description !~* '\m(freight|shipping|delivery)\M'
    and (
      pi.product_id is null
      or (p.id is not null and p.track_stock = false)
    )
    and (
      pi.product_id is null
      or not exists (
        select 1 from public.stock_movements sm
        where sm.job_id = p_job_id
          and sm.kind = 'pull'
          and sm.voided_at is null
          and sm.product_id = pi.product_id
      )
    );

  select count(*) into v_po_open
  from public.po_items pi
  join public.purchase_orders po on po.id = pi.po_id
  left join public.products p on p.id = pi.product_id
  where po.status::text in ('ordered', 'received', 'closed')
    and (po.job_id = p_job_id or pi.for_job_id = p_job_id)
    and pi.description !~* '\m(freight|shipping|delivery)\M'
    and (
      (
        (pi.product_id is null or (p.id is not null and p.track_stock = false))
        and (
          (coalesce(pi.quantity, 0) > 0 and coalesce(pi.received_qty, 0) < coalesce(pi.quantity, 0))
          or (coalesce(pi.received_qty, 0) > 0 and pi.unit_cost is null)
        )
      )
      or (
        pi.product_id is not null
        and (p.id is null or p.track_stock = true)
        and coalesce(pi.quantity, 0) > 0
        and coalesce(pi.received_qty, 0) < coalesce(pi.quantity, 0)
      )
      or (
        pi.product_id is not null
        and (p.id is null or p.track_stock = true)
        and coalesce(pi.received_qty, 0) > 0
        and coalesce(pi.received_qty, 0) >= coalesce(pi.quantity, 0)
        and not exists (
          select 1 from public.stock_movements sm
          where sm.job_id = p_job_id
            and sm.kind = 'pull'
            and sm.voided_at is null
            and sm.product_id = pi.product_id
        )
      )
    );

  if v_missing_cost > 0 or v_po_open > 0 then
    v_mat_state := 'incomplete';
  elsif v_pull <> 0 or v_drop <> 0 or exists (
    select 1 from public.stock_movements sm
    where sm.job_id = p_job_id
      and sm.voided_at is null
      and (
        sm.kind = 'pull'
        or (sm.kind = 'return' and sm.source_type = 'job_return')
      )
      and (sm.extended_cost is not null or sm.unit_cost is not null)
  ) or exists (
    select 1
    from public.po_items pi
    join public.purchase_orders po on po.id = pi.po_id
    left join public.products p on p.id = pi.product_id
    where po.status::text in ('ordered', 'received', 'closed')
      and (po.job_id = p_job_id or pi.for_job_id = p_job_id)
      and pi.description !~* '\m(freight|shipping|delivery)\M'
      and coalesce(pi.received_qty, 0) > 0
      and pi.unit_cost is not null
      and coalesce(pi.quantity, 0) <= coalesce(pi.received_qty, 0)
      and (
        pi.product_id is null
        or (p.id is not null and p.track_stock = false)
      )
  ) then
    v_mat := v_pull + v_drop;
    v_mat_state := 'auto';
  end if;

  select
    coalesce(sum(public.fk_true_up_cents(b.total)) filter (where b.status in ('approved', 'paid')), 0),
    count(*) filter (where b.status = 'draft'),
    count(*) filter (where b.status in ('approved', 'paid')),
    count(*)
  into v_bills_actual, v_bills_draft, v_bills_approved, v_bill_any
  from public.installer_bills b
  where b.job_id = p_job_id
    and coalesce(b.legacy_display_only, false) = false;

  select count(*) into v_legacy from public.job_labor where job_id = p_job_id;

  if v_bills_draft > 0
     or (v_bills_approved = 0 and (v_job.assigned_to is not null or v_job.assigned_crew_id is not null or v_legacy > 0))
  then
    v_labor_state := 'incomplete';
  elsif v_bills_approved > 0 then
    v_labor := v_bills_actual;
    v_labor_state := 'auto';
  end if;

  select coalesce(sum(public.fk_true_up_cents(pi.received_qty * pi.unit_cost)), 0)
  into v_freight
  from public.po_items pi
  join public.purchase_orders po on po.id = pi.po_id
  where po.status::text in ('ordered', 'received', 'closed')
    and (po.job_id = p_job_id or pi.for_job_id = p_job_id)
    and pi.description ~* '\m(freight|shipping|delivery)\M'
    and coalesce(pi.received_qty, 0) > 0
    and pi.unit_cost is not null
    and coalesce(pi.quantity, 0) <= coalesce(pi.received_qty, 0);

  select count(*) into v_freight_open
  from public.po_items pi
  join public.purchase_orders po on po.id = pi.po_id
  where po.status::text in ('ordered', 'received', 'closed')
    and (po.job_id = p_job_id or pi.for_job_id = p_job_id)
    and pi.description ~* '\m(freight|shipping|delivery)\M'
    and (
      (coalesce(pi.quantity, 0) > 0 and coalesce(pi.received_qty, 0) < coalesce(pi.quantity, 0))
      or (coalesce(pi.received_qty, 0) > 0 and pi.unit_cost is null)
    );

  if v_freight_open > 0 then
    v_freight_state := 'incomplete';
    v_freight := 0;
  elsif v_freight <> 0 or exists (
    select 1
    from public.po_items pi
    join public.purchase_orders po on po.id = pi.po_id
    where po.status::text in ('ordered', 'received', 'closed')
      and (po.job_id = p_job_id or pi.for_job_id = p_job_id)
      and pi.description ~* '\m(freight|shipping|delivery)\M'
      and coalesce(pi.received_qty, 0) > 0
      and pi.unit_cost is not null
      and coalesce(pi.quantity, 0) <= coalesce(pi.received_qty, 0)
  ) then
    v_freight_state := 'auto';
  end if;

  select coalesce(sum(public.fk_true_up_cents(e.amount)), 0)
  into v_exp
  from public.expenses e
  where e.job_id = p_job_id
    and e.category::text in ('materials', 'tools', 'other');

  select coalesce(sum(public.fk_true_up_cents(e.amount)), 0)
  into v_sub_exp
  from public.expenses e
  where e.job_id = p_job_id
    and e.category::text = 'subcontractor';

  select coalesce(sum(public.fk_true_up_cents(ji.cost_impact)), 0)
  into v_issues
  from public.job_issues ji
  where ji.job_id = p_job_id
    and coalesce(ji.cost_impact, 0) <> 0;

  v_other := v_exp + v_issues + case when v_bill_any = 0 then v_sub_exp else 0 end;
  if exists (
    select 1 from public.expenses e
    where e.job_id = p_job_id
      and e.category::text in ('materials', 'tools', 'other')
  ) or v_issues <> 0 or (
    v_bill_any = 0 and exists (
      select 1 from public.expenses e
      where e.job_id = p_job_id and e.category::text = 'subcontractor'
    )
  ) then
    v_other_state := 'auto';
  end if;

  if v_has_true then
    for v_manual in
      select distinct on (category) category, kind, amount_cents
      from public.job_true_up_entries
      where true_up_id = v_true.id
      order by category, entered_at desc
    loop
      if v_manual.category = 'material' then
        v_mat := case when v_manual.kind = 'confirm_zero' then 0 else v_manual.amount_cents end;
        v_mat_state := v_manual.kind;
      elsif v_manual.category = 'labor' then
        v_labor := case when v_manual.kind = 'confirm_zero' then 0 else v_manual.amount_cents end;
        v_labor_state := v_manual.kind;
      elsif v_manual.category = 'freight' then
        v_freight := case when v_manual.kind = 'confirm_zero' then 0 else v_manual.amount_cents end;
        v_freight_state := v_manual.kind;
      elsif v_manual.category = 'other' then
        v_other := case when v_manual.kind = 'confirm_zero' then 0 else v_manual.amount_cents end;
        v_other_state := v_manual.kind;
      end if;
    end loop;
  end if;

  v_complete := v_mat_state in ('auto', 'confirm_zero', 'manual_amount')
    and v_labor_state in ('auto', 'confirm_zero', 'manual_amount')
    and v_freight_state in ('auto', 'confirm_zero', 'manual_amount')
    and v_other_state in ('auto', 'confirm_zero', 'manual_amount')
    and v_rev_known;

  if v_job.status::text <> 'completed' then
    v_blockers := v_blockers || 'Job is not completed.';
  end if;
  if not v_complete then
    v_blockers := v_blockers || 'Required actual costs are still missing.';
  end if;
  if not v_rev_known then
    v_blockers := v_blockers || 'Final revenue is not on an active invoice.';
  end if;
  if v_dup > 0 then
    v_blockers := v_blockers || 'Duplicate original invoices must be voided before approval.';
    v_flags := v_flags || 'A duplicate original invoice was excluded from revenue.';
  end if;
  if v_rev_known and v_act_rev <= 0 and (not v_has_true or v_true.zero_revenue_ack_at is null) then
    v_blockers := v_blockers || 'Zero or negative revenue requires an admin review acknowledgement.';
  end if;
  if v_sales is null then
    v_blockers := v_blockers || 'Assign a salesperson before approval.';
  end if;
  if v_labor_state = 'incomplete' then
    v_blockers := v_blockers || 'LABOR COST INCOMPLETE';
  end if;

  if v_est_mat is null or v_est_labor is null or v_est_freight is null or v_est_rev is null then
    v_est_cost := null;
    v_est_gp := null;
  else
    v_est_cost := v_est_mat + v_est_labor + v_est_freight + v_est_other;
    v_est_gp := v_est_rev - v_est_cost;
  end if;

  if v_complete then
    v_gp := v_act_rev - (v_mat + v_labor + v_freight + v_other);
  else
    v_gp := null;
  end if;

  v_calc_rate := public.fk_commission_rate_bps(v_gp, case when v_rev_known then v_act_rev else null end);
  v_calc_comm := public.fk_commission_amount_cents(v_gp, case when v_rev_known then v_act_rev else null end);
  v_rate := v_calc_rate;
  v_comm := v_calc_comm;

  if v_has_true and v_true.gp_override_cents is not null and v_rev_known then
    v_gp := v_true.gp_override_cents;
    v_rate := public.fk_commission_rate_bps(v_gp, v_act_rev);
    v_comm := public.fk_commission_amount_cents(v_gp, v_act_rev);
  end if;
  if v_has_true and v_true.rate_override_bps is not null and v_gp is not null and v_gp > 0 then
    v_rate := v_true.rate_override_bps;
    v_comm := (v_gp * v_true.rate_override_bps + 5000) / 10000;
  end if;
  if v_has_true and v_true.amount_override_cents is not null then
    v_comm := greatest(v_true.amount_override_cents, 0);
  end if;
  if v_gp is not null and v_gp <= 0 then
    v_flags := v_flags || 'NO COMMISSION — JOB HAS NO POSITIVE GROSS PROFIT';
    if (not v_has_true) or (v_true.amount_override_cents is null and v_true.rate_override_bps is null) then
      v_comm := 0;
      v_rate := 0;
    end if;
  end if;

  select coalesce(sum(public.invoice_open_ar_balance(i.id)), 0), count(*)
  into v_open, v_invoice_n
  from public.invoices i
  where i.job_id = p_job_id
    and i.status::text in ('sent', 'partial', 'paid');

  return jsonb_build_object(
    'formula_version', 1,
    'job_completed', v_job.status::text = 'completed',
    'salesperson_id', v_sales,
    'true_up_id', case when v_has_true then v_true.id else null end,
    'approved', v_has_true and v_true.approved_at is not null,
    'original_revenue_cents', v_orig,
    'change_order_revenue_cents', v_change,
    'estimated_revenue_cents', v_est_rev,
    'estimated_material_cents', v_est_mat,
    'estimated_labor_cents', v_est_labor,
    'estimated_freight_cents', v_est_freight,
    'estimated_other_cents', v_est_other,
    'estimated_direct_cents', v_est_cost,
    'estimated_gp_cents', v_est_gp,
    'estimated_margin_hundredths', public.fk_margin_hundredths(v_est_gp, v_est_rev),
    'actual_revenue_cents', case when v_rev_known then v_act_rev else null end,
    'revenue_state', case when v_rev_known then 'known' else 'missing' end,
    'actual_material_cents', case when v_mat_state in ('auto', 'confirm_zero', 'manual_amount') then v_mat else null end,
    'actual_labor_cents', case when v_labor_state in ('auto', 'confirm_zero', 'manual_amount') then v_labor else null end,
    'actual_freight_cents', case when v_freight_state in ('auto', 'confirm_zero', 'manual_amount') then v_freight else null end,
    'actual_other_cents', case when v_other_state in ('auto', 'confirm_zero', 'manual_amount') then v_other else null end,
    'actual_direct_cents', case when v_complete then v_mat + v_labor + v_freight + v_other else null end,
    'actual_gp_cents', v_gp,
    'actual_margin_hundredths', public.fk_margin_hundredths(v_gp, case when v_rev_known then v_act_rev else null end),
    'material_state', v_mat_state,
    'labor_state', v_labor_state,
    'freight_state', v_freight_state,
    'other_state', v_other_state,
    'costs_complete', v_complete,
    'calculated_rate_bps', v_calc_rate,
    'calculated_commission_cents', v_calc_comm,
    'rate_bps', v_rate,
    'commission_cents', v_comm,
    'open_balance_cents', public.fk_true_up_cents(v_open),
    'collection_override', v_has_true and coalesce(v_true.collection_override, false),
    'duplicate_originals', v_dup,
    'blockers', to_jsonb(v_blockers),
    'flags', to_jsonb(v_flags),
    'can_approve', cardinality(v_blockers) = 0 and (not v_has_true or v_true.approved_at is null)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Mutations. Locks and unique keys stop double approval and double pay.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_job_true_up(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_sales uuid;
  v_status text;
begin
  perform public.fk_true_up_assert_staff();
  select j.status::text into v_status from public.jobs j where j.id = p_job_id;
  if v_status is null then
    raise exception 'Job not found.';
  end if;
  if v_status <> 'completed' then
    raise exception 'True-up starts when the job is completed.';
  end if;
  select c.assigned_to into v_sales
  from public.jobs j
  join public.customers c on c.id = j.customer_id
  where j.id = p_job_id;

  insert into public.job_true_ups (job_id, salesperson_id, status)
  values (p_job_id, v_sales, 'needs_true_up')
  on conflict (job_id) do nothing;

  select id into v_id from public.job_true_ups where job_id = p_job_id;
  return v_id;
end;
$$;

create or replace function public.record_true_up_entry(
  p_job_id uuid,
  p_category text,
  p_kind text,
  p_amount_cents bigint,
  p_reason text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_entry uuid;
  v_calc jsonb;
  v_status text;
begin
  perform public.fk_true_up_assert_staff();
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required.';
  end if;
  if p_category not in ('material', 'labor', 'freight', 'other') then
    raise exception 'Unknown cost category.';
  end if;
  if p_kind not in ('confirm_zero', 'manual_amount') then
    raise exception 'Unknown cost entry.';
  end if;
  if p_kind = 'confirm_zero' and p_amount_cents <> 0 then
    raise exception 'A zero confirmation must be $0.';
  end if;
  if p_kind = 'manual_amount' and p_amount_cents < 0 then
    raise exception 'Enter a zero confirmation for a legitimate zero. Amounts cannot be negative.';
  end if;

  v_id := public.ensure_job_true_up(p_job_id);
  perform 1 from public.job_true_ups where id = v_id for update;

  insert into public.job_true_up_entries (
    true_up_id, category, kind, amount_cents, reason, note, entered_by
  ) values (
    v_id, p_category, p_kind, p_amount_cents, btrim(p_reason), nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
  )
  returning id into v_entry;

  insert into public.job_true_up_audit (true_up_id, job_id, action, reason, actor_id, after)
  values (
    v_id, p_job_id, 'cost_entry', btrim(p_reason), auth.uid(),
    jsonb_build_object('category', p_category, 'kind', p_kind, 'amount_cents', p_amount_cents, 'note', p_note)
  );

  v_calc := public.job_true_up_calculate(p_job_id);
  if (select approved_at from public.job_true_ups where id = v_id) is null then
    v_status := case
      when coalesce((v_calc->>'costs_complete')::boolean, false)
        and (v_calc->>'revenue_state') = 'known'
        and (v_calc->>'salesperson_id') is not null
        then 'ready_for_review'
      else 'missing_costs'
    end;
    update public.job_true_ups
      set status = v_status, updated_at = now()
      where id = v_id;
  end if;

  return v_entry;
end;
$$;

create or replace function public.approve_job_true_up(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_calc jsonb;
  v_version int;
  v_snap uuid;
  v_sales uuid;
  v_comm bigint;
  v_open bigint;
  v_collected boolean;
  v_status text;
  v_key text;
begin
  perform public.fk_true_up_assert_staff();
  v_id := public.ensure_job_true_up(p_job_id);
  perform 1 from public.job_true_ups where id = v_id for update;

  if exists (select 1 from public.job_true_up_snapshots where true_up_id = v_id) then
    raise exception 'This true-up is already approved.';
  end if;

  -- Recalculate here. Caller arguments cannot supply the dollars.
  v_calc := public.job_true_up_calculate(p_job_id);
  if jsonb_array_length(coalesce(v_calc->'blockers', '[]'::jsonb)) > 0 then
    raise exception 'True-up is not ready: %', v_calc->>'blockers';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.job_true_up_snapshots
  where true_up_id = v_id;

  v_sales := (v_calc->>'salesperson_id')::uuid;
  v_comm := (v_calc->>'commission_cents')::bigint;
  v_open := coalesce((v_calc->>'open_balance_cents')::bigint, 0);
  v_collected := coalesce((v_calc->>'collection_override')::boolean, false) or v_open <= 0;
  v_status := case when v_collected then 'commission_payable' else 'approved' end;
  v_key := 'earned:' || v_id::text || ':v' || v_version::text;

  insert into public.job_true_up_snapshots (
    true_up_id, job_id, version, salesperson_id, approved_by, formula_version, payload
  ) values (
    v_id, p_job_id, v_version, v_sales, auth.uid(), 1, v_calc
  )
  returning id into v_snap;

  insert into public.job_commission_ledger (
    salesperson_id, job_id, true_up_id, snapshot_id, snapshot_version,
    kind, amount_cents, status, earned_at, payable_at, source_note, idempotency_key
  ) values (
    v_sales, p_job_id, v_id, v_snap, v_version,
    'earned', v_comm,
    case when v_collected then 'payable' else 'recorded' end,
    now(),
    case when v_collected then now() else null end,
    'Approved true-up formula version 1',
    v_key
  );

  update public.job_true_ups
    set status = v_status,
        salesperson_id = v_sales,
        approved_at = now(),
        updated_at = now()
    where id = v_id;

  insert into public.job_true_up_audit (true_up_id, job_id, action, actor_id, after)
  values (v_id, p_job_id, 'approve', auth.uid(), v_calc);

  return v_calc || jsonb_build_object('snapshot_id', v_snap, 'status', v_status);
exception
  when unique_violation then
    raise exception 'This true-up is already approved.';
end;
$$;

create or replace function public.refresh_true_up_collection(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.job_true_ups%rowtype;
  v_open numeric;
  v_collected boolean;
  v_unpaid int;
  v_status text;
begin
  perform public.fk_true_up_assert_staff();
  select * into v_row from public.job_true_ups where job_id = p_job_id for update;
  if not found or v_row.approved_at is null then
    return 'not_approved';
  end if;

  select coalesce(sum(public.invoice_open_ar_balance(i.id)), 0)
  into v_open
  from public.invoices i
  where i.job_id = p_job_id
    and i.status::text in ('sent', 'partial', 'paid');

  v_collected := v_row.collection_override or coalesce(v_open, 0) <= 0;

  if v_collected then
    update public.job_commission_ledger
      set status = 'payable', payable_at = coalesce(payable_at, now())
      where true_up_id = v_row.id
        and status = 'recorded';
  end if;

  select count(*) into v_unpaid
  from public.job_commission_ledger
  where true_up_id = v_row.id
    and status <> 'paid';

  v_status := case
    when v_unpaid = 0 then 'commission_paid'
    when v_collected then 'commission_payable'
    else 'approved'
  end;

  update public.job_true_ups
    set status = v_status, updated_at = now()
    where id = v_row.id;

  return v_status;
end;
$$;

create or replace function public.record_late_true_up_adjustment(
  p_job_id uuid,
  p_source_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.job_true_ups%rowtype;
  v_snap public.job_true_up_snapshots%rowtype;
  v_calc jsonb;
  v_approved bigint;
  v_revised bigint;
  v_delta bigint;
  v_paid bigint;
  v_key text;
  v_fingerprint text;
begin
  perform public.fk_true_up_assert_staff();
  if p_source_note is null or length(btrim(p_source_note)) = 0 then
    raise exception 'A reason is required.';
  end if;
  select * into v_row from public.job_true_ups where job_id = p_job_id for update;
  if not found or v_row.approved_at is null then
    raise exception 'Approve the true-up before recording a late-cost adjustment.';
  end if;
  select * into v_snap
  from public.job_true_up_snapshots
  where true_up_id = v_row.id
  order by version desc
  limit 1;

  v_calc := public.job_true_up_calculate(p_job_id);
  v_approved := coalesce((v_snap.payload->>'commission_cents')::bigint, 0);
  v_revised := coalesce((v_calc->>'commission_cents')::bigint, 0);
  select coalesce(sum(amount_cents), 0) into v_delta
  from public.job_commission_ledger
  where true_up_id = v_row.id and kind = 'adjustment';
  -- Target ledger = revised commission. Existing earned + adjustments should move by the gap.
  v_delta := v_revised - (v_approved + v_delta);
  if v_delta = 0 then
    return jsonb_build_object('adjustment_cents', 0, 'timing', 'none');
  end if;

  v_fingerprint := v_revised::text || ':' || coalesce(v_calc->>'actual_direct_cents', 'na') || ':' || coalesce(v_calc->>'actual_revenue_cents', 'na');
  v_key := 'adjustment:' || v_row.id::text || ':' || v_fingerprint;

  select coalesce(sum(l.amount_cents), 0) into v_paid
  from public.job_commission_payment_lines pl
  join public.job_commission_ledger l on l.id = pl.ledger_id
  where l.true_up_id = v_row.id;

  insert into public.job_commission_ledger (
    salesperson_id, job_id, true_up_id, snapshot_id, snapshot_version,
    kind, amount_cents, status, earned_at, payable_at, source_note, revised_payload, idempotency_key
  ) values (
    v_row.salesperson_id, p_job_id, v_row.id, v_snap.id, v_snap.version,
    'adjustment', v_delta,
    case when v_paid > 0 or v_row.collection_override or coalesce((v_calc->>'open_balance_cents')::bigint, 0) <= 0
      then 'payable' else 'recorded' end,
    now(),
    case when v_paid > 0 or v_row.collection_override or coalesce((v_calc->>'open_balance_cents')::bigint, 0) <= 0
      then now() else null end,
    btrim(p_source_note),
    v_calc,
    v_key
  );

  insert into public.job_true_up_audit (true_up_id, job_id, action, reason, actor_id, after)
  values (
    v_row.id, p_job_id, 'late_adjustment', btrim(p_source_note), auth.uid(),
    jsonb_build_object('adjustment_cents', v_delta, 'revised_commission_cents', v_revised, 'approved_commission_cents', v_approved)
  );

  perform public.refresh_true_up_collection(p_job_id);

  return jsonb_build_object(
    'adjustment_cents', v_delta,
    'revised_commission_cents', v_revised,
    'timing', case when v_paid > 0 then 'carry_forward' else 'before_payment' end
  );
exception
  when unique_violation then
    raise exception 'That late-cost adjustment is already recorded.';
end;
$$;

create or replace function public.set_true_up_collection_override(
  p_job_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.fk_true_up_assert_admin();
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required.';
  end if;
  v_id := public.ensure_job_true_up(p_job_id);
  update public.job_true_ups
    set collection_override = true,
        collection_override_reason = btrim(p_reason),
        collection_override_by = auth.uid(),
        collection_override_at = now(),
        updated_at = now()
    where id = v_id;
  insert into public.job_true_up_audit (true_up_id, job_id, action, reason, actor_id)
  values (v_id, p_job_id, 'collection_override', btrim(p_reason), auth.uid());
  if (select approved_at from public.job_true_ups where id = v_id) is not null then
    perform public.refresh_true_up_collection(p_job_id);
  end if;
end;
$$;

create or replace function public.set_true_up_commission_override(
  p_job_id uuid,
  p_field text,
  p_value bigint,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.fk_true_up_assert_admin();
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required.';
  end if;
  if p_field not in ('gp', 'rate', 'amount', 'zero_revenue') then
    raise exception 'Unknown override.';
  end if;
  v_id := public.ensure_job_true_up(p_job_id);
  if p_field = 'gp' then
    update public.job_true_ups
      set gp_override_cents = p_value, gp_override_reason = btrim(p_reason),
          gp_override_by = auth.uid(), gp_override_at = now(), updated_at = now()
      where id = v_id;
  elsif p_field = 'rate' then
    update public.job_true_ups
      set rate_override_bps = p_value::int, rate_override_reason = btrim(p_reason),
          rate_override_by = auth.uid(), rate_override_at = now(), updated_at = now()
      where id = v_id;
  elsif p_field = 'amount' then
    update public.job_true_ups
      set amount_override_cents = greatest(p_value, 0), amount_override_reason = btrim(p_reason),
          amount_override_by = auth.uid(), amount_override_at = now(), updated_at = now()
      where id = v_id;
  else
    update public.job_true_ups
      set zero_revenue_ack_reason = btrim(p_reason), zero_revenue_ack_by = auth.uid(),
          zero_revenue_ack_at = now(), updated_at = now()
      where id = v_id;
  end if;
  insert into public.job_true_up_audit (true_up_id, job_id, action, reason, actor_id, after)
  values (v_id, p_job_id, 'commission_override', btrim(p_reason), auth.uid(),
          jsonb_build_object('field', p_field, 'value', p_value));
end;
$$;

create or replace function public.set_true_up_salesperson(
  p_job_id uuid,
  p_salesperson_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.job_true_ups%rowtype;
  v_old uuid;
  v_amount bigint;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required.';
  end if;
  if public.my_role() not in ('admin', 'office') then
    raise exception 'Not authorized.';
  end if;
  perform public.ensure_job_true_up(p_job_id);
  select * into v_row from public.job_true_ups where job_id = p_job_id for update;
  v_old := v_row.salesperson_id;

  if v_row.approved_at is null then
    update public.job_true_ups
      set salesperson_id = p_salesperson_id, updated_at = now()
      where id = v_row.id;
  else
    if public.my_role() <> 'admin' then
      raise exception 'Salesperson is frozen after approval.';
    end if;
    -- Snapshot salesperson stays. Move unpaid ledger rows; claw back paid ones.
    update public.job_commission_ledger
      set salesperson_id = p_salesperson_id
      where true_up_id = v_row.id
        and status <> 'paid';
    select coalesce(sum(amount_cents), 0) into v_amount
    from public.job_commission_ledger
    where true_up_id = v_row.id
      and status = 'paid'
      and salesperson_id = v_old;
    if v_amount <> 0 and v_old is not null and v_old <> p_salesperson_id then
      insert into public.job_commission_ledger (
        salesperson_id, job_id, true_up_id, kind, amount_cents, status,
        earned_at, payable_at, source_note, idempotency_key
      ) values
        (v_old, p_job_id, v_row.id, 'adjustment', -v_amount, 'payable', now(), now(),
         'Salesperson correction after payment', 'xfer-out:' || v_row.id::text || ':' || p_salesperson_id::text),
        (p_salesperson_id, p_job_id, v_row.id, 'adjustment', v_amount, 'payable', now(), now(),
         'Salesperson correction after payment', 'xfer-in:' || v_row.id::text || ':' || p_salesperson_id::text);
    end if;
  end if;

  insert into public.job_true_up_audit (true_up_id, job_id, action, reason, actor_id, before, after)
  values (
    v_row.id, p_job_id, 'salesperson', btrim(p_reason), auth.uid(),
    jsonb_build_object('salesperson_id', v_old),
    jsonb_build_object('salesperson_id', p_salesperson_id)
  );
exception
  when unique_violation then
    raise exception 'That salesperson correction is already recorded.';
end;
$$;

create or replace function public.mark_commission_lines_paid(
  p_salesperson_id uuid,
  p_ledger_ids uuid[],
  p_paid_on date,
  p_reference text,
  p_period_start date,
  p_period_end date,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_payment uuid;
  v_total bigint := 0;
  v_row record;
  v_n int;
begin
  perform public.fk_true_up_assert_staff();
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'A payment reference key is required.';
  end if;
  if p_ledger_ids is null or cardinality(p_ledger_ids) = 0 then
    raise exception 'Select at least one commission line.';
  end if;

  select id into v_existing
  from public.job_commission_payments
  where idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  perform 1
  from public.job_commission_ledger
  where id = any (p_ledger_ids)
  for update;

  select count(*) into v_n
  from public.job_commission_ledger
  where id = any (p_ledger_ids)
    and salesperson_id = p_salesperson_id
    and status = 'payable';
  if v_n <> cardinality(p_ledger_ids) then
    raise exception 'One of those lines is already paid or is not payable.';
  end if;

  select coalesce(sum(amount_cents), 0) into v_total
  from public.job_commission_ledger
  where id = any (p_ledger_ids);

  insert into public.job_commission_payments (
    salesperson_id, period_start, period_end, total_cents, paid_on, paid_by, reference, idempotency_key
  ) values (
    p_salesperson_id, p_period_start, p_period_end, v_total, coalesce(p_paid_on, current_date),
    auth.uid(), nullif(btrim(coalesce(p_reference, '')), ''), p_idempotency_key
  )
  returning id into v_payment;

  for v_row in
    select id, amount_cents
    from public.job_commission_ledger
    where id = any (p_ledger_ids)
  loop
    insert into public.job_commission_payment_lines (payment_id, ledger_id, amount_cents)
    values (v_payment, v_row.id, v_row.amount_cents);
    update public.job_commission_ledger
      set status = 'paid', paid_at = now()
      where id = v_row.id;
  end loop;

  -- Refresh each touched job. Partial line payments are not offered: the line is paid in full.
  perform public.refresh_true_up_collection(l.job_id)
  from public.job_commission_ledger l
  where l.id = any (p_ledger_ids);

  return v_payment;
exception
  when unique_violation then
    select id into v_existing
    from public.job_commission_payments
    where idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return v_existing;
    end if;
    raise exception 'That commission line is already paid.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Read models. Limits are clamped. Totals are separate from the page.
-- ---------------------------------------------------------------------------

create or replace function public.list_job_true_up_queue(
  p_bucket text,
  p_limit int,
  p_offset int
)
returns table (
  job_id uuid,
  job_title text,
  customer_name text,
  salesperson_id uuid,
  status text,
  completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.fk_true_up_assert_staff();
  if p_bucket = 'needs_true_up' then
    return query
      select j.id, j.title, c.full_name, c.assigned_to, 'needs_true_up'::text, j.completed_at
      from public.jobs j
      join public.customers c on c.id = j.customer_id
      where j.status::text = 'completed'
        and not exists (select 1 from public.job_true_ups t where t.job_id = j.id)
      order by j.completed_at desc nulls last, j.id
      limit v_limit offset v_offset;
  else
    return query
      select j.id, j.title, c.full_name, t.salesperson_id, t.status, j.completed_at
      from public.job_true_ups t
      join public.jobs j on j.id = t.job_id
      join public.customers c on c.id = j.customer_id
      where p_bucket = 'all' or t.status = p_bucket
      order by t.updated_at desc, j.id
      limit v_limit offset v_offset;
  end if;
end;
$$;

create or replace function public.count_job_true_up_queue(p_bucket text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  perform public.fk_true_up_assert_staff();
  if p_bucket = 'needs_true_up' then
    select count(*) into v_n
    from public.jobs j
    where j.status::text = 'completed'
      and not exists (select 1 from public.job_true_ups t where t.job_id = j.id);
  else
    select count(*) into v_n
    from public.job_true_ups t
    where p_bucket = 'all' or t.status = p_bucket;
  end if;
  return v_n;
end;
$$;

create or replace function public.job_true_up_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.fk_true_up_assert_staff();
  select jsonb_build_object(
    'needs_true_up', (select count(*) from public.jobs j where j.status::text = 'completed' and not exists (select 1 from public.job_true_ups t where t.job_id = j.id)),
    'missing_costs', (select count(*) from public.job_true_ups where status = 'missing_costs'),
    'ready_for_review', (select count(*) from public.job_true_ups where status = 'ready_for_review'),
    'commission_payable', (select count(*) from public.job_true_ups where status = 'commission_payable'),
    'commission_owed_cents', (
      select coalesce(sum(amount_cents), 0)
      from public.job_commission_ledger
      where status = 'payable'
    ),
    'commission_paid_cents', (
      select coalesce(sum(amount_cents), 0)
      from public.job_commission_ledger
      where status = 'paid'
    ),
    'jobs_under_35', (
      select count(*) from public.job_true_up_snapshots s
      where s.version = (
        select max(version) from public.job_true_up_snapshots s2 where s2.true_up_id = s.true_up_id
      )
      and coalesce((s.payload->>'actual_margin_hundredths')::bigint, 0) < 3500
      and (s.payload->>'actual_revenue_cents') is not null
    ),
    'jobs_35', (
      select count(*) from public.job_true_up_snapshots s
      where (s.payload->>'actual_margin_hundredths')::bigint >= 3500
        and (s.payload->>'actual_margin_hundredths')::bigint < 4000
        and s.version = (select max(version) from public.job_true_up_snapshots s2 where s2.true_up_id = s.true_up_id)
    ),
    'jobs_40', (
      select count(*) from public.job_true_up_snapshots s
      where (s.payload->>'actual_margin_hundredths')::bigint >= 4000
        and (s.payload->>'actual_margin_hundredths')::bigint < 4500
        and s.version = (select max(version) from public.job_true_up_snapshots s2 where s2.true_up_id = s.true_up_id)
    ),
    'jobs_45', (
      select count(*) from public.job_true_up_snapshots s
      where (s.payload->>'actual_margin_hundredths')::bigint >= 4500
        and (s.payload->>'actual_margin_hundredths')::bigint < 5000
        and s.version = (select max(version) from public.job_true_up_snapshots s2 where s2.true_up_id = s.true_up_id)
    ),
    'jobs_50', (
      select count(*) from public.job_true_up_snapshots s
      where (s.payload->>'actual_margin_hundredths')::bigint >= 5000
        and s.version = (select max(version) from public.job_true_up_snapshots s2 where s2.true_up_id = s.true_up_id)
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

create or replace function public.job_true_up_snapshots_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Approved true-up snapshots are immutable. Record an adjustment instead.';
end;
$$;

drop trigger if exists job_true_up_snapshots_no_update on public.job_true_up_snapshots;
create trigger job_true_up_snapshots_no_update
  before update or delete on public.job_true_up_snapshots
  for each row execute function public.job_true_up_snapshots_immutable();

-- ---------------------------------------------------------------------------
-- RLS. Direct writes are revoked. Functions above are the write path.
-- ---------------------------------------------------------------------------

alter table public.job_true_ups enable row level security;
alter table public.job_true_up_entries enable row level security;
alter table public.job_true_up_snapshots enable row level security;
alter table public.job_commission_ledger enable row level security;
alter table public.job_commission_payments enable row level security;
alter table public.job_commission_payment_lines enable row level security;
alter table public.job_true_up_audit enable row level security;

drop policy if exists job_true_ups_staff_read on public.job_true_ups;
create policy job_true_ups_staff_read on public.job_true_ups
  for select to authenticated
  using (public.is_staff());

drop policy if exists job_true_ups_salesman_read on public.job_true_ups;
create policy job_true_ups_salesman_read on public.job_true_ups
  for select to authenticated
  using (public.my_role() = 'salesman' and salesperson_id = auth.uid());

drop policy if exists job_true_up_entries_staff_read on public.job_true_up_entries;
create policy job_true_up_entries_staff_read on public.job_true_up_entries
  for select to authenticated
  using (public.is_staff());

drop policy if exists job_true_up_snapshots_staff_read on public.job_true_up_snapshots;
create policy job_true_up_snapshots_staff_read on public.job_true_up_snapshots
  for select to authenticated
  using (public.is_staff());

drop policy if exists job_true_up_snapshots_salesman_read on public.job_true_up_snapshots;
create policy job_true_up_snapshots_salesman_read on public.job_true_up_snapshots
  for select to authenticated
  using (public.my_role() = 'salesman' and salesperson_id = auth.uid());

drop policy if exists job_commission_ledger_staff_read on public.job_commission_ledger;
create policy job_commission_ledger_staff_read on public.job_commission_ledger
  for select to authenticated
  using (public.is_staff());

drop policy if exists job_commission_ledger_salesman_read on public.job_commission_ledger;
create policy job_commission_ledger_salesman_read on public.job_commission_ledger
  for select to authenticated
  using (public.my_role() = 'salesman' and salesperson_id = auth.uid());

drop policy if exists job_commission_payments_staff_read on public.job_commission_payments;
create policy job_commission_payments_staff_read on public.job_commission_payments
  for select to authenticated
  using (public.is_staff());

drop policy if exists job_commission_payments_salesman_read on public.job_commission_payments;
create policy job_commission_payments_salesman_read on public.job_commission_payments
  for select to authenticated
  using (public.my_role() = 'salesman' and salesperson_id = auth.uid());

drop policy if exists job_commission_payment_lines_staff_read on public.job_commission_payment_lines;
create policy job_commission_payment_lines_staff_read on public.job_commission_payment_lines
  for select to authenticated
  using (public.is_staff());

drop policy if exists job_commission_payment_lines_salesman_read on public.job_commission_payment_lines;
create policy job_commission_payment_lines_salesman_read on public.job_commission_payment_lines
  for select to authenticated
  using (
    public.my_role() = 'salesman'
    and exists (
      select 1 from public.job_commission_payments p
      where p.id = payment_id and p.salesperson_id = auth.uid()
    )
  );

drop policy if exists job_true_up_audit_staff_read on public.job_true_up_audit;
create policy job_true_up_audit_staff_read on public.job_true_up_audit
  for select to authenticated
  using (public.is_staff());

revoke all on public.job_true_ups from public, anon, authenticated;
revoke all on public.job_true_up_entries from public, anon, authenticated;
revoke all on public.job_true_up_snapshots from public, anon, authenticated;
revoke all on public.job_commission_ledger from public, anon, authenticated;
revoke all on public.job_commission_payments from public, anon, authenticated;
revoke all on public.job_commission_payment_lines from public, anon, authenticated;
revoke all on public.job_true_up_audit from public, anon, authenticated;

grant select on public.job_true_ups to authenticated;
grant select on public.job_true_up_entries to authenticated;
grant select on public.job_true_up_snapshots to authenticated;
grant select on public.job_commission_ledger to authenticated;
grant select on public.job_commission_payments to authenticated;
grant select on public.job_commission_payment_lines to authenticated;
grant select on public.job_true_up_audit to authenticated;

revoke all on function public.fk_true_up_cents(numeric) from public, anon;
revoke all on function public.fk_commission_rate_bps(bigint, bigint) from public, anon;
revoke all on function public.fk_commission_amount_cents(bigint, bigint) from public, anon;
revoke all on function public.fk_margin_hundredths(bigint, bigint) from public, anon;
revoke all on function public.fk_true_up_assert_staff() from public, anon, authenticated;
revoke all on function public.fk_true_up_assert_admin() from public, anon, authenticated;
revoke all on function public.job_true_up_calculate(uuid) from public, anon;
revoke all on function public.ensure_job_true_up(uuid) from public, anon;
revoke all on function public.record_true_up_entry(uuid, text, text, bigint, text, text) from public, anon;
revoke all on function public.approve_job_true_up(uuid) from public, anon;
revoke all on function public.refresh_true_up_collection(uuid) from public, anon;
revoke all on function public.record_late_true_up_adjustment(uuid, text) from public, anon;
revoke all on function public.set_true_up_collection_override(uuid, text) from public, anon;
revoke all on function public.set_true_up_commission_override(uuid, text, bigint, text) from public, anon;
revoke all on function public.set_true_up_salesperson(uuid, uuid, text) from public, anon;
revoke all on function public.mark_commission_lines_paid(uuid, uuid[], date, text, date, date, text) from public, anon;
revoke all on function public.list_job_true_up_queue(text, int, int) from public, anon;
revoke all on function public.count_job_true_up_queue(text) from public, anon;
revoke all on function public.job_true_up_dashboard() from public, anon;

grant execute on function public.fk_commission_rate_bps(bigint, bigint) to authenticated;
grant execute on function public.fk_commission_amount_cents(bigint, bigint) to authenticated;
grant execute on function public.job_true_up_calculate(uuid) to authenticated;
grant execute on function public.ensure_job_true_up(uuid) to authenticated;
grant execute on function public.record_true_up_entry(uuid, text, text, bigint, text, text) to authenticated;
grant execute on function public.approve_job_true_up(uuid) to authenticated;
grant execute on function public.refresh_true_up_collection(uuid) to authenticated;
grant execute on function public.record_late_true_up_adjustment(uuid, text) to authenticated;
grant execute on function public.set_true_up_collection_override(uuid, text) to authenticated;
grant execute on function public.set_true_up_commission_override(uuid, text, bigint, text) to authenticated;
grant execute on function public.set_true_up_salesperson(uuid, uuid, text) to authenticated;
grant execute on function public.mark_commission_lines_paid(uuid, uuid[], date, text, date, date, text) to authenticated;
grant execute on function public.list_job_true_up_queue(text, int, int) to authenticated;
grant execute on function public.count_job_true_up_queue(text) to authenticated;
grant execute on function public.job_true_up_dashboard() to authenticated;

comment on table public.job_true_ups is
  'Operational job true-up. Not an accounting journal. Accounting remains off.';

-- ---------------------------------------------------------------------------
-- Reports. Totals cover the whole filter. The row list is one page.
-- ---------------------------------------------------------------------------

create or replace function public.job_commission_statement(
  p_salesperson uuid,
  p_from date,
  p_to date,
  p_filter text,
  p_limit int,
  p_offset int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.my_role();
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb;
  v_totals jsonb;
  v_count bigint;
begin
  if v_role = 'salesman' and p_salesperson is distinct from auth.uid() then
    raise exception 'Not authorized.';
  end if;
  if v_role not in ('admin', 'office', 'salesman') then
    raise exception 'Not authorized.';
  end if;

  with lines as (
    select
      l.job_id,
      l.salesperson_id,
      sum(l.amount_cents) filter (where l.kind = 'earned') as earned_cents,
      coalesce(sum(l.amount_cents) filter (where l.kind = 'adjustment'), 0) as adjustment_cents,
      coalesce(sum(l.amount_cents) filter (where l.status = 'paid'), 0) as paid_cents,
      coalesce(sum(l.amount_cents) filter (where l.status <> 'paid'), 0) as owed_cents,
      bool_or(l.status = 'payable') as any_payable,
      bool_or(l.status = 'paid') as any_paid
    from public.job_commission_ledger l
    join public.jobs j on j.id = l.job_id
    where l.salesperson_id = p_salesperson
      and (p_from is null or j.completed_at::date >= p_from)
      and (p_to is null or j.completed_at::date <= p_to)
    group by l.job_id, l.salesperson_id
  ),
  filtered as (
    select *
    from lines
    where p_filter = 'all'
       or p_filter is null
       or (p_filter = 'payable' and owed_cents <> 0)
       or (p_filter = 'paid' and paid_cents <> 0 and owed_cents = 0)
  ),
  detailed as (
    select
      f.*,
      j.title,
      j.completed_at,
      c.full_name as customer_name,
      s.payload
    from filtered f
    join public.jobs j on j.id = f.job_id
    join public.customers c on c.id = j.customer_id
    left join lateral (
      select payload
      from public.job_true_up_snapshots snap
      where snap.job_id = f.job_id
      order by snap.version desc
      limit 1
    ) s on true
  )
  select
    coalesce(jsonb_agg(to_jsonb(page_row)), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from (
    select *
    from detailed
    order by completed_at desc nulls last, job_id
    limit v_limit offset v_offset
  ) page_row;

  select jsonb_build_object(
    'jobs', count(*),
    'final_revenue_cents', coalesce(sum((payload->>'actual_revenue_cents')::bigint), 0),
    'actual_cost_cents', coalesce(sum((payload->>'actual_direct_cents')::bigint), 0),
    'gp_cents', coalesce(sum((payload->>'actual_gp_cents')::bigint), 0),
    'commission_earned_cents', coalesce(sum(earned_cents), 0),
    'adjustment_cents', coalesce(sum(adjustment_cents), 0),
    'paid_cents', coalesce(sum(paid_cents), 0),
    'owed_cents', coalesce(sum(owed_cents), 0)
  )
  into v_totals
  from (
    select
      f.earned_cents, f.adjustment_cents, f.paid_cents, f.owed_cents, s.payload
    from (
      select *
      from (
        select
          l.job_id,
          sum(l.amount_cents) filter (where l.kind = 'earned') as earned_cents,
          coalesce(sum(l.amount_cents) filter (where l.kind = 'adjustment'), 0) as adjustment_cents,
          coalesce(sum(l.amount_cents) filter (where l.status = 'paid'), 0) as paid_cents,
          coalesce(sum(l.amount_cents) filter (where l.status <> 'paid'), 0) as owed_cents
        from public.job_commission_ledger l
        join public.jobs j on j.id = l.job_id
        where l.salesperson_id = p_salesperson
          and (p_from is null or j.completed_at::date >= p_from)
          and (p_to is null or j.completed_at::date <= p_to)
        group by l.job_id
      ) grouped
      where p_filter = 'all'
         or p_filter is null
         or (p_filter = 'payable' and owed_cents <> 0)
         or (p_filter = 'paid' and paid_cents <> 0 and owed_cents = 0)
    ) f
    left join lateral (
      select payload from public.job_true_up_snapshots snap
      where snap.job_id = f.job_id
      order by version desc
      limit 1
    ) s on true
  ) all_rows;

  return jsonb_build_object(
    'totals', v_totals,
    'rows', v_rows,
    'total_rows', coalesce((v_totals->>'jobs')::bigint, 0)
  );
end;
$$;

create or replace function public.job_true_up_profitability(
  p_from date,
  p_to date,
  p_salesperson uuid,
  p_limit int,
  p_offset int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb;
  v_totals jsonb;
begin
  perform public.fk_true_up_assert_staff();
  with snaps as (
    select distinct on (s.job_id)
      s.job_id, s.salesperson_id, s.approved_at, s.payload, j.completed_at, j.title, c.full_name as customer_name, t.status
    from public.job_true_up_snapshots s
    join public.jobs j on j.id = s.job_id
    join public.customers c on c.id = j.customer_id
    join public.job_true_ups t on t.id = s.true_up_id
    where (p_from is null or j.completed_at::date >= p_from)
      and (p_to is null or j.completed_at::date <= p_to)
      and (p_salesperson is null or s.salesperson_id = p_salesperson)
    order by s.job_id, s.version desc
  )
  select coalesce(jsonb_agg(to_jsonb(page_row)), '[]'::jsonb)
  into v_rows
  from (
    select * from snaps
    order by completed_at desc nulls last, job_id
    limit v_limit offset v_offset
  ) page_row;

  with snaps as (
    select distinct on (s.job_id)
      s.payload, s.salesperson_id
    from public.job_true_up_snapshots s
    join public.jobs j on j.id = s.job_id
    where (p_from is null or j.completed_at::date >= p_from)
      and (p_to is null or j.completed_at::date <= p_to)
      and (p_salesperson is null or s.salesperson_id = p_salesperson)
    order by s.job_id, s.version desc
  )
  select jsonb_build_object(
    'jobs', count(*),
    'revenue_cents', coalesce(sum((payload->>'actual_revenue_cents')::bigint), 0),
    'estimated_cost_cents', coalesce(sum((payload->>'estimated_direct_cents')::bigint), 0),
    'actual_cost_cents', coalesce(sum((payload->>'actual_direct_cents')::bigint), 0),
    'estimated_gp_cents', coalesce(sum((payload->>'estimated_gp_cents')::bigint), 0),
    'actual_gp_cents', coalesce(sum((payload->>'actual_gp_cents')::bigint), 0),
    'commission_cents', coalesce(sum((payload->>'commission_cents')::bigint), 0)
  )
  into v_totals
  from snaps;

  return jsonb_build_object(
    'totals', v_totals || jsonb_build_object(
      'net_after_commission_cents',
      coalesce((v_totals->>'actual_gp_cents')::bigint, 0) - coalesce((v_totals->>'commission_cents')::bigint, 0)
    ),
    'rows', v_rows,
    'total_rows', coalesce((v_totals->>'jobs')::bigint, 0)
  );
end;
$$;

create or replace function public.job_true_up_performance(
  p_from date,
  p_to date,
  p_limit int,
  p_offset int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb;
  v_count bigint;
begin
  perform public.fk_true_up_assert_staff();
  with snaps as (
    select distinct on (s.job_id)
      s.job_id, s.salesperson_id, s.payload, j.completed_at
    from public.job_true_up_snapshots s
    join public.jobs j on j.id = s.job_id
    where (p_from is null or j.completed_at::date >= p_from)
      and (p_to is null or j.completed_at::date <= p_to)
    order by s.job_id, s.version desc
  ),
  grouped as (
    select
      snaps.salesperson_id,
      p.full_name,
      count(*) as jobs,
      coalesce(sum((snaps.payload->>'actual_revenue_cents')::bigint), 0) as revenue_cents,
      coalesce(sum((snaps.payload->>'actual_gp_cents')::bigint), 0) as gp_cents,
      coalesce(sum((snaps.payload->>'commission_cents')::bigint), 0) as commission_cents,
      count(*) filter (where coalesce((snaps.payload->>'actual_margin_hundredths')::bigint, 0) < 3500) as under_35,
      count(*) filter (where coalesce((snaps.payload->>'actual_margin_hundredths')::bigint, 0) >= 5000) as at_50
    from snaps
    left join public.profiles p on p.id = snaps.salesperson_id
    group by snaps.salesperson_id, p.full_name
  )
  select count(*) into v_count from grouped;

  with snaps as (
    select distinct on (s.job_id)
      s.job_id, s.salesperson_id, s.payload
    from public.job_true_up_snapshots s
    join public.jobs j on j.id = s.job_id
    where (p_from is null or j.completed_at::date >= p_from)
      and (p_to is null or j.completed_at::date <= p_to)
    order by s.job_id, s.version desc
  ),
  grouped as (
    select
      snaps.salesperson_id,
      p.full_name,
      count(*) as jobs,
      coalesce(sum((snaps.payload->>'actual_revenue_cents')::bigint), 0) as revenue_cents,
      coalesce(sum((snaps.payload->>'actual_gp_cents')::bigint), 0) as gp_cents,
      coalesce(sum((snaps.payload->>'estimated_gp_cents')::bigint), 0) as estimated_gp_cents,
      coalesce(sum((snaps.payload->>'commission_cents')::bigint), 0) as commission_cents,
      count(*) filter (where coalesce((snaps.payload->>'actual_margin_hundredths')::bigint, 0) < 3500) as under_35,
      count(*) filter (where coalesce((snaps.payload->>'actual_margin_hundredths')::bigint, 0) >= 5000) as at_50
    from snaps
    left join public.profiles p on p.id = snaps.salesperson_id
    group by snaps.salesperson_id, p.full_name
  ),
  paid as (
    select salesperson_id,
      coalesce(sum(amount_cents) filter (where status = 'paid'), 0) as paid_cents,
      coalesce(sum(amount_cents) filter (where status = 'payable'), 0) as owed_cents
    from public.job_commission_ledger
    group by salesperson_id
  )
  select coalesce(jsonb_agg(to_jsonb(page_row)), '[]'::jsonb)
  into v_rows
  from (
    select g.*, coalesce(paid.paid_cents, 0) as paid_cents, coalesce(paid.owed_cents, 0) as owed_cents
    from grouped g
    left join paid on paid.salesperson_id = g.salesperson_id
    order by g.gp_cents desc, g.salesperson_id
    limit v_limit offset v_offset
  ) page_row;

  return jsonb_build_object('rows', v_rows, 'total_rows', v_count);
end;
$$;

revoke all on function public.job_true_up_profitability(date, date, uuid, int, int) from public, anon;
revoke all on function public.job_true_up_performance(date, date, int, int) from public, anon;
grant execute on function public.job_true_up_profitability(date, date, uuid, int, int) to authenticated;
grant execute on function public.job_true_up_performance(date, date, int, int) to authenticated;

revoke all on function public.job_commission_statement(uuid, date, date, text, int, int) from public, anon;
grant execute on function public.job_commission_statement(uuid, date, date, text, int, int) to authenticated;
