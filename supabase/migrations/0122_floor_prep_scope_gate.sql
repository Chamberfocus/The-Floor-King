-- Floor King CRM — "is floor prep the same for the whole job?" gate. Pairs with a
-- questionnaire change: when set to "by room", the per-room prep questions move into
-- the rooms step (each room carries its own leveling / primer / moisture / subfloor /
-- demo — the single source) and their standalone whole-job steps disappear. When
-- "same for the whole job", they stay as normal one-time steps. Config-only,
-- idempotent; already applied to the live DB.

-- The gate, asked before the rooms step (position 4, hard surface only).
insert into public.estimate_questions (section, label, help, kind, key, required, active, position, config)
select 'Floor prep',
       'Is floor prep the same across the whole job?',
       'If it varies, you''ll set leveling / primer / moisture / subfloor / demo on each room in the next step — and those per-room answers rule.',
       'choice', 'prep_scope', false, true, 4,
       '{"options":[{"label":"Same for the whole job"},{"label":"Set it by room"}],"show_if":{"in":["Hard surface"],"key":"project_type"}}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'prep_scope');

-- Subfloor joins the per-room prep set (each room can need it or not).
update public.estimate_questions
   set config = jsonb_set(config, '{per_room}', 'true'::jsonb)
 where label = 'Subfloor needed?' and config -> 'show_if' -> 'in' ? 'Hard surface';
