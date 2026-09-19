-- Floor King — flooring knowledge engine, pass 93.
-- Run in the Supabase SQL editor AFTER 0190–0281. Idempotent — safe to re-run.
--
-- 0142 merged Placed on the curb into demo_disposal, but leftover carpet_curb
-- still sat on the overlay (carpet family), so every carpet job listed it.
-- Hide it always. demo_disposal is the source of truth. Review still buckets
-- leftover answers. bulk_pickup still waits for Placed at curb.
-- Do NOT SQL-gate bulk_pickup on demo_disposal (0142 show_if already waits for Placed at curb; overlay require hides haul-away).
-- Do NOT SQL-gate demo_disposal on carpet_curb (0142 — unanswered disposal must still ask haul vs curb).
-- Do NOT drop leftover carpet_curb from review SPECIAL_KEYS.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0282_FLOORING_KNOWLEDGE

begin;

-- Placed on the curb? was deactivated in 0142 (now a demo_disposal chip).
-- Re-assert. Do not touch bulk_pickup (UUID 81a746cb) — that is the live
-- municipal pickup-day follow-up.
update public.estimate_questions
   set active = false
 where key = 'carpet_curb'
    or id = 'a07eb68f-91b6-4fe7-8237-bb0e9986076c';

update public.estimate_questions
   set help = 'Haul away, dumpster, or placed at curb. Placed at curb opens bulk pickup day. Leftover Placed-on-the-curb yes-no stays off the overlay — demo_disposal is the source of truth. New construction hides this. Unanswered stays open. Do not invent a dumpster fee.'
 where key = 'demo_disposal';

update public.estimate_questions
   set help = 'Municipal bulk pickup day so the old floor is at the curb on time. New construction hides this. Haul-away / dumpster hides this. Unanswered disposal stays open in overlay. Leftover Placed-on-the-curb yes-no is not this question — Placed at curb on demo_disposal is. Do not invent a disposal charge here.'
 where key = 'bulk_pickup';

commit;
