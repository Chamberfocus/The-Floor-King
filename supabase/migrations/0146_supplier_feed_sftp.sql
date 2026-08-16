-- Floor King — 832 price catalogs collected over SFTP.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Shaw's B2B program delivers the 832 by SFTP on port 22, not by HTTPS: they
-- write a new file to a mailbox every time a price on your agreement changes.
-- 0140 assumed a feed was either a REST call or a file someone uploads by hand;
-- this adds the third and, for a mill, the most common shape — a drop box we
-- poll.

alter table public.supplier_feeds
  add column if not exists transport        text not null default 'upload',
  add column if not exists sftp_host        text,
  add column if not exists sftp_port        int not null default 22,
  add column if not exists sftp_username    text,
  add column if not exists sftp_remote_path text;

comment on column public.supplier_feeds.transport is
  'How a catalog reaches us: upload (a person uploads the file) or sftp (we '
  'poll their mailbox). The password lives in the env var named by '
  'credential_key — never here.';

comment on column public.supplier_feeds.sftp_remote_path is
  'Directory to list, e.g. /outbox. Blank means the login''s home directory.';

-- Which files we have already taken. Shaw leaves them in place, so without this
-- every nightly poll would re-import the same catalog and ask you to review a
-- change you already applied.
create table if not exists public.supplier_feed_files (
  id           uuid primary key default gen_random_uuid(),
  feed_id      uuid not null references public.supplier_feeds (id) on delete cascade,
  file_name    text not null,
  file_size    bigint,
  remote_mtime timestamptz,
  import_id    uuid references public.price_imports (id) on delete set null,
  fetched_at   timestamptz not null default now()
);
create unique index if not exists supplier_feed_files_unique
  on public.supplier_feed_files (feed_id, file_name);

alter table public.supplier_feed_files enable row level security;
drop policy if exists supplier_feed_files_staff on public.supplier_feed_files;
create policy supplier_feed_files_staff on public.supplier_feed_files for all
  to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.supplier_feed_files to authenticated;

-- Broadloom arrives priced by the square yard with the roll width and standard
-- length on the file. Keeping them lets a carpet line be cut and ordered
-- against what Shaw actually rolls, instead of a guess.
alter table public.price_import_lines
  add column if not exists roll_width_ft  numeric,
  add column if not exists roll_length_ft numeric;
