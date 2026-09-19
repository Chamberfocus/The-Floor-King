-- Floor King — flooring knowledge engine, pass 111.
-- Run in the Supabase SQL editor AFTER 0190–0299. Idempotent — safe to re-run.
--
-- Hardwood fasteners are nail / staple. Exclusive LVP still asked them once
-- leftover Nail-down passed SQL show_if, and live 0191 knowledge_when is
-- systems-only so the overlay systems gate stayed open after 0299 strip.
-- Hide hardwood_fasteners once the surface is exclusive LVP / laminate /
-- vinyl / tile — leftover Nail-down on LVP does not reopen. Mixed LVP +
-- hardwood still asks. Unanswered hard surface stays open.
-- Do NOT SQL-gate hardwood_fasteners on surface_type (0142 — unanswered HS and mixed LVP + hardwood must still ask fasteners).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0300_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Nail/staple jobs need fasteners. Pick the catalog item in Builder — this question only records the need. Exclusive LVP / laminate / vinyl / tile hide this — leftover Nail-down on LVP does not reopen it. Leftover Floating on exclusive solid hardwood does not hide this — leftover illegal chips do not switch overlay follow-ups. Mixed LVP + hardwood still asks when Nail-down is in play. Unanswered hard surface stays open.'
 where key = 'hardwood_fasteners';

commit;
