-- Shop talk to-dos. A person can hand work to someone else.
-- When it is finished, the sender can see that on Shop talk.
-- Run in the Supabase SQL editor after 0497. Safe to re-run.
-- Does not text or email.

-- Old completed rows are marked seen only when the column is added.
-- A later run leaves new completions unseen so the sender still gets the notice.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'office_tasks'
      and column_name = 'sender_seen_at'
  ) then
    alter table public.office_tasks add column sender_seen_at timestamptz;
    update public.office_tasks
    set sender_seen_at = coalesce(completed_at, updated_at, now())
    where status in ('completed', 'cancelled');
  end if;
end $$;

comment on column public.office_tasks.sender_seen_at is
  'When the person who created the task has seen that it was completed. Null means they have not.';

create index if not exists office_tasks_sender_unseen_idx
  on public.office_tasks (created_by, completed_at desc)
  where status = 'completed' and sender_seen_at is null;

-- Managers keep the office task form. Everyone in Shop talk may also hand
-- off a to-do, and only as themselves.
drop policy if exists office_tasks_insert on public.office_tasks;
create policy office_tasks_insert on public.office_tasks
  for insert to authenticated
  with check (
    public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager')
    or (
      public.my_role() in (
        'admin', 'office', 'sales_manager', 'salesman', 'scheduler', 'crew', 'warehouse'
      )
      and created_by = auth.uid()
      and source = 'shop_talk'
      and assigned_to is not null
      and status = 'open'
    )
  );

-- The sender must be able to mark the completion seen. The trigger still
-- blocks them from rewriting the task.
drop policy if exists office_tasks_update on public.office_tasks;
create policy office_tasks_update on public.office_tasks
  for update to authenticated
  using (
    public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager')
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  )
  with check (
    public.user_role(auth.uid())::text in ('admin', 'office', 'sales_manager')
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  );

create or replace function public.office_tasks_protect_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_manager boolean;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if public.accounting_is_service_role() then
    return new;
  end if;

  v_role := coalesce(public.user_role(v_uid)::text, '');
  v_manager := v_role in ('admin', 'office', 'sales_manager');

  if v_manager then
    return new;
  end if;

  -- The sender may record that they saw the completion, and nothing else.
  if old.created_by = v_uid
     and new.sender_seen_at is distinct from old.sender_seen_at
     and new.status is not distinct from old.status
     and new.assigned_to is not distinct from old.assigned_to
     and new.created_by is not distinct from old.created_by
     and new.customer_id is not distinct from old.customer_id
     and new.job_id is not distinct from old.job_id
     and new.estimate_id is not distinct from old.estimate_id
     and new.title is not distinct from old.title
     and new.priority is not distinct from old.priority
     and new.due_at is not distinct from old.due_at
     and new.source is not distinct from old.source
     and new.source_key is not distinct from old.source_key
     and new.description is not distinct from old.description
     and new.completed_at is not distinct from old.completed_at
     and new.completed_by is not distinct from old.completed_by
  then
    return new;
  end if;

  if old.assigned_to is distinct from v_uid then
    raise exception 'TASK_FORBIDDEN: only the assignee or a manager may update this task.'
      using errcode = 'P0001';
  end if;

  if new.assigned_to is distinct from old.assigned_to
     or new.created_by is distinct from old.created_by
     or new.customer_id is distinct from old.customer_id
     or new.job_id is distinct from old.job_id
     or new.estimate_id is distinct from old.estimate_id
     or new.title is distinct from old.title
     or new.priority is distinct from old.priority
     or new.due_at is distinct from old.due_at
     or new.source is distinct from old.source
     or new.source_key is distinct from old.source_key
     or new.description is distinct from old.description
     or new.sender_seen_at is distinct from old.sender_seen_at then
    raise exception
      'TASK_FIELD_FORBIDDEN: assignees may only complete tasks (status/completed_*), not change assignment or content.'
      using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if not (
      old.status in ('open', 'in_progress')
      and new.status = 'completed'
    ) then
      raise exception
        'TASK_STATUS_FORBIDDEN: assignees may only move open/in_progress tasks to completed.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- The person who sent the to-do should see it finish without waiting on the poll.
do $$ begin
  alter publication supabase_realtime add table public.office_tasks;
exception when duplicate_object then null; end $$;
