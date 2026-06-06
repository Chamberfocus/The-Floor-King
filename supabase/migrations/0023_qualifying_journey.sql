-- Floor King CRM — Phase 19: intake/qualifying questionnaire (separated from pricing)
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.
-- The qualifying questionnaire is the customer-intake journey. Adds sections,
-- multiple-choice options, and required flags, then seeds the deep intake bank
-- (pricing add-ons stay in the quote builder).

alter table public.qualifying_questions
  add column if not exists section  text not null default 'Qualifying',
  add column if not exists options  jsonb,
  add column if not exists required boolean not null default false;

insert into public.qualifying_questions (section, label, help, options, required, position)
select v.section, v.label, v.help, v.options, v.required, v.position
from (values
  -- The customer & project
  ('The customer & project','What''s prompting the new floor?','Damage, remodel, selling the home, pets, or just time for an update?',null::jsonb,true,100),
  ('The customer & project','Who are the decision-makers, and is everyone here today?',null,null::jsonb,false,110),
  ('The customer & project','Is this a primary home, rental, or flip?',null,'["Primary residence","Rental property","Flip / resale","Commercial"]'::jsonb,false,120),
  ('The customer & project','What budget range are we working within?',null,null::jsonb,false,130),
  ('The customer & project','Ideal timeline / start date?',null,null::jsonb,false,135),
  ('The customer & project','Are you getting other estimates?',null,'["Yes","No"]'::jsonb,false,140),

  -- The space
  ('The space','Which rooms / areas are included?',null,null::jsonb,true,200),
  ('The space','Same flooring throughout, or different by area?',null,'["Same throughout","Different by area"]'::jsonb,false,210),
  ('The space','Traffic level in these spaces?',null,'["Light","Moderate","Heavy"]'::jsonb,false,220),

  -- Existing floor & subfloor
  ('Existing floor & subfloor','Existing floor type?',null,'["Carpet","Hardwood","Laminate","Luxury vinyl / LVP","Sheet vinyl","Tile","Concrete","Other"]'::jsonb,false,300),
  ('Existing floor & subfloor','Condition of the existing floor?',null,'["Good","Worn","Damaged","Failing"]'::jsonb,false,305),
  ('Existing floor & subfloor','Subfloor type?',null,'["Concrete slab","Plywood / OSB","Going over existing floor","Unknown"]'::jsonb,false,310),
  ('Existing floor & subfloor','Is the subfloor flat & level?',null,'["Looks level","Minor dips","Noticeable slope / dips","Not sure"]'::jsonb,false,320),
  ('Existing floor & subfloor','Any squeaks or soft / spongy spots?',null,'["Yes","No"]'::jsonb,false,330),
  ('Existing floor & subfloor','Any moisture concerns? (basement, slab, bath, past leaks)',null,'["Yes","No"]'::jsonb,false,335),
  ('Existing floor & subfloor','Floor-height difference at doorways (transitions needed)?',null,null::jsonb,false,340),
  ('Existing floor & subfloor','Older home — any asbestos risk in existing vinyl/tile?','Sheet vinyl or tile from before ~1985 may contain asbestos — test before removal.','["Yes","No"]'::jsonb,false,350),

  -- Product & style
  ('Product & style','Flooring type they''re leaning toward?',null,'["Carpet","Hardwood","Laminate","Luxury vinyl (LVP/LVT)","Tile","Sheet vinyl","Undecided"]'::jsonb,false,400),
  ('Product & style','Color / tone direction?',null,'["Light","Medium","Dark","Gray tones","Warm tones","Not sure"]'::jsonb,false,410),
  ('Product & style','Plank/tile size or carpet style preference?',null,null::jsonb,false,420),
  ('Product & style','Need scratch- or water-proof for pets/kids?',null,'["Yes","No"]'::jsonb,false,430),
  ('Product & style','Samples taken or left with the customer?',null,'["Yes","No"]'::jsonb,false,440),

  -- Installation logistics
  ('Installation logistics','Will the home be occupied during installation?',null,'["Yes","No"]'::jsonb,false,500),
  ('Installation logistics','Who moves the furniture?',null,'["We move it","Customer moves it","Mixed"]'::jsonb,false,510),
  ('Installation logistics','Appliances to disconnect or move?','Fridge, washer/dryer, stove, etc.',null::jsonb,false,520),
  ('Installation logistics','Pets to secure during install?',null,'["Yes","No"]'::jsonb,false,525),
  ('Installation logistics','Closets included in the work?',null,'["Yes","No"]'::jsonb,false,530),
  ('Installation logistics','Special access / parking / elevator / gate code notes?',null,null::jsonb,false,540),
  ('Installation logistics','Preferred work days / hours?',null,null::jsonb,false,545)
) as v(section,label,help,options,required,position)
where not exists (
  select 1 from public.qualifying_questions w where w.label = v.label
);
