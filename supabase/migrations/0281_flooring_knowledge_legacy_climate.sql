-- Floor King — flooring knowledge engine, pass 92.
-- Run in the Supabase SQL editor AFTER 0190–0280. Idempotent — safe to re-run.
--
-- 0142 merged AC and heat into climate_control, but leftover ac_available /
-- heat_available keys still sat on the overlay (no families/systems), so
-- every job listed them. Hide them always. climate_control is the source of truth.
-- climateControlConfirmed still reads leftover Yes answers.
-- Do NOT SQL-gate climate_control on install_method (0142 — unanswered hardwood/glue must still ask climate).
-- Do NOT SQL-gate climate_control on tile_application (0142 — unanswered floor vs wall must still ask AC/heat).
-- Do NOT drop legacy Yes reading from climateControlConfirmed.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0281_FLOORING_KNOWLEDGE

begin;

-- Heat available? was deactivated in 0142. Re-assert. Any leftover AC/heat
-- yes-no keyed rows stay inactive so they cannot reappear on Guided Estimate.
-- Do not touch climate_control (UUID 4f2ec418) — that is the live question.
update public.estimate_questions
   set active = false
 where key in ('ac_available', 'heat_available')
    or id = 'e3bcf27d-cddd-44ee-8fef-70ff38056649';

update public.estimate_questions
   set help = 'AC and heat on site. The acclimation warning fires only for hardwood / glue-down / carpet tile, from this overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Unanswered and Unknown stay open. Legacy AC/heat yes-no answers still count. Leftover AC available / Heat available questions stay off the overlay — climate_control is the source of truth.'
 where key = 'climate_control';

commit;
