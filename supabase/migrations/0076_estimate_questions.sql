-- Floor King CRM — data-driven estimate questionnaire
-- Run in Supabase: SQL Editor -> paste -> Run. Safe to re-run (idempotent).
-- One guided estimate builder, driven by editable questions. Each question's
-- `kind` decides how it's answered; `config` (jsonb) decides how the answer maps
-- into estimate line items (material / labor / note), so the flow + pricing are
-- managed from Settings with no code changes.

create table if not exists public.estimate_questions (
  id         uuid primary key default gen_random_uuid(),
  section    text not null default 'Carpet',
  label      text not null,
  help       text,
  kind       text not null default 'yesno',   -- areas|product|yesno|number|choice|text
  config     jsonb not null default '{}'::jsonb,
  required   boolean not null default false,
  active     boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.estimate_questions enable row level security;
drop policy if exists eq_staff_all on public.estimate_questions;
create policy eq_staff_all on public.estimate_questions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists eq_read on public.estimate_questions;
create policy eq_read on public.estimate_questions
  for select to authenticated using (true);
grant select, insert, update, delete on public.estimate_questions to authenticated;

-- Seed the carpet questionnaire (only if that question isn't already there).
insert into public.estimate_questions (section, label, help, kind, config, required, position)
select v.section, v.label, v.help, v.kind, v.config::jsonb, v.required, v.position
from (values
  ('Carpet','Which areas are we doing? Add each room with its size.','Add every room getting carpet. This total drives the carpet, pad, and labor quantities.','areas','{}',true,10),
  ('Carpet','What carpet?','Pick the carpet from your catalog.','product','{"category":"carpet","ask_source":true}',true,20),
  ('Carpet','Include carpet installation?',null,'yesno','{"default":true,"emit":{"role":"labor","category":"labor","description":"Carpet installation","unit":"sqyd","per":"area","cost":6}}',false,25),
  ('Carpet','What padding?','Pick the main padding, and add additional padding for a specific area if needed.','product','{"category":"underlayment","ask_source":true,"allow_additional":true}',false,30),
  ('Carpet','Tear up the old floor?',null,'yesno','{"emit":{"role":"labor","category":"labor","description":"Tear-out (old floor)","unit":"sqft","per":"area","cost":0.5}}',false,50),
  ('Carpet','Haul away the old floor?',null,'yesno','{"emit":{"role":"labor","category":"labor","description":"Haul-away & disposal","unit":"sqft","per":"area","cost":0.25}}',false,60),
  ('Carpet','Placed on the curb instead of hauled?',null,'yesno','{"emit":{"role":"labor","category":"labor","description":"Old floor placed at curb","unit":"flat","per":"flat","cost":40}}',false,70),
  ('Carpet','How many steps? (choose the type)',null,'number','{"emit":{"role":"labor","category":"labor","description":"Carpet steps","unit":"step","per":"each","cost":18},"rate_options":[{"label":"Regular steps","cost":18},{"label":"Hollywood steps","cost":28}]}',false,80),
  ('Carpet','Doors to shave — how many?',null,'number','{"emit":{"role":"labor","category":"labor","description":"Door shaving / undercut","unit":"each","per":"each","cost":15}}',false,90),
  ('Carpet','Furniture — how heavy?',null,'choice','{"multi":false,"options":[{"label":"None"},{"label":"Light","emit":{"role":"labor","category":"labor","description":"Furniture moving (light)","unit":"flat","per":"flat","cost":50}},{"label":"Medium","emit":{"role":"labor","category":"labor","description":"Furniture moving (medium)","unit":"flat","per":"flat","cost":100}},{"label":"Heavy","emit":{"role":"labor","category":"labor","description":"Furniture moving (heavy)","unit":"flat","per":"flat","cost":200}}]}',false,100),
  ('Carpet','Transitions / thresholds — how many?',null,'number','{"emit":{"role":"material","category":"trim","description":"Transition / threshold","unit":"each","per":"each","cost":0}}',false,110),
  ('Carpet','Floor prep / leveling needed?',null,'yesno','{"emit":{"role":"labor","category":"labor","description":"Floor prep / leveling","unit":"sqft","per":"area","cost":0.5}}',false,120),
  ('Carpet','Anything else for the crew?',null,'text','{"note":true}',false,130)
) as v(section,label,help,kind,config,required,position)
where not exists (
  select 1 from public.estimate_questions w where w.label = v.label
);
