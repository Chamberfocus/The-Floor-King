-- Turn on Supabase Realtime (instant push) for the live-collaboration tables:
-- customer/staff chat, jobs (the board + scheduling), and board applications.
-- The app subscribes to these and soft-refreshes on any change. Idempotent —
-- skips a table that's already published.

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.jobs;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.job_applications;
exception when duplicate_object then null; end $$;
