-- =============================================================================
-- GUIDED ESTIMATE — READ-ONLY VERIFY FOR OWNER BATCHES 01–03
-- Covers original numbered files 0190–0379 only (190 files).
-- SELECT only. No INSERT/UPDATE/DELETE/ALTER/DROP.
-- Does NOT enable accounting. Does NOT apply 0380–0476.
-- Paste into the production Supabase SQL Editor and Run.
-- =============================================================================

select
  'VERIFY batches 01-03 (0190-0379) READ-ONLY'::text as script,
  now() as ran_at,
  current_database() as database,
  current_user as ran_as;

-- 1. 40 INSERT keys from 0190–0253 (all inside batch 01)
select
  '1. insert keys'::text as section,
  v.key,
  exists (
    select 1 from public.estimate_questions q where q.key = v.key
  ) as present
from (
  values
    ('carpet_install'),
    ('pattern_match'),
    ('carpet_direction'),
    ('existing_pad'),
    ('attached_pad'),
    ('vapor_barrier'),
    ('construction_grade'),
    ('stair_landings'),
    ('stair_open_sides'),
    ('prep_confidence'),
    ('occupancy'),
    ('access_conditions'),
    ('furniture_heavy'),
    ('vinyl_layout'),
    ('tile_layout'),
    ('hardwood_fasteners'),
    ('existing_bond'),
    ('tack_strip'),
    ('laminate_expansion'),
    ('tile_setting'),
    ('vents_registers'),
    ('subfloor_condition'),
    ('tile_application'),
    ('vinyl_skim'),
    ('pattern_repeat'),
    ('delivery_scope'),
    ('asbestos_risk'),
    ('hs_direction'),
    ('hs_transitions'),
    ('hs_base_trim'),
    ('tile_body'),
    ('tile_format'),
    ('metals_qty'),
    ('tack_strip_qty'),
    ('carpet_tile_stairs'),
    ('carpet_tile_stair_count'),
    ('hardwood_finish'),
    ('work_type'),
    ('wet_area'),
    ('existing_tack')
) as v(key)
order by v.key;

select
  '1b. insert key count'::text as section,
  count(*) filter (
    where exists (select 1 from public.estimate_questions q where q.key = v.key)
  ) as present_count,
  40 as expected_count,
  (count(*) filter (
    where exists (select 1 from public.estimate_questions q where q.key = v.key)
  ) = 40) as all_40_present
from (
  values
    ('carpet_install'),
    ('pattern_match'),
    ('carpet_direction'),
    ('existing_pad'),
    ('attached_pad'),
    ('vapor_barrier'),
    ('construction_grade'),
    ('stair_landings'),
    ('stair_open_sides'),
    ('prep_confidence'),
    ('occupancy'),
    ('access_conditions'),
    ('furniture_heavy'),
    ('vinyl_layout'),
    ('tile_layout'),
    ('hardwood_fasteners'),
    ('existing_bond'),
    ('tack_strip'),
    ('laminate_expansion'),
    ('tile_setting'),
    ('vents_registers'),
    ('subfloor_condition'),
    ('tile_application'),
    ('vinyl_skim'),
    ('pattern_repeat'),
    ('delivery_scope'),
    ('asbestos_risk'),
    ('hs_direction'),
    ('hs_transitions'),
    ('hs_base_trim'),
    ('tile_body'),
    ('tile_format'),
    ('metals_qty'),
    ('tack_strip_qty'),
    ('carpet_tile_stairs'),
    ('carpet_tile_stair_count'),
    ('hardwood_finish'),
    ('work_type'),
    ('wet_area'),
    ('existing_tack')
) as v(key);

-- 2. ALTER 0228 (batch 01): order_items.unit default is empty string
select
  '2. order_items.unit default'::text as section,
  c.column_default,
  (c.column_default in ($$''::text$$, $$''::character varying$$, $$''::varchar$$))
    as looks_like_empty_string_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'order_items'
  and c.column_name = 'unit';

-- 3. Batch 01 knowledge_when landed on carpet_install
select
  '3. carpet_install knowledge_when'::text as section,
  q.key,
  (q.config ? 'knowledge_when') as has_knowledge_when_key,
  q.config->'knowledge_when' as knowledge_when
from public.estimate_questions q
where q.key = 'carpet_install';

-- 4. Batch 03 end fingerprint (0379 snapshot-seed carton) should be present
--    if 01–03 succeeded through 0379.
select
  '4. batch 03 / 0379 fingerprint'::text as section,
  'approval-snapshot job-seed carton coverage'::text as needle,
  bool_or(q.help ilike '%' || 'approval-snapshot job-seed carton coverage' || '%') as found_in_help
from public.estimate_questions q
where q.kind = 'floor_map'
   or q.key in ('work_type', 'hs_plank_stairs');

-- 5. Remaining 0380 fingerprint should be ABSENT (do not treat 0380–0476 as applied)
select
  '5. remaining 0380 fingerprint (expect ABSENT)'::text as section,
  'Builder expanded LineMeasurements carton count'::text as needle,
  bool_or(q.help ilike '%' || 'Builder expanded LineMeasurements carton count' || '%') as found_in_help,
  (not bool_or(q.help ilike '%' || 'Builder expanded LineMeasurements carton count' || '%')) as remaining_not_applied
from public.estimate_questions q
where q.kind = 'floor_map'
   or q.key in ('work_type', 'hs_plank_stairs');

-- 6. Final 0476 fingerprint should be ABSENT until remaining deploy
select
  '6. remaining 0476 fingerprint (expect ABSENT)'::text as section,
  'job-scope room leftover'::text as needle,
  bool_or(q.help ilike '%' || 'job-scope room leftover' || '%') as found_in_help
from public.estimate_questions q
where q.kind = 'floor_map'
   or q.key in ('work_type', 'hs_plank_stairs');

-- 7. Accounting remains OFF
select
  '7. accounting flags'::text as section,
  coalesce(s.books_of_record, false) as books_of_record,
  coalesce(s.posting_enabled, false) as posting_enabled,
  coalesce(s.inventory_posting_enabled, false) as inventory_posting_enabled,
  coalesce(s.ap_posting_enabled, false) as ap_posting_enabled,
  coalesce(s.installer_posting_enabled, false) as installer_posting_enabled,
  (
    coalesce(s.books_of_record, false)
    or coalesce(s.posting_enabled, false)
    or coalesce(s.inventory_posting_enabled, false)
    or coalesce(s.ap_posting_enabled, false)
    or coalesce(s.installer_posting_enabled, false)
  ) as any_accounting_on
from public.accounting_settings s;
