-- Phase I launch integrity.
-- 1) One active supplemental invoice per (estimate, approval snapshot).
-- 2) Blank/manual invoice request token (idempotency_key), unique when set.
-- 3) Boolean probe so a salesman can learn that a strong duplicate exists
--    without reading another salesperson's customer row.
--
-- Additive. Does NOT enable accounting.
-- Do NOT set posting_enabled.
-- DO NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.
-- Safe to re-run only when the preflight below returns zero collision groups.
--
-- READ-ONLY PREFLIGHT (run in the SQL editor BEFORE applying).
-- If either query returns rows, STOP. Do not delete, void, or merge invoices.
--
-- select estimate_id, approval_snapshot_id, count(*) as n
-- from public.invoices
-- where status <> 'void'
--   and commercial_kind = 'supplemental'
--   and estimate_id is not null
--   and approval_snapshot_id is not null
-- group by 1, 2
-- having count(*) > 1;
--
-- select idempotency_key, count(*) as n
-- from public.invoices
-- where idempotency_key is not null
-- group by 1
-- having count(*) > 1;

do $$
declare
  n int;
begin
  if to_regclass('public.invoices') is null then
    raise exception '0477_PRECHECK: invoices table missing.';
  end if;
  if to_regclass('public.accounting_settings') is not null then
    if exists (
      select 1
      from public.accounting_settings s
      where s.id = 1
        and (
          coalesce(s.posting_enabled, false)
          or coalesce(s.inventory_posting_enabled, false)
          or coalesce(s.ap_posting_enabled, false)
          or coalesce(s.installer_posting_enabled, false)
          or coalesce(s.books_of_record, false)
          or coalesce(s.opening_balances_entered, false)
          or coalesce(s.accountant_validated, false)
          or s.cutover_date is not null
        )
    ) then
      raise exception
        '0477_PRECHECK: accounting activation flags are not OFF. Aborting. No flags were changed.';
    end if;
  end if;

  select count(*) into n
  from (
    select estimate_id, approval_snapshot_id
    from public.invoices
    where status <> 'void'
      and commercial_kind = 'supplemental'
      and estimate_id is not null
      and approval_snapshot_id is not null
    group by 1, 2
    having count(*) > 1
  ) d;
  if n > 0 then
    raise exception
      '0477_PRECHECK: % supplemental groups already have more than one active invoice for the same estimate and approval snapshot. Do not apply. No invoice rows were changed.',
      n;
  end if;
end $$;

alter table public.invoices
  add column if not exists idempotency_key text;

create unique index if not exists invoices_idempotency_key_unique
  on public.invoices (idempotency_key)
  where idempotency_key is not null;

comment on index public.invoices_idempotency_key_unique is
  '0477: one blank/manual invoice per request token. A new form mount is a new token.';

create unique index if not exists invoices_one_active_supplemental_per_snapshot
  on public.invoices (estimate_id, approval_snapshot_id)
  where status <> 'void'
    and commercial_kind = 'supplemental'
    and estimate_id is not null
    and approval_snapshot_id is not null;

comment on index public.invoices_one_active_supplemental_per_snapshot is
  '0477: one active supplemental obligation per estimate approval snapshot. A later approved increase is a new snapshot. Voided supplementals are excluded.';

-- Existence only. Never returns a customer id, name, or owner.
create or replace function public.customer_strong_identifier_taken(
  p_email text,
  p_phone text
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_email text;
  v_phone text;
begin
  v_role := public.my_role();
  if v_role is null or v_role not in ('admin', 'office', 'sales_manager', 'salesman') then
    return false;
  end if;

  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone) = 11 and left(v_phone, 1) = '1' then
    v_phone := substring(v_phone from 2);
  end if;

  if v_email is null and length(v_phone) <> 10 then
    return false;
  end if;

  return exists (
    select 1
    from public.customers c
    where (
      v_email is not null
      and lower(btrim(coalesce(c.email, ''))) = v_email
    )
    or (
      length(v_phone) = 10
      and length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 10
      and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = v_phone
    )
  );
end;
$$;

revoke all on function public.customer_strong_identifier_taken(text, text) from public;
revoke all on function public.customer_strong_identifier_taken(text, text) from anon;
grant execute on function public.customer_strong_identifier_taken(text, text) to authenticated;

comment on function public.customer_strong_identifier_taken(text, text) is
  '0477: true when an exact email or 10-digit phone already exists. Returns no customer fields.';
