-- A workflow stage can declare which DUTY owns it (sales | install | schedule |
-- office | warehouse). The "Move / reassign" owner picker for that stage then
-- only offers people with that duty. Null = anyone (current behavior).
alter table public.workflow_stages
  add column if not exists owner_duty text;
