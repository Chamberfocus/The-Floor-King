-- Floor King CRM — optional: let the assigned installer collect the balance on
-- site. Off by default; when on, the installer's job screen shows a
-- "Balance due → Collect" prompt (cash/check record the payment; payment link
-- flags the office to collect online). Safe to re-run.

alter table public.business_settings
  add column if not exists installer_collects_balance boolean not null default false;
