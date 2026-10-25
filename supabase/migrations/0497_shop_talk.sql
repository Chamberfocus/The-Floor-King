-- Shop talk — the in-house thread that replaces texting about a customer.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Existing internal notes stay "office": sales and the office only.
-- New shop messages are the shared thread for sales, the office, the
-- warehouse, and the installer on that customer. The customer never sees them.

alter table public.messages
  add column if not exists audience text not null default 'office';

alter table public.messages drop constraint if exists messages_audience_check;
alter table public.messages
  add constraint messages_audience_check
  check (audience in ('office', 'shop'));

comment on column public.messages.audience is
  'office = private to sales and the office. shop = the shared thread for that customer. Client messages are not shop talk.';

create index if not exists messages_shop_talk_idx
  on public.messages (created_at desc)
  where channel = 'internal' and audience = 'shop';

-- Who has opened a customer thread. Used only to mark what is new.
create table if not exists public.shop_talk_reads (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (user_id, customer_id)
);

alter table public.shop_talk_reads enable row level security;

drop policy if exists shop_talk_reads_own on public.shop_talk_reads;
create policy shop_talk_reads_own on public.shop_talk_reads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.shop_talk_reads to authenticated;

-- Warehouse reads and writes the shared thread only. Office notes and
-- customer-facing messages stay hidden.
drop policy if exists messages_warehouse_shop_read on public.messages;
create policy messages_warehouse_shop_read on public.messages
  for select to authenticated
  using (
    public.my_role() = 'warehouse'
    and channel = 'internal'
    and audience = 'shop'
  );

drop policy if exists messages_warehouse_shop_write on public.messages;
create policy messages_warehouse_shop_write on public.messages
  for insert to authenticated
  with check (
    public.my_role() = 'warehouse'
    and channel = 'internal'
    and audience = 'shop'
    and author_id = auth.uid()
  );

-- Installers see the shared thread for a customer they are on.
drop policy if exists messages_crew_shop_read on public.messages;
create policy messages_crew_shop_read on public.messages
  for select to authenticated
  using (
    public.my_role() = 'crew'
    and channel = 'internal'
    and audience = 'shop'
    and public.crew_sees_customer(customer_id)
  );

drop policy if exists messages_crew_shop_write on public.messages;
create policy messages_crew_shop_write on public.messages
  for insert to authenticated
  with check (
    public.my_role() = 'crew'
    and channel = 'internal'
    and audience = 'shop'
    and author_id = auth.uid()
    and public.crew_sees_customer(customer_id)
  );

-- Shop-wide notes (no job, no purchase order) are readable and postable by
-- the same people. A customer thread is still the normal place to write.
drop policy if exists work_notes_shop_board_read on public.work_notes;
create policy work_notes_shop_board_read on public.work_notes
  for select to authenticated
  using (
    job_id is null
    and po_id is null
    and public.my_role() in (
      'admin', 'office', 'sales_manager', 'salesman', 'scheduler', 'crew', 'warehouse'
    )
  );

drop policy if exists work_notes_shop_board_insert on public.work_notes;
create policy work_notes_shop_board_insert on public.work_notes
  for insert to authenticated
  with check (
    job_id is null
    and po_id is null
    and author_id = auth.uid()
    and public.my_role() in (
      'admin', 'office', 'sales_manager', 'salesman', 'scheduler', 'crew', 'warehouse'
    )
  );
