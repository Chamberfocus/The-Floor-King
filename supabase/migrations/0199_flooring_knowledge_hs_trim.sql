-- Floor King — flooring knowledge engine, pass 10.
-- Run in the Supabase SQL editor AFTER 0190–0198. Idempotent — safe to re-run.
--
-- Hard-surface doorway transitions and base/shoe/quarter-round were asked as
-- priced choice rows (0081) then deactivated because Trims already captures
-- them (0085 / 0117). New salespeople still skip Trims. Re-ask as NOTES only:
-- which types are needed, in EACH (transitions) or LN FT (base/QR/shoe).
-- Matching pieces are added on Trims from existing TRIM_TYPES — this does NOT
-- invent Versatrim SKUs, carton coverage, or a second priced transition line.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0199_FLOORING_KNOWLEDGE

begin;

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0199a001-c0de-4000-8000-000000000001',
       'trim',
       'Doorway transitions needed?',
       'T-mold, reducer, end cap, threshold, or metal — EACH, never square feet. Pick the types here, then add matching catalog pieces on Trims. Do not invent a SKU or price here. Field verify is allowed.',
       'choice', 'hs_transitions', false, true, 291,
       '{"note":true,"multi":true,"purpose":"ACCESSORY","knowledge_when":{"families":["lvp","hardwood","laminate","vinyl","tile"],"purpose":"ACCESSORY"},"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"None — keep existing / no new transitions"},{"label":"T-mold"},{"label":"Reducer"},{"label":"End cap"},{"label":"Threshold"},{"label":"Metal"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'hs_transitions');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0199a001-c0de-4000-8000-000000000002',
       'trim',
       'Base / quarter round / shoe?',
       'Linear feet, never square feet. Pick the profiles here, then enter footage on Trims. Keep existing or Field verify if demo has not happened. Do not invent a molding SKU here.',
       'choice', 'hs_base_trim', false, true, 292,
       '{"note":true,"multi":true,"purpose":"ACCESSORY","knowledge_when":{"families":["lvp","hardwood","laminate","vinyl","tile"],"purpose":"ACCESSORY"},"show_if":{"key":"project_type","in":["Hard surface"]},"options":[{"label":"Keep existing base"},{"label":"Quarter round"},{"label":"Shoe molding"},{"label":"Baseboard"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'hs_base_trim');

commit;
