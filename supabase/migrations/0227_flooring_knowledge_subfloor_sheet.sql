-- Floor King — flooring knowledge engine, pass 38.
-- Run in the Supabase SQL editor AFTER 0190–0226. Idempotent — safe to re-run.
--
-- Subfloor sheets: round up from measured sq ft ÷ Settings sheet_sqft.
-- Missing sheet_sqft is TBD — we do not invent a 4×8 (32 sq ft) sheet.
--
-- Does NOT invent carton coverage, catalog categories, or prices.
-- Does NOT enable accounting.

-- P0_0227_FLOORING_KNOWLEDGE

begin;

update public.estimate_questions
   set help = 'Sheets = ceil(room sq ft ÷ Settings sheet coverage). Missing coverage is TBD — we do not invent a 4×8 (32 sq ft). Field verify / TBD does not add a sheet count. Priced per sheet, never as square feet of plywood.'
 where kind = 'subfloor';

commit;
