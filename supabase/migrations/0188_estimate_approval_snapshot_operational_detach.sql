-- Floor King CRM — 0188 estimate approval snapshot operational detach
--
-- WHY
-- estimate_approval_snapshots are append-only (0155). The live estimate_id
-- column currently references estimates(id) ON DELETE CASCADE, and the
-- immutable UPDATE trigger rejects any change to estimate_id /
-- approved_by_customer_id. Deleting an operational customer therefore
-- cascades into estimates and then into a blocked snapshot DELETE.
--
-- This migration keeps the snapshots (payload + version identity immutable)
-- while allowing the operational customer / estimate / job graph to be
-- removed. Historical identity is copied onto dedicated columns first.
--
-- DOES NOT:
--   delete snapshots
--   disable estimate_approval_snapshots_no_delete
--   disable estimate_approval_snapshots_immutable
--   use DISABLE TRIGGER / session_replication_role
--   enable accounting / posting flags
--   drop foreign keys without replacing them
--   wipe customers, catalog, staff, or warehouse configuration
--
-- Safe to re-run. DO NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.

do $$
declare
  s record;
begin
  if to_regclass('public.estimate_approval_snapshots') is null then
    raise exception 'P0_0188_PRECHECK: estimate_approval_snapshots missing — apply 0155 first.';
  end if;
  if to_regclass('public.estimates') is null then
    raise exception 'P0_0188_PRECHECK: estimates missing.';
  end if;
  if to_regclass('public.customers') is null then
    raise exception 'P0_0188_PRECHECK: customers missing.';
  end if;
  if to_regclass('public.accounting_settings') is not null then
    select * into s from public.accounting_settings where id = 1;
    if found and (
         coalesce(s.posting_enabled, false)
      or coalesce(s.inventory_posting_enabled, false)
      or coalesce(s.ap_posting_enabled, false)
      or coalesce(s.installer_posting_enabled, false)
      or coalesce(s.books_of_record, false)
      or coalesce(s.opening_balances_entered, false)
      or coalesce(s.accountant_validated, false)
      or s.cutover_date is not null
    ) then
      raise exception
        'P0_0188_PRECHECK: accounting activation flags are not in the required OFF/NULL state. Aborting (no mutation of flags).';
    end if;
  end if;
  if exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname = 'estimate_approval_snapshots'
      and t.tgname in (
        'estimate_approval_snapshots_no_delete',
        'estimate_approval_snapshots_immutable'
      )
      and t.tgenabled = 'D'
  ) then
    raise exception 'P0_0188_PRECHECK: snapshot triggers are DISABLED. Refusing to continue.';
  end if;
end $$;

-- Historical identity. Fill-once from the live operational rows / payload.
alter table public.estimate_approval_snapshots
  add column if not exists historical_estimate_id uuid,
  add column if not exists historical_customer_id uuid,
  add column if not exists historical_customer_name text;

comment on column public.estimate_approval_snapshots.historical_estimate_id is
  'Frozen estimate UUID at approval time. Survives operational estimate delete.';
comment on column public.estimate_approval_snapshots.historical_customer_id is
  'Frozen customer UUID at approval time. Not an operational CRM pointer.';
comment on column public.estimate_approval_snapshots.historical_customer_name is
  'Frozen customer display name at detach/backfill. Not searchable as a CRM customer.';

-- Allow operational FK detach (non-null → null) only. DELETE remains forbidden.
-- Payload / version / approval identity stay immutable.
create or replace function public.prevent_approval_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'estimate_approval_snapshots are append-only; delete is not allowed';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'estimate_approval_snapshots.id is immutable';
    end if;

    if new.estimate_id is distinct from old.estimate_id then
      if not (old.estimate_id is not null and new.estimate_id is null) then
        raise exception
          'estimate_approval_snapshots.estimate_id is immutable except operational detach to NULL';
      end if;
    end if;

    if new.approved_by_customer_id is distinct from old.approved_by_customer_id then
      if not (
        old.approved_by_customer_id is not null
        and new.approved_by_customer_id is null
      ) then
        raise exception
          'estimate_approval_snapshots.approved_by_customer_id is immutable except operational detach to NULL';
      end if;
    end if;

    if old.historical_estimate_id is not null
       and new.historical_estimate_id is distinct from old.historical_estimate_id then
      raise exception 'estimate_approval_snapshots.historical_estimate_id is immutable once set';
    end if;
    if old.historical_customer_id is not null
       and new.historical_customer_id is distinct from old.historical_customer_id then
      raise exception 'estimate_approval_snapshots.historical_customer_id is immutable once set';
    end if;
    if old.historical_customer_name is not null
       and new.historical_customer_name is distinct from old.historical_customer_name then
      raise exception 'estimate_approval_snapshots.historical_customer_name is immutable once set';
    end if;

    if new.version is distinct from old.version
       or new.payload is distinct from old.payload
       or new.approved_at is distinct from old.approved_at
       or new.approval_source is distinct from old.approval_source
       or new.accepted_option_id is distinct from old.accepted_option_id
       or new.approved_by_user_id is distinct from old.approved_by_user_id then
      raise exception 'estimate_approval_snapshots commercial payload is immutable';
    end if;
  end if;

  return new;
end;
$$;

-- Triggers keep the same names and remain ENABLED. Recreate only the function.
-- (0155 already attached these BEFORE UPDATE / BEFORE DELETE triggers.)

-- Backfill historical identity while live estimates/customers still exist.
update public.estimate_approval_snapshots as s
set
  historical_estimate_id = coalesce(
    s.historical_estimate_id,
    s.estimate_id,
    nullif(s.payload->>'estimate_id', '')::uuid
  ),
  historical_customer_id = coalesce(
    s.historical_customer_id,
    e.customer_id,
    s.approved_by_customer_id,
    nullif(s.payload->>'customer_id', '')::uuid
  ),
  historical_customer_name = coalesce(
    s.historical_customer_name,
    c.full_name
  )
from public.estimates as e
left join public.customers as c
  on c.id = e.customer_id
where s.estimate_id = e.id
  and (
    s.historical_estimate_id is null
    or s.historical_customer_id is null
    or s.historical_customer_name is null
  );

-- Live estimate_id may be cleared when the operational estimate is removed.
alter table public.estimate_approval_snapshots
  alter column estimate_id drop not null;

do $$
declare
  con name;
  def text;
begin
  select c.conname, pg_get_constraintdef(c.oid)
    into con, def
  from pg_constraint as c
  join pg_class as t on t.oid = c.conrelid
  join pg_class as ft on ft.oid = c.confrelid
  join pg_namespace as n on n.oid = t.relnamespace
  join pg_namespace as fn on fn.oid = ft.relnamespace
  where n.nspname = 'public'
    and t.relname = 'estimate_approval_snapshots'
    and fn.nspname = 'public'
    and ft.relname = 'estimates'
    and c.contype = 'f'
  order by c.conname
  limit 1;

  if con is not null and def ilike '%ON DELETE CASCADE%' then
    execute format(
      'alter table public.estimate_approval_snapshots drop constraint %I',
      con
    );
    con := null;
  end if;

  if con is null then
    alter table public.estimate_approval_snapshots
      add constraint estimate_approval_snapshots_estimate_id_fkey
      foreign key (estimate_id)
      references public.estimates (id)
      on delete set null;
  elsif def is not null
        and def not ilike '%ON DELETE SET NULL%' then
    raise exception
      'P0_0188: unexpected estimate_id FK definition: %',
      def;
  end if;
end $$;

create unique index if not exists
  estimate_approval_snapshots_historical_estimate_version_uidx
  on public.estimate_approval_snapshots (historical_estimate_id, version)
  where historical_estimate_id is not null;

comment on column public.estimate_approval_snapshots.estimate_id is
  'Live operational estimate pointer. Nullable after 0188 so immutable snapshots can detach when the estimate is removed. Frozen UUID is historical_estimate_id plus payload.estimate_id.';

do $$
declare
  s record;
  attnotnull boolean;
  deltype char;
  n_disabled int;
begin
  select a.attnotnull into attnotnull
  from pg_attribute as a
  join pg_class as c on c.oid = a.attrelid
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'estimate_approval_snapshots'
    and a.attname = 'estimate_id'
    and a.attnum > 0
    and not a.attisdropped;
  if attnotnull is not false then
    raise exception 'P0_0188_POSTCHECK: estimate_id is still NOT NULL.';
  end if;

  select c.confdeltype into deltype
  from pg_constraint as c
  join pg_class as t on t.oid = c.conrelid
  join pg_class as ft on ft.oid = c.confrelid
  join pg_namespace as n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'estimate_approval_snapshots'
    and ft.relname = 'estimates'
    and c.contype = 'f'
  limit 1;
  if deltype is distinct from 'n' then
    raise exception
      'P0_0188_POSTCHECK: estimate_id FK confdeltype is % (expected n = SET NULL).',
      deltype;
  end if;

  if to_regclass('public.accounting_settings') is not null then
    select * into s from public.accounting_settings where id = 1;
    if found and (
         coalesce(s.posting_enabled, true)
      or coalesce(s.books_of_record, true)
    ) then
      raise exception 'P0_0188_POSTCHECK: accounting flags changed.';
    end if;
  end if;

  select count(*) into n_disabled
  from pg_trigger as t
  join pg_class as c on c.oid = t.tgrelid
  join pg_namespace as ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relname = 'estimate_approval_snapshots'
    and t.tgname in (
      'estimate_approval_snapshots_no_delete',
      'estimate_approval_snapshots_immutable'
    )
    and t.tgenabled = 'D';
  if n_disabled <> 0 then
    raise exception 'P0_0188_POSTCHECK: snapshot triggers were disabled.';
  end if;

  if not exists (
    select 1
    from pg_trigger as t
    join pg_class as c on c.oid = t.tgrelid
    join pg_namespace as ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname = 'estimate_approval_snapshots'
      and t.tgname = 'estimate_approval_snapshots_no_delete'
      and t.tgenabled in ('O', 'A')
  ) then
    raise exception 'P0_0188_POSTCHECK: no-delete trigger missing or not enabled.';
  end if;
end $$;
