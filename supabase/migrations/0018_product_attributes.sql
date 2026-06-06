-- Floor King CRM — Phase 14: product attributes on line items & PO items
-- Run in Supabase (project: flooring flow plus): SQL Editor -> paste -> Run. Safe to re-run.
-- These power precise search (style/color/item #/manufacturer) and are filled
-- automatically by the smart document uploader.

alter table public.estimate_line_items
  add column if not exists manufacturer text,
  add column if not exists style        text,
  add column if not exists color        text,
  add column if not exists item_no      text;

alter table public.po_items
  add column if not exists manufacturer text,
  add column if not exists style        text,
  add column if not exists color        text,
  add column if not exists item_no      text;
