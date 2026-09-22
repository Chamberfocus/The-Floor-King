-- Floor King — flooring knowledge engine, pass 122.
-- Run in the Supabase SQL editor AFTER 0190–0310. Idempotent — safe to re-run.
--
-- Self-level bags and subfloor sheets were derived from measured area but
-- stayed off Review, so taped square feet looked like the order. Review
-- prints the bag / sheet count — taped square feet is not a bag order and
-- not a plywood order. Missing coverage stays off Review (Builder still
-- withholds). Field verify still withholds. Do not invent 1/4 inch or a
-- 4×8 (32 sq ft) sheet. Builder still carries coverage + area so the bag
-- calculator stays live.
-- Do NOT SQL-gate selflevel_needed on tile_application (0142 — mixed LVP + wall tile still asks bags on the floor rooms).
-- Do NOT SQL-gate subfloor_needed on surface_type (0142 — mixed jobs still ask sheets on hard-surface rooms).
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0311_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Bag count uses Settings coverage at the chosen pour. Pour is the shop default, else the coverage reference — we do not invent 1/4 inch. Field verify withholds bags. Review prints the bag count — taped square feet is not a bag order. Do not invent coverage.'
 where key = 'selflevel_needed';

update public.estimate_questions
   set help = 'Yes emits 4×8 sheets only when Settings has sheet_sqft. Missing coverage is TBD — we do not invent 32 sq ft per sheet. Field verify withholds the count. Exclusive Concrete hides this — a slab is not a plywood overlay. Plywood / wood / existing flooring / Unknown still ask. Self-level stays on Floor prep. Review prints the sheet count — taped square feet is not a plywood order.'
 where key = 'subfloor_needed';

commit;
