-- Floor King CRM — Accounting-grade PO numbers + real vendor entities.
-- Adds permanent sequential PO numbers (gapless, concurrency-safe, void-keeps-
-- number), turns vendors into full records, and safely links existing POs by
-- mapping their free-text names — WITHOUT touching any historical PO text,
-- amount, or date. Run in Supabase: SQL Editor -> paste -> Run. Idempotent.

-- 1) Vendors become full AP records ----------------------------------------
alter table public.suppliers
  add column if not exists contact_name   text,
  add column if not exists phone          text,
  add column if not exists email          text,
  add column if not exists address        text,
  add column if not exists account_number text,
  add column if not exists payment_terms  text,
  add column if not exists active         boolean not null default true;

-- 2) PO status gains Closed + Void (must be added before any use) -----------
alter type public.po_status add value if not exists 'closed';
alter type public.po_status add value if not exists 'void';

-- 3) Permanent PO number + a settable counter -------------------------------
alter table public.purchase_orders
  add column if not exists po_number int;
-- One number per PO, ever (nulls = un-issued drafts, allowed to repeat as null).
create unique index if not exists purchase_orders_po_number_uq
  on public.purchase_orders (po_number) where po_number is not null;

create table if not exists public.po_counter (
  id           text primary key default 'default',
  next_number  int not null default 1001,
  updated_at   timestamptz not null default now()
);
insert into public.po_counter (id, next_number)
  values ('default', 1001) on conflict (id) do nothing;

alter table public.po_counter enable row level security;
drop policy if exists po_counter_staff on public.po_counter;
create policy po_counter_staff on public.po_counter
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.po_counter to authenticated;

-- Allocate the next number atomically. The UPDATE takes a row lock, so two
-- concurrent issues serialize here → always distinct, never duplicated. A number
-- is consumed only when this runs (i.e. on a real issue), so it never skips.
create or replace function public.next_po_number() returns int
language plpgsql as $$
declare n int;
begin
  update public.po_counter
     set next_number = next_number + 1, updated_at = now()
   where id = 'default'
   returning next_number - 1 into n;
  return n;
end $$;

-- Stamp the permanent number the first time a PO is issued (Open / Received /
-- Closed), whether inserted issued or updated into an issued status. Never
-- re-stamps (permanence); Void keeps whatever number it already had.
create or replace function public.stamp_po_number() returns trigger
language plpgsql as $$
begin
  -- Compare as text, not as enum literals: this trigger fires during the
  -- vendor-linking backfill below, and 'closed'/'void' were only just added to
  -- the enum in this same migration. Postgres forbids resolving a not-yet-
  -- committed enum value, so casting NEW.status to text keeps the check safe
  -- (and it still matches the issued statuses exactly).
  if NEW.po_number is null
     and NEW.status::text in ('ordered','received','closed') then
    NEW.po_number := public.next_po_number();
  end if;
  return NEW;
end $$;

drop trigger if exists purchase_orders_stamp_number on public.purchase_orders;
create trigger purchase_orders_stamp_number
  before insert or update on public.purchase_orders
  for each row execute function public.stamp_po_number();

-- 4) Vendor migration — create the approved records ------------------------
insert into public.suppliers (name, kind)
select v.name, v.kind
from (values
  ('Southwind','manufacturer'),
  ('Mohawk','manufacturer'),
  ('Dreamweaver','manufacturer'),
  ('Titan','manufacturer'),
  ('Phenix','manufacturer'),
  ('Congoleum','manufacturer'),
  ('All Surfaces','distributor'),
  ('OVF','distributor')
) as v(name, kind)
where not exists (
  select 1 from public.suppliers s where lower(trim(s.name)) = lower(v.name)
);

-- Link existing POs by SETTING supplier_id only (was null). Never alters the
-- historical free-text name, amount, or date. Exact-name matches first…
update public.purchase_orders po
   set supplier_id = s.id
  from public.suppliers s
 where po.supplier_id is null
   and po.supplier is not null
   and lower(trim(po.supplier)) = lower(trim(s.name));

-- …then the approved spelling merges (both spellings → one record).
update public.purchase_orders po
   set supplier_id = s.id
  from public.suppliers s
 where po.supplier_id is null and s.name = 'All Surfaces'
   and lower(trim(po.supplier)) in ('all surface', 'all surfaces');

update public.purchase_orders po
   set supplier_id = s.id
  from public.suppliers s
 where po.supplier_id is null and s.name = 'Congoleum'
   and lower(trim(po.supplier)) in ('congoluem', 'congoleum');

-- Keep source_type consistent with the linked vendor's kind where it's unset.
update public.purchase_orders po
   set source_type = s.kind
  from public.suppliers s
 where po.source_type is null and po.supplier_id = s.id;

-- "Special order" and blank vendors are intentionally left unlinked (they are
-- not real vendors). Their POs keep their text exactly as-is.
