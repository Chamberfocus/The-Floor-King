-- Sell-from-stock vs special-order: tell each estimate material line where it
-- comes from, reserve stock for won jobs, and capture the cost of pulled stock
-- so job profit is accurate (not $0 like before).

-- 1) Per material line: 'stock' (we own it) | 'order' (PO to supplier) | null
--    (let the system auto-decide from availability when the job is prepped).
alter table public.estimate_line_items
  add column if not exists source text;

-- 2) Reserved (allocated to won jobs but not yet pulled). Available = on_hand - reserved.
alter table public.products
  add column if not exists reserved numeric not null default 0;

-- 3) Movement ledger: capture unit cost on pulls (for job profit) and tie a
--    movement to the specific estimate line it fulfills.
alter table public.stock_movements
  add column if not exists unit_cost numeric,
  add column if not exists line_id   uuid references public.estimate_line_items (id) on delete set null;

-- kind now also uses: reserve | release (on_hand unchanged; tracks allocation).
