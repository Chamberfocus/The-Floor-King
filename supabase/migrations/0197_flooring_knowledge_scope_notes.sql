-- Floor King — flooring knowledge engine, pass 8.
-- Run in the Supabase SQL editor AFTER 0190–0196. Idempotent — safe to re-run.
--
-- 1. Asbestos risk when tearing out old ceramic/sheet vinyl (pre-1985). Scope /
--    warning only — does NOT invent abatement pricing.
-- 2. Hard-surface plank run direction (LVP / laminate / hardwood). Warehouse /
--    layout note — does NOT auto-inflate waste.
--
-- Delivery stays a choice. The app emits a Delivery line only when Settings →
-- Default pricing already has a Delivery cost; it does not invent fuel $.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0197_FLOORING_KNOWLEDGE

begin;

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0197a001-c0de-4000-8000-000000000001',
       'Demo & disposal',
       'Asbestos risk in existing vinyl / ceramic?',
       'Sheet vinyl or ceramic from before ~1985 may contain asbestos. Capture it for the crew. Do not invent an abatement price here.',
       'choice', 'asbestos_risk', false, true, 277,
       '{"note":true,"multi":false,"purpose":"WARNING","knowledge_when":{"purpose":"WARNING"},"show_if":{"key":"hs_demo","in":["Ceramic WITH mortar bed","Ceramic WITHOUT mortar bed","Sheet vinyl"]},"options":[{"label":"No — not applicable"},{"label":"Possible — test before removal"},{"label":"Confirmed — abatement required"},{"label":"Unknown / field verify"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'asbestos_risk');

insert into public.estimate_questions (id, section, label, help, kind, key, required, active, position, config)
select '0197a001-c0de-4000-8000-000000000002',
       'Hard surface',
       'Plank / board run direction?',
       'Which way the planks run. Affects seams, waste, and the warehouse. Do not auto-inflate waste from this answer.',
       'choice', 'hs_direction', false, true, 214,
       '{"note":true,"multi":false,"purpose":"WAREHOUSE","knowledge_when":{"families":["lvp","laminate","hardwood"],"purpose":"WAREHOUSE"},"show_if":{"key":"surface_type","in":["Laminate","LVP / LVT","Hardwood","Engineered hardwood"]},"options":[{"label":"Down the length of the room"},{"label":"Across the width"},{"label":"Diagonal / special"},{"label":"Field verify / TBD"}]}'::jsonb
where not exists (select 1 from public.estimate_questions where key = 'hs_direction');

commit;
