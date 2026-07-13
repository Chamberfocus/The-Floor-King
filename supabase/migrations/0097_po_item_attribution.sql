-- Let a single purchase order carry material for MORE than one job/client (a
-- shared order): attribute each line to a specific job/customer + an optional
-- note, so the material is always trackable back to the right client even when
-- it's not the PO's primary customer. Idempotent.
alter table public.po_items
  add column if not exists for_job_id uuid references public.jobs(id) on delete set null,
  add column if not exists for_customer_id uuid references public.customers(id) on delete set null,
  add column if not exists note text;

create index if not exists po_items_for_job_idx on public.po_items (for_job_id);
create index if not exists po_items_for_customer_idx on public.po_items (for_customer_id);
