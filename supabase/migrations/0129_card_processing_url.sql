-- A link to the shop's credit-card processor (virtual terminal / payment page)
-- so estimators can open it from the app to run a card. External URL only — the
-- CRM never sees card data; it just opens the processor in a new tab.
alter table public.org_settings
  add column if not exists card_processing_url text;
