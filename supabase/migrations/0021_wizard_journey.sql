-- Floor King CRM — Phase 17: detailed estimate-wizard "journey"
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.
-- Adds sections (journey steps), multiple-choice options, and a required flag,
-- then seeds a deep, research-backed question bank (without duplicating yours).

-- 1) New columns ---------------------------------------------------------------
alter table public.wizard_questions
  add column if not exists section  text not null default 'Job details',
  add column if not exists options  jsonb,            -- choices => renders a dropdown
  add column if not exists required boolean not null default false;

-- 2) Re-file the original questions into the new journey sections ---------------
update public.wizard_questions set section = 'Add-ons & extras'        where kind = 'addon';
update public.wizard_questions set section = 'Existing floor & subfloor'
  where label in ('Existing floor type & condition?', 'Subfloor type & condition?', 'Any moisture concerns?');
update public.wizard_questions set section = 'The customer & project'
  where label = 'Preferred timeline / start date?';
update public.wizard_questions set section = 'Installation logistics'
  where label in ('Pets in the home?', 'Special access or parking notes?');

-- 3) Seed the deep question bank (each row added only if its label is new) -----
insert into public.wizard_questions (section, label, help, kind, input, options, default_amount, position, required)
select v.section, v.label, v.help, v.kind::public.wizard_question_kind,
       v.input::public.wizard_question_input, v.options, v.default_amount, v.position, v.required
from (values
  -- The customer & project
  ('The customer & project','What''s prompting the new floor?','Damage, remodel, selling the home, pets, or just time for an update?','detail','text',null::jsonb,null::numeric,100,true),
  ('The customer & project','Who are the decision-makers, and is everyone here today?',null,'detail','text',null::jsonb,null::numeric,110,false),
  ('The customer & project','Is this a primary home, rental, or flip?',null,'detail','text','["Primary residence","Rental property","Flip / resale","Commercial"]'::jsonb,null::numeric,120,false),
  ('The customer & project','What budget range are we working within?',null,'detail','text',null::jsonb,null::numeric,130,false),
  ('The customer & project','Are you getting other estimates?',null,'detail','yesno',null::jsonb,null::numeric,140,false),

  -- The space
  ('The space','Which rooms / areas are included?',null,'detail','text',null::jsonb,null::numeric,200,true),
  ('The space','Same flooring throughout, or different by area?',null,'detail','text','["Same throughout","Different by area"]'::jsonb,null::numeric,210,false),
  ('The space','Traffic level in these spaces?',null,'detail','text','["Light","Moderate","Heavy"]'::jsonb,null::numeric,220,false),

  -- Existing floor & subfloor
  ('Existing floor & subfloor','Condition of the existing floor?',null,'detail','text','["Good","Worn","Damaged","Failing"]'::jsonb,null::numeric,300,false),
  ('Existing floor & subfloor','Subfloor type?',null,'detail','text','["Concrete slab","Plywood / OSB","Going over existing floor","Unknown"]'::jsonb,null::numeric,310,false),
  ('Existing floor & subfloor','Is the subfloor flat & level?',null,'detail','text','["Looks level","Minor dips","Noticeable slope / dips","Not sure"]'::jsonb,null::numeric,320,false),
  ('Existing floor & subfloor','Any squeaks or soft / spongy spots?',null,'detail','yesno',null::jsonb,null::numeric,330,false),
  ('Existing floor & subfloor','Floor-height difference at doorways (transitions needed)?',null,'detail','text',null::jsonb,null::numeric,340,false),
  ('Existing floor & subfloor','Older home — any asbestos risk in existing vinyl/tile?','Sheet vinyl or tile from before ~1985 may contain asbestos — test before removal.','detail','yesno',null::jsonb,null::numeric,350,false),

  -- Product & style
  ('Product & style','Flooring type they''re leaning toward?',null,'detail','text','["Carpet","Hardwood","Laminate","Luxury vinyl (LVP/LVT)","Tile","Sheet vinyl","Undecided"]'::jsonb,null::numeric,400,false),
  ('Product & style','Color / tone direction?',null,'detail','text','["Light","Medium","Dark","Gray tones","Warm tones","Not sure"]'::jsonb,null::numeric,410,false),
  ('Product & style','Plank/tile size or carpet style preference?',null,'detail','text',null::jsonb,null::numeric,420,false),
  ('Product & style','Need scratch- or water-proof for pets/kids?',null,'detail','yesno',null::jsonb,null::numeric,430,false),
  ('Product & style','Samples taken or left with the customer?',null,'detail','yesno',null::jsonb,null::numeric,440,false),

  -- Installation logistics
  ('Installation logistics','Will the home be occupied during installation?',null,'detail','yesno',null::jsonb,null::numeric,500,false),
  ('Installation logistics','Who moves the furniture?',null,'detail','text','["We move it","Customer moves it","Mixed"]'::jsonb,null::numeric,510,false),
  ('Installation logistics','Appliances to disconnect or move?','Fridge, washer/dryer, stove, etc.','detail','text',null::jsonb,null::numeric,520,false),
  ('Installation logistics','Closets included in the work?',null,'detail','yesno',null::jsonb,null::numeric,530,false),
  ('Installation logistics','Preferred work days / hours?',null,'detail','text',null::jsonb,null::numeric,540,false),

  -- Add-ons & extras (priced line items)
  ('Add-ons & extras','Moisture barrier / underlayment',null,'addon','yesno',null::jsonb,0,600,false),
  ('Add-ons & extras','New baseboards',null,'addon','yesno',null::jsonb,0,610,false),
  ('Add-ons & extras','Transitions & thresholds (T-mold, reducers)',null,'addon','yesno',null::jsonb,0,620,false),
  ('Add-ons & extras','Toilet pull & reset',null,'addon','yesno',null::jsonb,0,630,false),
  ('Add-ons & extras','Carpet & pad tear-out',null,'addon','yesno',null::jsonb,0,640,false),
  ('Add-ons & extras','Custom / specialty work','Describe the work in the line item.','addon','yesno',null::jsonb,0,650,false)
) as v(section,label,help,kind,input,options,default_amount,position,required)
where not exists (
  select 1 from public.wizard_questions w where w.label = v.label
);
