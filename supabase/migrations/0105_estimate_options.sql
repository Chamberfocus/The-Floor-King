-- Multi-option estimates: mark individual lines OPTIONAL (owner-side clarity +
-- the "make a version without optional items" shortcut), and let the owner flag
-- one option as RECOMMENDED so the customer's side-by-side comparison can
-- highlight it. recommended_option_id is a plain uuid (nulled in-app if the
-- option goes away) to stay clear of option-recreation cascades.
alter table public.estimate_line_items
  add column if not exists is_optional boolean not null default false;

alter table public.estimates
  add column if not exists recommended_option_id uuid;
