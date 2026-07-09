-- Floor King CRM — guided questionnaire upgrades.
-- Safe to re-run (idempotent). Paste into Supabase SQL editor → Run.

-- 1) Save & resume — one in-progress draft per customer -----------------------
create table if not exists public.estimate_drafts (
  customer_id        uuid primary key references public.customers (id) on delete cascade,
  service_address_id uuid,
  answers            jsonb not null default '{}'::jsonb,
  overrides          jsonb not null default '{}'::jsonb,
  step               int   not null default 0,
  updated_by         uuid,
  updated_at         timestamptz not null default now()
);
alter table public.estimate_drafts enable row level security;
drop policy if exists estimate_drafts_rw on public.estimate_drafts;
create policy estimate_drafts_rw on public.estimate_drafts
  for all to authenticated
  using (public.my_role() <> 'customer')
  with check (public.my_role() <> 'customer');
grant select, insert, update, delete on public.estimate_drafts to authenticated;

-- 2) Cartons — how many sq ft come in a box, per material line ----------------
alter table public.estimate_line_items
  add column if not exists sqft_per_box numeric;

-- 3) Demo step → allow multiple demo types, each with its own area ------------
update public.estimate_questions
  set config = config || '{"per_area": true}'::jsonb
  where kind = 'choice'
    and lower(label) like '%demo%'
    and lower(label) like '%type%';

-- 4) New high-value questions (hard surface) ---------------------------------
insert into public.estimate_questions (section, label, help, kind, config, required, position)
select v.section, v.label, v.help, v.kind, v.config::jsonb, v.required, v.position
from (values
  ('hardsurface', 'Quarter-round / shoe molding — linear feet?', 'Adds shoe molding material + install.', 'number',
   '{"emit":{"per":"each","cost":1.8,"role":"material","unit":"lnft","category":"trim","description":"Quarter-round / shoe molding"},"show_if":{"in":["Hard surface"],"key":"project_type"}}',
   false, 292),
  ('hardsurface', 'Toilets to pull & reset?', 'Common for tile/LVP baths.', 'number',
   '{"emit":{"per":"each","cost":75,"role":"labor","unit":"each","category":"labor","description":"Toilet pull & reset"},"show_if":{"in":["Hard surface"],"key":"project_type"}}',
   false, 312),
  ('hardsurface', 'Appliances to disconnect / move?', 'Fridge, stove, washer, etc.', 'number',
   '{"emit":{"per":"each","cost":40,"role":"labor","unit":"each","category":"labor","description":"Appliance disconnect / move"},"show_if":{"in":["Hard surface"],"key":"project_type"}}',
   false, 314)
) as v(section, label, help, kind, config, required, position)
where not exists (
  select 1 from public.estimate_questions e where e.label = v.label
);
