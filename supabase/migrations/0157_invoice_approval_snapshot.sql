-- Change-order invoice safety Phase 1:
-- link estimate-derived invoices to the approval snapshot they billed,
-- and tag commercial invoice kind (original / replacement / supplemental).
--
-- NO historical backfill — legacy invoices remain unlinked (NULL).

alter table public.invoices
  add column if not exists approval_snapshot_id uuid
    references public.estimate_approval_snapshots (id) on delete set null;

alter table public.invoices
  add column if not exists commercial_kind text;

-- original = first/full bill of an approved snapshot
-- replacement = reissue after voiding unpaid prior invoice(s)
-- supplemental = approved increase delta only
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_commercial_kind_check'
  ) then
    alter table public.invoices
      add constraint invoices_commercial_kind_check
      check (
        commercial_kind is null
        or commercial_kind in ('original', 'replacement', 'supplemental')
      );
  end if;
end $$;

create index if not exists invoices_approval_snapshot_idx
  on public.invoices (approval_snapshot_id)
  where approval_snapshot_id is not null;

create index if not exists invoices_estimate_active_idx
  on public.invoices (estimate_id)
  where estimate_id is not null and status <> 'void';
