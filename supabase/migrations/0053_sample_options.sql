-- Sample checkout options: a default deposit/hold to suggest at checkout, and a
-- cap on how many samples one customer can have out at once (0 = no limit).
alter table public.business_settings
  add column if not exists sample_default_deposit numeric(12, 2) not null default 0;
alter table public.business_settings
  add column if not exists sample_max_out int not null default 0;
