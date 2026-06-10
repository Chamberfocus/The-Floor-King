-- The default starting address (shop) used to route estimates when a rep has
-- no home base of their own. Editable in Settings → Scheduling.
alter table public.scheduling_settings
  add column if not exists default_origin text;

update public.scheduling_settings
  set default_origin = coalesce(
    default_origin,
    '3580 West 140th Street, Cleveland, OH 44111'
  )
  where id = 'default';
