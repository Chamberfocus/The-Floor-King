-- Floor King — flooring knowledge engine, pass 45.
-- Run in the Supabase SQL editor AFTER 0190–0233. Idempotent — safe to re-run.
--
-- Guided Review always lists MEASURED area, WASTE, ORDER quantity, BILLING
-- quantity, and UNIT of measure as separate facts. Taped sq ft is never a
-- yard order. Hard-surface sq-ft jobs still show billing + unit so 550 sq ft
-- cannot be read as yards. Carton counts appear only when coverage exists.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0234_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Enter rooms in feet and inches. Add a section for closets and offsets. This is MEASURED area. Review lists WASTE, ORDER quantity, BILLING quantity, and UNIT of measure separately. sq ft ÷ 9 is equivalent area, not a carpet order. Carton counts appear only when the product has coverage on file.'
 where kind = 'areas';

commit;
