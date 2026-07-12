-- Notification master switches. Staff/installer/warehouse texts & emails on;
-- customer-facing texts & emails off until the shop is ready to turn them on.
-- Idempotent.
alter table public.business_settings
  add column if not exists notify_staff     boolean not null default true,
  add column if not exists notify_customers boolean not null default false;
