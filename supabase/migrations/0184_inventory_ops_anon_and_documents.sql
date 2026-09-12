-- P1: fail-closed inventory ops view + documents bucket path scoping.
-- products_inventory_ops / job_costing used `user_role(NULL) IS DISTINCT FROM
-- 'customer'` so anon/unprofiled JWT could see internal inventory fields.
-- documents_storage_rw (0179) is role-gated for the whole bucket; salesman could
-- list other customers' files. Path families stay usable for staff OCR/bills.
--
-- Does NOT change job-files (0182). Does NOT enable accounting.
-- Do NOT set posting_enabled
-- Safe to re-run. DO NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.

do $$
declare
  s record;
begin
  if to_regclass('public.accounting_settings') is null then
    raise exception 'P1_0184_PRECHECK: accounting_settings missing — apply 0161–0183 first.';
  end if;
  select * into s from public.accounting_settings where id = 1;
  if not found then
    raise exception 'P1_0184_PRECHECK: accounting_settings row id=1 missing.';
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
      'P1_0184_PRECHECK: accounting activation flags are not in the required OFF/NULL state. Aborting (no mutation of flags).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Explicit internal-role allowlist (anon + customer excluded)
-- ---------------------------------------------------------------------------
create or replace view public.products_inventory_ops as
select
  id, name, category, unit, sku, manufacturer, style, color,
  supplier, supplier_id, notes, active, track_stock, on_hand, on_order, reorder_point,
  bin_location, stock_kind, reserved, clearance,
  last_movement_at, created_at, updated_at
from public.products
where auth.uid() is not null
  and public.user_role(auth.uid())::text in (
    'admin', 'office', 'warehouse', 'sales_manager', 'scheduler', 'salesman', 'crew'
  );

comment on view public.products_inventory_ops is
  'P1/0184: warehouse/staff ops catalog. Authenticated internal roles only. Omits material_rate, labor_rate, clearance_price, avg_unit_cost, inventory_carrying_value.';

revoke all on public.products_inventory_ops from public, anon;
grant select on public.products_inventory_ops to authenticated;

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
where auth.uid() is not null
  and public.user_role(auth.uid())::text in (
    'admin', 'office', 'warehouse', 'sales_manager', 'scheduler', 'salesman', 'crew'
  );

grant select on public.job_costing to authenticated;
revoke all on public.job_costing from public, anon;

-- ---------------------------------------------------------------------------
-- 2) Documents storage path helpers
-- ---------------------------------------------------------------------------
create or replace function public.documents_storage_first_folder(object_name text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select case
    when object_name is null then null
    when position('..' in object_name) > 0 then null
    when position('/' in object_name) < 2 then null
    else split_part(object_name, '/', 1)
  end;
$$;

revoke all on function public.documents_storage_first_folder(text) from public, anon;
grant execute on function public.documents_storage_first_folder(text) to authenticated;

create or replace function public.documents_storage_uuid_folder(object_name text)
returns uuid
language sql
immutable
strict
set search_path = public
as $$
  select case
    when public.documents_storage_first_folder(object_name)
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

revoke all on function public.documents_storage_uuid_folder(text) from public, anon;
grant execute on function public.documents_storage_uuid_folder(text) to authenticated;

create or replace function public.can_access_documents_object(object_name text, p_write boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager', 'scheduler')
      or (
        public.user_role(auth.uid())::text = 'salesman'
        and (
          (
            public.documents_storage_first_folder(object_name) = 'customer'
            and public.mine_customer(public.documents_storage_uuid_folder(
              substr(object_name, length('customer/') + 1)
            ))
          )
          or (
            public.documents_storage_first_folder(object_name) = 'jobs'
            and public.mine_job(public.documents_storage_uuid_folder(
              substr(object_name, length('jobs/') + 1)
            ))
          )
          or exists (
            select 1
            from public.purchase_orders po
            where po.id = public.documents_storage_uuid_folder(object_name)
              and po.customer_id is not null
              and public.mine_customer(po.customer_id)
          )
        )
      )
    );
$$;

revoke all on function public.can_access_documents_object(text, boolean) from public, anon;
grant execute on function public.can_access_documents_object(text, boolean) to authenticated;

create or replace function public.can_read_documents_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_documents_object(object_name, false);
$$;

create or replace function public.can_write_documents_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_documents_object(object_name, true);
$$;

revoke all on function public.can_read_documents_object(text) from public, anon;
grant execute on function public.can_read_documents_object(text) to authenticated;
revoke all on function public.can_write_documents_object(text) from public, anon;
grant execute on function public.can_write_documents_object(text) to authenticated;

drop policy if exists documents_storage_rw on storage.objects;
drop policy if exists documents_storage_select on storage.objects;
drop policy if exists documents_storage_insert on storage.objects;
drop policy if exists documents_storage_update on storage.objects;
drop policy if exists documents_storage_delete on storage.objects;

create policy documents_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      public.can_read_documents_object(name)
      or (
        public.user_role(auth.uid())::text = 'salesman'
        and public.documents_storage_first_folder(name) = 'notes'
        and owner = auth.uid()
      )
    )
  );

create policy documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (
      public.can_write_documents_object(name)
      or (
        public.user_role(auth.uid())::text = 'salesman'
        and public.documents_storage_first_folder(name) = 'notes'
      )
    )
  );

create policy documents_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and (
      public.can_write_documents_object(name)
      or (
        public.user_role(auth.uid())::text = 'salesman'
        and public.documents_storage_first_folder(name) = 'notes'
        and owner = auth.uid()
      )
    )
  )
  with check (
    bucket_id = 'documents'
    and (
      public.can_write_documents_object(name)
      or (
        public.user_role(auth.uid())::text = 'salesman'
        and public.documents_storage_first_folder(name) = 'notes'
        and owner = auth.uid()
      )
    )
  );

create policy documents_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (
      public.can_write_documents_object(name)
      or (
        public.user_role(auth.uid())::text = 'salesman'
        and public.documents_storage_first_folder(name) = 'notes'
        and owner = auth.uid()
      )
    )
  );

do $$
declare
  s record;
begin
  select * into s from public.accounting_settings where id = 1;
  if coalesce(s.posting_enabled, false)
     or coalesce(s.books_of_record, false)
     or s.cutover_date is not null then
    raise exception 'P1_0184_POSTCHECK: accounting flags must remain OFF/NULL.';
  end if;
end $$;
