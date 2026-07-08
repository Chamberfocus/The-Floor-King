-- Floor King CRM — capture subfloor type + tackless on the carpet questionnaire.
-- Run in Supabase: SQL Editor -> paste -> Run. Safe to re-run (idempotent).
-- Both are "job conditions" (note:true) — they show on the WORK ORDER for the
-- crew, and are not line items.

insert into public.estimate_questions (section, label, help, kind, config, required, position)
select v.section, v.label, v.help, v.kind, v.config::jsonb, v.required, v.position
from (values
  ('Carpet','Subfloor',
   'What are we installing over? Shows on the work order.',
   'choice',
   '{"note":true,"multi":false,"options":[{"label":"Concrete"},{"label":"Wood / plywood"},{"label":"Over existing floor"},{"label":"Unknown"}]}',
   false, 15),
  ('Carpet','Tackless (tackstrip) needed?',
   'Flagged on the work order so the crew knows.',
   'yesno',
   '{"note":true}',
   false, 55)
) as v(section,label,help,kind,config,required,position)
where not exists (
  select 1 from public.estimate_questions w where w.label = v.label
);
