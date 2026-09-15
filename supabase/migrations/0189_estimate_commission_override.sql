-- Floor King CRM — 0189 per-estimate salesperson commission override
--
-- WHY
-- Commission is an org default percent of pre-tax sale (business_settings
-- job_commission_pct) used only in profitability. Salespeople sometimes need
-- a different commission on one estimate. These columns store that override
-- (percent OR dollars) without changing customer selling price.
--
-- NULL / NULL = automatic org default.
-- commission_override_amount set = fixed dollars (wins).
-- commission_override_pct set = rate override ($ follows revenue).
--
-- Does NOT add columns to estimates_customer (portal must not see commission).
-- Does NOT enable accounting. Does NOT mutate production business data.
-- DO NOT APPLY TO PRODUCTION WITHOUT OWNER REVIEW.
--
-- OWNER applies manually. Agent must NOT apply to production.

-- ---------------------------------------------------------------------------
-- 0) Accounting safety precheck — refuse if flags flipped; never activate here.
-- ---------------------------------------------------------------------------
do $$
declare
  s record;
begin
  if to_regclass('public.estimates') is null then
    raise exception 'P0_0189_PRECHECK: public.estimates missing — apply 0003 first.';
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
        'P0_0189_PRECHECK: accounting activation flags are not in the required OFF/NULL state. Aborting (no mutation of flags).';
    end if;
  end if;
end $$;

alter table public.estimates
  add column if not exists commission_override_pct numeric,
  add column if not exists commission_override_amount numeric,
  add column if not exists commission_overridden_at timestamptz,
  add column if not exists commission_overridden_by uuid references auth.users (id) on delete set null;

comment on column public.estimates.commission_override_pct is
  'Manual salesperson commission % for this estimate. NULL = use business_settings.job_commission_pct.';
comment on column public.estimates.commission_override_amount is
  'Manual salesperson commission dollars for this estimate. When set, wins over percent. NULL = not a $ override.';
comment on column public.estimates.commission_overridden_at is
  'When the current manual commission override was last set. NULL when using org default.';
comment on column public.estimates.commission_overridden_by is
  'Auth user who last set the manual commission override.';

-- Internal-only. Do NOT project these on estimates_customer (0181 portal view).
-- Staff keep base-table SELECT; the customer view is an explicit column list.

do $$
begin
  if to_regclass('public.estimates_customer') is not null then
    -- Fail closed: the customer view must not expose the new columns.
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'estimates_customer'
        and column_name in (
          'commission_override_pct',
          'commission_override_amount',
          'commission_overridden_at',
          'commission_overridden_by'
        )
    ) then
      raise exception
        'P0_0189_POSTCHECK: estimates_customer leaked commission override columns.';
    end if;
  end if;
end $$;

-- Do NOT set posting_enabled
-- DOES NOT apply accounting activation.
