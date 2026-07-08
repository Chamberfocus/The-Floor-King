-- Floor King CRM — combine the two padding questions into one.
-- Run in Supabase: SQL Editor -> paste -> Run. Safe to re-run (idempotent).
-- The padding question now lets you add ADDITIONAL padding for a specific area
-- in the same step, so the standalone "Additional padding" question is retired.

update public.estimate_questions
  set config = config || '{"allow_additional":true}'::jsonb,
      help = 'Pick the main padding, and add additional padding for a specific area if needed.'
  where label = 'What padding?';

delete from public.estimate_questions
  where label = 'Additional padding — how many extra sq ft? (0 if none)';
