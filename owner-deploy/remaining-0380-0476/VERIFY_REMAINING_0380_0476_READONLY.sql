-- =============================================================================
-- GUIDED ESTIMATE — READ-ONLY POST-VERIFY AFTER REMAINING 0380–0476
-- SELECT only. Run by the apply script after remaining deploy, or paste later.
-- =============================================================================

select
  'POST-VERIFY remaining 0380-0476 READ-ONLY'::text as script,
  now() as ran_at,
  current_database() as database,
  current_user as ran_as;

select
  '0380 fingerprint (expect PRESENT)'::text as section,
  'Builder expanded LineMeasurements carton count'::text as needle,
  bool_or(q.help ilike '%' || 'Builder expanded LineMeasurements carton count' || '%') as found_in_help
from public.estimate_questions q
where q.kind = 'floor_map'
   or q.key in ('work_type', 'hs_plank_stairs');

select
  '0476 fingerprint (expect PRESENT)'::text as section,
  'job-scope room leftover'::text as needle,
  bool_or(q.help ilike '%' || 'job-scope room leftover' || '%') as found_in_help
from public.estimate_questions q
where q.kind = 'floor_map'
   or q.key in ('work_type', 'hs_plank_stairs');

select
  '0379 fingerprint still present'::text as section,
  'approval-snapshot job-seed carton coverage'::text as needle,
  bool_or(q.help ilike '%' || 'approval-snapshot job-seed carton coverage' || '%') as found_in_help
from public.estimate_questions q
where q.kind = 'floor_map'
   or q.key in ('work_type', 'hs_plank_stairs');

select
  'accounting flags still OFF'::text as section,
  coalesce(s.books_of_record, false) as books_of_record,
  coalesce(s.posting_enabled, false) as posting_enabled,
  coalesce(s.inventory_posting_enabled, false) as inventory_posting_enabled,
  coalesce(s.ap_posting_enabled, false) as ap_posting_enabled,
  coalesce(s.installer_posting_enabled, false) as installer_posting_enabled
from public.accounting_settings s;
