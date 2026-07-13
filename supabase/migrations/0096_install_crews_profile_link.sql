-- Hard-link each install crew to its login profile so an installer is ALWAYS
-- recognized exactly — no more matching by name/email guesswork (which broke
-- when a crew had no email or a slightly different name, leaving the installer's
-- login showing nothing). Idempotent.

-- 1) The link column.
alter table public.install_crews
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

create index if not exists install_crews_profile_id_idx
  on public.install_crews (profile_id);

-- 2) Backfill: link every unlinked crew to its login profile, matching on phone
--    (last 10 digits — most reliable), then email, then exact name. Crew/admin
--    profiles only; one best match per crew.
with cand as (
  select
    c.id as crew_id,
    p.id as profile_id,
    row_number() over (
      partition by c.id
      order by
        case
          when nullif(right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10), '') is not null
           and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10)
             = right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10)
          then 1
          when c.email is not null and lower(c.email) = lower(p.email) then 2
          when lower(btrim(c.name)) = lower(btrim(coalesce(p.full_name, ''))) then 3
          else 9
        end
    ) as rk
  from public.install_crews c
  join public.profiles p on p.role in ('crew', 'admin')
  where c.profile_id is null
    and (
      (nullif(right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10), '') is not null
        and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10)
          = right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10))
      or (c.email is not null and lower(c.email) = lower(p.email))
      or (lower(btrim(c.name)) = lower(btrim(coalesce(p.full_name, ''))))
    )
)
update public.install_crews c
set profile_id = cand.profile_id
from cand
where cand.crew_id = c.id
  and cand.rk = 1
  and c.profile_id is null;
