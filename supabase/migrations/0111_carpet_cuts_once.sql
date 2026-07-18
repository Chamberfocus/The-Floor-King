-- Floor King CRM — stop asking carpet measurements twice. Carpet cuts (and the
-- carpet product) are entered ONCE on the "Carpet & cuts" screen, which totals
-- the yardage there. So the generic "rooms & sizes" (areas) and "product per
-- room" (floor_map) steps only need to show when a HARD SURFACE is involved;
-- for a carpet-only job they're redundant. Run in Supabase: SQL Editor -> paste
-- -> Run. Idempotent (safe to re-run).

-- Areas ("Which areas are we doing? Add each room with its size.") → only when
-- hard surface is part of the job. Carpet-only uses the cuts screen.
update public.estimate_questions
set config = config || '{"show_if":{"key":"project_type","in":["Hard surface"]}}'::jsonb
where kind = 'areas';

-- Floor map ("What's going in each room?") → likewise hard-surface only; the
-- carpet product is picked on the cuts screen.
update public.estimate_questions
set config = config || '{"show_if":{"key":"project_type","in":["Hard surface"]}}'::jsonb
where kind = 'floor_map';
