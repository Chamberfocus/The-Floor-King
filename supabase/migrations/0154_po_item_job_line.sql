-- Floor King — link PO items to operational job material lines (Step 4 / P8)
-- Safe to re-run. Does NOT backfill historical rows (ambiguous).
--
-- Arrival, coverage, and supplemental purchasing key off job_line_id.
-- Orphan historical po_items (job_line_id null) remain intact and never
-- silently rewrite; they simply do not satisfy per-line coverage.

alter table public.po_items
  add column if not exists job_line_id uuid references public.job_line_items (id) on delete set null;

create index if not exists po_items_job_line_idx
  on public.po_items (job_line_id)
  where job_line_id is not null;

comment on column public.po_items.job_line_id is
  'Operational job material line this PO item covers. Null on legacy/manual '
  'rows — those do not auto-satisfy job-line purchasing coverage.';
