-- Floor King CRM — Phase 15: customer documents + smart uploader storage
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.

create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete cascade,
  po_id       uuid references public.purchase_orders (id) on delete set null,
  uploaded_by uuid references auth.users (id) on delete set null,
  name        text not null,
  path        text not null,
  mime        text,
  kind        text not null default 'other',     -- order_confirmation | bill | other
  extracted   jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists documents_customer_idx on public.documents (customer_id, created_at desc);

alter table public.documents enable row level security;

-- Staff + sales roles can manage docs (salesman only for their own customers).
drop policy if exists documents_staff_all on public.documents;
create policy documents_staff_all on public.documents
  for all to authenticated
  using (public.is_staff() or public.my_role() in ('sales_manager', 'scheduler'))
  with check (public.is_staff() or public.my_role() in ('sales_manager', 'scheduler'));

drop policy if exists documents_salesman_own on public.documents;
create policy documents_salesman_own on public.documents
  for all to authenticated
  using (public.my_role() = 'salesman' and exists (
    select 1 from public.customers c
    where c.id = documents.customer_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())))
  with check (public.my_role() = 'salesman' and exists (
    select 1 from public.customers c
    where c.id = documents.customer_id
      and (c.assigned_to = auth.uid() or c.workflow_owner_id = auth.uid())));

grant select, insert, update, delete on public.documents to authenticated;

-- Private storage bucket for uploaded documents.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Any internal (non-customer) user can read/write the documents bucket.
drop policy if exists documents_storage_rw on storage.objects;
create policy documents_storage_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'documents' and public.my_role() <> 'customer')
  with check (bucket_id = 'documents' and public.my_role() <> 'customer');
