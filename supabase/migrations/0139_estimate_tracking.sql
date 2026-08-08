-- Floor King — did the estimate land, and did they read it?
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Sixteen estimates have been sent and not one records an open. That isn't the
-- customers' doing: open tracking was off at the mail provider, no webhook was
-- ever registered, and the handler we had only listened for "opened" and only
-- kept the FIRST one. This stores every delivery event as it happens, so
-- "delivered", "opened", and "opened five times" are all answerable.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estimate_event_kind') then
    create type public.estimate_event_kind as enum (
      'sent',              -- handed to the mail provider
      'delivered',         -- accepted by their mail server
      'delivery_delayed',  -- retrying
      'bounced',           -- it did NOT arrive
      'complained',        -- marked as spam
      'email_opened',      -- tracking pixel fired (see the caveat below)
      'link_clicked',      -- clicked through from the email
      'viewed'             -- actually loaded the estimate page. The real signal.
    );
  end if;
end
$$;

create table if not exists public.estimate_events (
  id           uuid primary key default gen_random_uuid(),
  estimate_id  uuid not null references public.estimates (id) on delete cascade,
  kind         public.estimate_event_kind not null,
  at           timestamptz not null default now(),
  -- Who it happened to, when the provider tells us.
  recipient    text,
  -- Raw provider payload / user agent, kept for when a number looks wrong.
  meta         jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.estimate_events is
  'Every delivery and read event for an estimate, append-only in practice. '
  'Counts are derived from here — never stored on the estimate — so they cannot drift.';
comment on column public.estimate_events.kind is
  'email_opened comes from a tracking pixel: Apple Mail Privacy Protection loads '
  'it whether or not a human looked, and Gmail caches it so repeat opens go '
  'uncounted. Treat "viewed" (a real page load) as the honest number.';

create index if not exists estimate_events_estimate_idx
  on public.estimate_events (estimate_id, at desc);
create index if not exists estimate_events_kind_idx
  on public.estimate_events (estimate_id, kind);

-- One row per (estimate, kind, at) — a provider retrying a webhook is normal and
-- must not inflate the open count.
create unique index if not exists estimate_events_dedupe
  on public.estimate_events (estimate_id, kind, at);

alter table public.estimate_events enable row level security;

drop policy if exists estimate_events_staff_read on public.estimate_events;
create policy estimate_events_staff_read on public.estimate_events for select
  to authenticated using (public.is_staff());

-- Writes come from the webhook and the portal beacon, both on the service role,
-- which bypasses RLS. No client-side insert path: an open count you can POST to
-- is not evidence of anything.
grant select on public.estimate_events to authenticated;

/**
 * The delivery story for every estimate, in one row.
 *
 * Derived, never stored. "Opened" is deliberately TWO numbers: the page-load
 * count you can trust, and the pixel count you can't. Showing only the pixel
 * would overstate (Apple pre-fetches); showing only page loads would miss the
 * customer who read it in the email and never clicked. Both, labelled.
 */
create or replace view public.estimate_delivery
with (security_invoker = true) as
select
  e.id                                   as estimate_id,
  e.customer_id,
  e.sent_at,
  (select min(x.at) from public.estimate_events x
     where x.estimate_id = e.id and x.kind = 'delivered')          as delivered_at,
  (select min(x.at) from public.estimate_events x
     where x.estimate_id = e.id and x.kind = 'bounced')            as bounced_at,
  (select min(x.at) from public.estimate_events x
     where x.estimate_id = e.id and x.kind = 'complained')         as complained_at,
  -- The honest count: real loads of the estimate page.
  (select count(*)::int from public.estimate_events x
     where x.estimate_id = e.id and x.kind = 'viewed')             as view_count,
  (select min(x.at) from public.estimate_events x
     where x.estimate_id = e.id and x.kind = 'viewed')             as first_viewed_at,
  (select max(x.at) from public.estimate_events x
     where x.estimate_id = e.id and x.kind = 'viewed')             as last_viewed_at,
  -- The soft signal: the email pixel.
  (select count(*)::int from public.estimate_events x
     where x.estimate_id = e.id and x.kind = 'email_opened')       as email_open_count,
  (select max(x.at) from public.estimate_events x
     where x.estimate_id = e.id and x.kind = 'email_opened')       as last_email_open_at,
  (select count(*)::int from public.estimate_events x
     where x.estimate_id = e.id and x.kind = 'link_clicked')       as click_count
from public.estimates e;

grant select on public.estimate_delivery to authenticated;
