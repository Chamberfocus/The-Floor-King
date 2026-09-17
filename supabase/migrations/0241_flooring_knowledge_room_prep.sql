-- Floor King — flooring knowledge engine, pass 52.
-- Run in the Supabase SQL editor AFTER 0190–0240. Idempotent — safe to re-run.
--
-- Per-room prep is this room's measured sq ft — not the whole mixed job.
-- Kitchen 200 sq ft of LVP is not 550 sq ft of self-level on the carpet too.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0241_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Same prep for the whole job, or set it by room on the rooms step. By-room uses each room''s measured sq ft — a mixed carpet + LVP job does not clone whole-job area onto every room.'
 where key = 'prep_scope';

commit;
