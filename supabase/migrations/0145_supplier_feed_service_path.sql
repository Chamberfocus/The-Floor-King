-- Floor King — the one thing 0140 left out: WHICH service to call.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- The fcB2B REST spec fixes the four request PARAMETERS but suppliers still
-- differ on the price service's path. Shaw tells you theirs during onboarding;
-- without somewhere to put it the endpoint is only half configured, and a
-- hard-coded guess would be wrong for the next supplier.

alter table public.supplier_feeds
  add column if not exists price_service_path text;

comment on column public.supplier_feeds.price_service_path is
  'Path of the supplier''s price service, e.g. /priceinquiry. Supplied by them '
  'during onboarding — service discovery (/services) lists what they expose.';

-- A draft import that was never reviewed should not look identical to one that
-- was reviewed and rejected. 0140 only modelled draft → applied.
alter table public.price_imports
  add column if not exists discarded_at timestamptz,
  add column if not exists discarded_by uuid references public.profiles (id) on delete set null;

-- Which lines the reviewer actually accepted. A line can be matched, changed,
-- and still deliberately skipped (a unit mismatch, a list price, a bad row) —
-- and next month's import must not quietly re-apply what a human rejected.
alter table public.price_import_lines
  add column if not exists applied boolean not null default false,
  add column if not exists skipped_reason text;

comment on column public.price_import_lines.applied is
  'True only for lines whose cost was actually written to the product. The '
  'import''s changed count is the count of these, not of everything parsed.';
