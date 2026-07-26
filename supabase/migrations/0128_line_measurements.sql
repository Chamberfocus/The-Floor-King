-- First-class MEASUREMENTS per estimate line.
--
-- Until now a flooring line held a single cut (length_in × width_in) plus a
-- derived sqft, and extra carpet cuts had to be tacked on as separate "fill
-- piece" lines. This makes measurements first-class: each flooring line carries
-- a LIST of measured pieces you build up as you go. The list drives the line's
-- square footage, and for carpet each "add" piece is a cut the warehouse pulls.
--
-- Shape: jsonb array of pieces
--   [{ "label": "Master", "length_in": 180, "width_in": 144, "op": "add" }, ...]
--   * length_in / width_in are inches (matching length_in/width_in on the line).
--   * op: "add" (an area / a cut) or "subtract" (a cutout, hard surface only).
-- length_in/width_in on the line are kept as the PRIMARY (first) cut for any
-- reader that only knows the single-cut model — belt and suspenders.

alter table public.estimate_line_items
  add column if not exists measurements jsonb;
