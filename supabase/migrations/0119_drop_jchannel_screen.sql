-- Floor King CRM — retire the standalone "J-channel — size & color" screen.
-- Redundant: J-channel is still available in the Trims/accessories step (with its
-- own size & color), so the dedicated text screen was an extra stop with nothing
-- gated on it. Config-only, idempotent; already applied to the live DB.
update public.estimate_questions
   set active = false
 where label = 'J-channel — size & color';
