-- P0: customer JWT must not SELECT internal cost / margin / profit columns.
-- RLS is row-only. Staff and customers share the `authenticated` role, so
-- column GRANTs would hide cost from the office too. Customer-safe views
-- are owner/definer + security_barrier, filtered by my_customer_id().
-- They are INTENTIONALLY NOT security_invoker: after dropping customer base
-- SELECT, invoker views would return zero rows. Isolation is the view WHERE
-- clause; my_customer_id() is SECURITY DEFINER and reads auth.uid() from the
-- caller JWT. Staff keep base-table SELECT. Portal UPDATE on estimates is
-- unchanged (0179). Safe to re-run. DOES NOT apply accounting activation.
-- Do NOT set posting_enabled
-- DO NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.

-- OWNER applies manually. Agent must NOT apply to production.

-- ---------------------------------------------------------------------------
-- 0) Accounting safety precheck — refuse if flags flipped; never activate here.
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  if to_regclass('public.accounting_settings') is null then
    raise exception 'P0_0181_PRECHECK: accounting_settings missing — apply 0161–0180 first.';
  end if;
  select * into s from public.accounting_settings where id = 1;
  if not found then
    raise exception 'P0_0181_PRECHECK: accounting_settings row id=1 missing.';
  end if;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.inventory_posting_enabled, false)
     or coalesce(s.ap_posting_enabled, false)
     or coalesce(s.installer_posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or coalesce(s.opening_balances_entered, false)
     or coalesce(s.accountant_validated, false)
     or s.cutover_date is not null then
    raise exception
      'P0_0181_PRECHECK: accounting activation flags are not in the required OFF/NULL state. Aborting (no mutation of flags).';
  end if;
end $$;

-- Fail-closed helper: anon must not execute my_customer_id().
revoke all on function public.my_customer_id() from anon;
grant execute on function public.my_customer_id() to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Customer-safe approval JSON — ALLOWLIST (canonical snapshot unchanged).
--    Unknown / future keys are dropped, not copied-then-deleted.
-- ---------------------------------------------------------------------------
create or replace function public.customer_safe_line_json(elem jsonb)
returns jsonb
language sql
immutable
security definer
set search_path = public
as $$
  select case
    when elem is null or elem = 'null'::jsonb then null
    else jsonb_build_object(
      'id', elem->'id',
      'position', elem->'position',
      'room', elem->'room',
      'description', elem->'description',
      'note', elem->'note',
      'line_type', elem->'line_type',
      'category', elem->'category',
      'sqft', elem->'sqft',
      'length_in', elem->'length_in',
      'width_in', elem->'width_in',
      'measure_unit', elem->'measure_unit',
      'material_rate', elem->'material_rate',
      'labor_rate', elem->'labor_rate',
      'installed_rate', elem->'installed_rate',
      'flat_amount', elem->'flat_amount',
      'waste_pct', elem->'waste_pct',
      'manufacturer', elem->'manufacturer',
      'style', elem->'style',
      'color', elem->'color',
      'item_no', elem->'item_no',
      'quantity', elem->'quantity',
      'unit', elem->'unit',
      'line_total', elem->'line_total'
    )
  end
$$;

revoke all on function public.customer_safe_line_json(jsonb)
  from public, anon, authenticated;
grant execute on function public.customer_safe_line_json(jsonb) to service_role;

create or replace function public.customer_safe_approval_payload(p jsonb)
returns jsonb
language sql
immutable
security definer
set search_path = public
as $$
  select case
    when p is null then null
    else jsonb_build_object(
      'schema_version', 1,
      'estimate_id', p->'estimate_id',
      'customer_id', p->'customer_id',
      'title', p->'title',
      'presentation', p->'presentation',
      'show_project_details', p->'show_project_details',
      'job_description', p->'job_description',
      'notes', null,
      'accepted_option_id', p->'accepted_option_id',
      'option', jsonb_build_object(
        'id', p->'option'->'id',
        'name', p->'option'->'name',
        'notes', null,
        'lines', coalesce((
          select jsonb_agg(
            public.customer_safe_line_json(elem)
            order by ord
          )
          from jsonb_array_elements(coalesce(p->'option'->'lines', '[]'::jsonb))
            with ordinality as t(elem, ord)
        ), '[]'::jsonb)
      ),
      'tax_rate', p->'tax_rate',
      'discount_kind', p->'discount_kind',
      'discount_value', p->'discount_value',
      'discount_amount', p->'discount_amount',
      'subtotal', p->'subtotal',
      'tax_amount', p->'tax_amount',
      'total', p->'total'
    )
  end
$$;

revoke all on function public.customer_safe_approval_payload(jsonb)
  from public, anon, authenticated;
grant execute on function public.customer_safe_approval_payload(jsonb) to service_role;

comment on function public.customer_safe_approval_payload(jsonb) is
  'P0/0181: ALLOWLIST customer projection of estimate_approval_snapshots.payload. Does not mutate stored snapshots. Unknown keys fail closed.';

-- ---------------------------------------------------------------------------
-- 2) Customer-safe views (definer + barrier). Isolation = my_customer_id().
--    DROP without CASCADE — these views are new; do not take down dependents.
-- ---------------------------------------------------------------------------
drop view if exists public.estimate_line_items_customer;
create view public.estimate_line_items_customer
with (security_barrier = true) as
select
  l.id,
  l.option_id,
  l.position,
  l.room,
  l.description,
  l.note,
  l.line_type,
  l.sqft,
  l.length_in,
  l.width_in,
  l.measure_unit,
  l.material_rate,
  l.labor_rate,
  l.installed_rate,
  l.flat_amount,
  l.waste_pct,
  l.manufacturer,
  l.style,
  l.color,
  l.item_no,
  l.quantity,
  l.unit,
  l.category,
  l.is_optional
from public.estimate_line_items l
where exists (
  select 1
  from public.estimate_options o
  join public.estimates e on e.id = o.estimate_id
  where o.id = l.option_id
    and e.customer_id = public.my_customer_id()
);

comment on view public.estimate_line_items_customer is
  'P0/0181: customer JWT SELECT. Sell rates only. Omits cost/margin, product_id, measurements, prep/order internals.';

drop view if exists public.estimate_options_customer;
create view public.estimate_options_customer
with (security_barrier = true) as
select
  o.id,
  o.estimate_id,
  o.name,
  o.position,
  o.created_at
from public.estimate_options o
join public.estimates e on e.id = o.estimate_id
where e.customer_id = public.my_customer_id();

comment on view public.estimate_options_customer is
  'P0/0181: customer JWT SELECT. Name/position only. Omits option.notes (staff copy).';

drop view if exists public.estimates_customer;
create view public.estimates_customer
with (security_barrier = true) as
select
  e.id,
  e.customer_id,
  e.title,
  e.status,
  e.presentation,
  e.show_project_details,
  e.tax_rate,
  e.discount_kind,
  e.discount_value,
  e.job_description,
  e.customer_response_note,
  e.valid_until,
  e.sent_at,
  e.viewed_at,
  e.accepted_option_id,
  e.recommended_option_id,
  e.approved_at,
  e.approval_source,
  e.approved_by_customer_id,
  e.current_approval_snapshot_id,
  e.approval_stale,
  e.service_address_id,
  e.created_at,
  e.updated_at
from public.estimates e
where e.customer_id = public.my_customer_id();

comment on view public.estimates_customer is
  'P0/0181: customer JWT SELECT. Omits target_margin, internal notes, created_by, migrated, staff approval actor.';

drop view if exists public.job_line_items_customer;
create view public.job_line_items_customer
with (security_barrier = true) as
select
  l.id,
  l.option_id,
  l.job_id,
  l.position,
  l.room,
  l.description,
  l.note,
  l.line_type,
  l.sqft,
  l.length_in,
  l.width_in,
  l.measure_unit,
  l.material_rate,
  l.labor_rate,
  l.installed_rate,
  l.flat_amount,
  l.waste_pct,
  l.manufacturer,
  l.style,
  l.color,
  l.item_no,
  l.quantity,
  l.unit,
  l.category,
  l.is_optional
from public.job_line_items l
where exists (
  select 1 from public.jobs j
  where j.id = l.job_id
    and j.customer_id = public.my_customer_id()
);

comment on view public.job_line_items_customer is
  'P0/0181: customer JWT work-order lines. Same sell-only projection as estimate lines.';

drop view if exists public.jobs_customer;
create view public.jobs_customer
with (security_barrier = true) as
select
  j.id,
  j.customer_id,
  j.estimate_id,
  j.option_id,
  j.title,
  j.status,
  j.scheduled_date,
  j.scheduled_end,
  j.arrival_window,
  j.site_street,
  j.site_city,
  j.site_state,
  j.site_zip,
  j.delivery_type,
  j.created_at,
  j.updated_at
from public.jobs j
where j.customer_id = public.my_customer_id();

comment on view public.jobs_customer is
  'P0/0181: customer JWT SELECT. Omits cost/closeout, assigned_to (internal profile UUID), warehouse internals.';

drop view if exists public.estimate_approval_snapshots_customer;
create view public.estimate_approval_snapshots_customer
with (security_barrier = true) as
select
  s.id,
  s.estimate_id,
  s.version,
  s.accepted_option_id,
  s.approved_at,
  s.approval_source,
  s.approved_by_customer_id,
  s.created_at,
  public.customer_safe_approval_payload(s.payload) as payload
from public.estimate_approval_snapshots s
where exists (
  select 1 from public.estimates e
  where e.id = s.estimate_id
    and e.customer_id = public.my_customer_id()
);

comment on view public.estimate_approval_snapshots_customer is
  'P0/0181: allowlisted snapshot projection. Canonical payload on the base table is unchanged.';

drop view if exists public.org_settings_customer;
create view public.org_settings_customer
with (security_barrier = true) as
select
  o.id,
  o.company_name,
  o.logo_url,
  o.primary_color,
  o.phone,
  o.email,
  o.address,
  o.website,
  o.financing_url,
  o.google_review_url,
  o.card_processing_url,
  o.quote_valid_days,
  o.freight_disclaimer,
  o.updated_at
from public.org_settings o;

comment on view public.org_settings_customer is
  'P0/0181: customer branding/terms. Omits freight_markup_pct and fuel_surcharge_pct.';

grant select on public.estimate_line_items_customer to authenticated;
grant select on public.estimate_options_customer to authenticated;
grant select on public.estimates_customer to authenticated;
grant select on public.jobs_customer to authenticated;
grant select on public.job_line_items_customer to authenticated;
grant select on public.estimate_approval_snapshots_customer to authenticated;
grant select on public.org_settings_customer to authenticated;

revoke all on public.estimate_line_items_customer from anon, public;
revoke all on public.estimate_options_customer from anon, public;
revoke all on public.estimates_customer from anon, public;
revoke all on public.jobs_customer from anon, public;
revoke all on public.job_line_items_customer from anon, public;
revoke all on public.estimate_approval_snapshots_customer from anon, public;
revoke all on public.org_settings_customer from anon, public;

-- ---------------------------------------------------------------------------
-- 3) Drop customer SELECT on cost-bearing / commercial base tables.
--    UPDATE policy on estimates is unchanged (0179 column trigger).
--    job_line_items never had a customer SELECT policy (default deny).
-- ---------------------------------------------------------------------------
drop policy if exists estimate_line_items_customer_read on public.estimate_line_items;
drop policy if exists estimate_options_customer_read on public.estimate_options;
drop policy if exists estimates_customer_read on public.estimates;
drop policy if exists jobs_customer_read on public.jobs;

-- Misnamed: mine_estimate() is salesman book ownership, not portal customer.
-- Keep that SELECT for salesmen on the canonical snapshot (internal payload).
drop policy if exists estimate_approval_snapshots_portal_select
  on public.estimate_approval_snapshots;
drop policy if exists estimate_approval_snapshots_salesman_select
  on public.estimate_approval_snapshots;
create policy estimate_approval_snapshots_salesman_select
  on public.estimate_approval_snapshots
  for select to authenticated
  using (public.mine_estimate(estimate_id));

-- ---------------------------------------------------------------------------
-- 4) org_settings: stop using (true). Staff keep full row; customers use view.
-- ---------------------------------------------------------------------------
drop policy if exists org_settings_read on public.org_settings;
create policy org_settings_internal_read on public.org_settings
  for select to authenticated
  using (coalesce(public.user_role(auth.uid())::text, '') is distinct from 'customer');

-- ---------------------------------------------------------------------------
-- 5) job_costing is security_invoker on jobs — customers currently inherit
--    jobs_customer_read. Exclude customer role. Staff RLS on jobs unchanged.
--    Non-customer roles still see only rows their jobs policies already allow.
-- ---------------------------------------------------------------------------
create or replace view public.job_costing
with (security_invoker = true) as
select
  j.id                                          as job_id,
  j.customer_id,
  j.title,
  j.status,
  j.closed_out_at,
  coalesce(j.estimated_material_cost, 0)        as est_material,
  coalesce(j.estimated_labor_cost, 0)           as est_labor,
  coalesce(j.estimated_material_cost, 0)
    + coalesce(j.estimated_labor_cost, 0)     as est_total,
  j.actual_material_cost,
  j.actual_labor_cost,
  j.actual_other_cost,
  case
    when j.actual_material_cost is null
     and j.actual_labor_cost is null
     and j.actual_other_cost is null then null
    else coalesce(j.actual_material_cost, 0)
       + coalesce(j.actual_labor_cost, 0)
       + coalesce(j.actual_other_cost, 0)
  end                                           as actual_total,
  (select coalesce(sum(i.cost_impact), 0) from public.job_issues i where i.job_id = j.id)
                                                as issue_cost,
  (select count(*)::int from public.job_issues i where i.job_id = j.id)
                                                as issue_count
from public.jobs j
where coalesce(public.user_role(auth.uid())::text, '') is distinct from 'customer';

grant select on public.job_costing to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Catalog ops view is owner/definer (warehouse has no products RLS).
--    0176 granted it to all authenticated, so a customer JWT could SELECT
--    supplier identifiers. Keep warehouse/staff access; exclude customers.
--    Does not add roles that previously lacked this view.
-- ---------------------------------------------------------------------------
create or replace view public.products_inventory_ops as
select
  id, name, category, unit, sku, manufacturer, style, color,
  supplier, supplier_id, notes, active, track_stock, on_hand, on_order, reorder_point,
  bin_location, stock_kind, reserved, clearance,
  last_movement_at, created_at, updated_at
from public.products
where coalesce(public.user_role(auth.uid())::text, '') is distinct from 'customer';

comment on view public.products_inventory_ops is
  'P0/0181: warehouse/staff ops catalog. Excludes customer JWT. Still omits material_rate, labor_rate, clearance_price, avg_unit_cost, inventory_carrying_value.';

grant select on public.products_inventory_ops to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Final accounting safety — still OFF (no flag writes)
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  select * into s from public.accounting_settings where id = 1;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or s.cutover_date is not null then
    raise exception 'P0_0181_POSTCHECK: accounting flags must remain OFF/NULL.';
  end if;
end $$;
