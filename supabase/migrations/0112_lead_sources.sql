-- Floor King CRM — manageable "How did you hear about us?" tracking + ROI.
-- Turns the fixed lead_source enum into an editable list with per-source
-- drill-down sub-details, links customers to it (backfilling the legacy enum,
-- never touching null-source customers), and adds ad-spend for ROI reporting.
-- Run in Supabase: SQL Editor -> paste -> Run. Idempotent (safe to re-run).

-- 1) The manageable source list --------------------------------------------
create table if not exists public.lead_sources (
  id            uuid primary key default gen_random_uuid(),
  key           text unique,                     -- stable slug (maps the legacy enum)
  label         text not null,
  active        boolean not null default true,
  position      int not null default 0,
  detail_mode   text not null default 'none',    -- 'none' | 'options' | 'referrer'
  detail_label  text,                             -- e.g. "Which campaign / group?"
  detail_required boolean not null default false,
  created_at    timestamptz not null default now()
);

-- 2) Selectable sub-detail options per source (campaigns, groups, paid/organic)
create table if not exists public.lead_source_details (
  id         uuid primary key default gen_random_uuid(),
  source_id  uuid not null references public.lead_sources (id) on delete cascade,
  label      text not null,
  active     boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists lead_source_details_src_idx on public.lead_source_details (source_id, position);

-- 3) Ad spend per source / sub-detail / month (for ROI) ---------------------
create table if not exists public.lead_source_spend (
  id         uuid primary key default gen_random_uuid(),
  source_id  uuid not null references public.lead_sources (id) on delete cascade,
  detail_id  uuid references public.lead_source_details (id) on delete cascade,
  period     text not null,                       -- 'YYYY-MM'
  amount     numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One spend row per source+detail+month (detail null = source-wide).
create unique index if not exists lead_source_spend_uq
  on public.lead_source_spend (source_id, coalesce(detail_id, '00000000-0000-0000-0000-000000000000'::uuid), period);

-- 4) Customer columns -------------------------------------------------------
alter table public.customers
  add column if not exists source_id uuid references public.lead_sources (id),
  add column if not exists source_detail_id uuid references public.lead_source_details (id),
  add column if not exists source_detail_text text,
  add column if not exists referred_by_customer_id uuid references public.customers (id);
create index if not exists customers_source_idx on public.customers (source_id);

-- 5) RLS --------------------------------------------------------------------
alter table public.lead_sources enable row level security;
alter table public.lead_source_details enable row level security;
alter table public.lead_source_spend enable row level security;
do $$ begin
  -- Staff manage everything; any authenticated user may read the source lists
  -- (the customer form + inline prompt need them).
  drop policy if exists ls_staff on public.lead_sources;
  create policy ls_staff on public.lead_sources for all to authenticated using (public.is_staff()) with check (public.is_staff());
  drop policy if exists ls_read on public.lead_sources;
  create policy ls_read on public.lead_sources for select to authenticated using (true);

  drop policy if exists lsd_staff on public.lead_source_details;
  create policy lsd_staff on public.lead_source_details for all to authenticated using (public.is_staff()) with check (public.is_staff());
  drop policy if exists lsd_read on public.lead_source_details;
  create policy lsd_read on public.lead_source_details for select to authenticated using (true);

  drop policy if exists lss_staff on public.lead_source_spend;
  create policy lss_staff on public.lead_source_spend for all to authenticated using (public.is_staff()) with check (public.is_staff());
end $$;
grant select, insert, update, delete on public.lead_sources, public.lead_source_details, public.lead_source_spend to authenticated;

-- 6) Seed the source list (your list; keys map the legacy enum where it exists)
insert into public.lead_sources (key, label, position, detail_mode, detail_label, detail_required)
values
  ('google','Google',10,'options','Paid ad or organic search?',true),
  ('facebook','Facebook',20,'options','Campaign, group, or organic?',true),
  ('instagram','Instagram',30,'none',null,false),
  ('referral','Referral',40,'referrer','Who referred you?',true),
  ('repeat','Repeat customer',50,'none',null,false),
  ('yard_sign','Yard sign',60,'none',null,false),
  ('truck','Truck / vehicle',70,'none',null,false),
  ('home_show','Home show',80,'none',null,false),
  ('website','Website',90,'none',null,false),
  ('walk_in','Walk-in',100,'none',null,false),
  ('angi','Angi',110,'options','Paid or organic?',false),
  ('other','Other',120,'none',null,false)
on conflict (key) do nothing;

-- 7) Seed a few default sub-detail options (editable / expandable in Settings)
insert into public.lead_source_details (source_id, label, position)
select s.id, v.label, v.pos
from public.lead_sources s
join (values ('Paid ad',10),('Organic search',20)) v(label,pos) on s.key = 'google'
where not exists (select 1 from public.lead_source_details d where d.source_id = s.id);

insert into public.lead_source_details (source_id, label, position)
select s.id, v.label, v.pos
from public.lead_sources s
join (values ('Paid campaign',10),('Local group',20),('Organic page/post',30)) v(label,pos) on s.key = 'facebook'
where not exists (select 1 from public.lead_source_details d where d.source_id = s.id);

insert into public.lead_source_details (source_id, label, position)
select s.id, v.label, v.pos
from public.lead_sources s
join (values ('Paid',10),('Organic',20)) v(label,pos) on s.key = 'angi'
where not exists (select 1 from public.lead_source_details d where d.source_id = s.id);

-- 8) Backfill source_id from the legacy enum so existing customers KEEP their
--    source. Null-source customers are left null (never auto-filled).
update public.customers c
set source_id = ls.id
from public.lead_sources ls
where c.source_id is null and c.source is not null and ls.key = c.source::text;
