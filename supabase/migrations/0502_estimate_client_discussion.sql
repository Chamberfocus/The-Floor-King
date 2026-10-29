-- Customer can ask to discuss an open estimate without declining it.
-- A portal decline still requires a reason.
-- Page-view counts stay on estimate_events / estimate_delivery (0139).
-- Does not enable accounting. Does not change posting.

alter table public.estimates
  add column if not exists discussion_requested_at timestamptz,
  add column if not exists discussion_note text;

comment on column public.estimates.discussion_requested_at is
  'When the customer clicked that they want to discuss this estimate. Status stays sent or changes_requested so they can still approve or decline.';

comment on column public.estimates.discussion_note is
  'Optional note the customer left with a discussion request.';

-- Same customer projection as 0181, plus the discussion fields at the end.
-- CREATE OR REPLACE may only append columns. Do not insert cost, margin, or internal notes.
create or replace view public.estimates_customer
with (security_barrier = true) as
select
  e.id,
  e.customer_id,
  e.title,
  e.status,
  e.presentation,
  e.show_project_details,
  e.tax_rate,
  e.discount_kind,
  e.discount_value,
  e.job_description,
  e.customer_response_note,
  e.valid_until,
  e.sent_at,
  e.viewed_at,
  e.accepted_option_id,
  e.recommended_option_id,
  e.approved_at,
  e.approval_source,
  e.approved_by_customer_id,
  e.current_approval_snapshot_id,
  e.approval_stale,
  e.service_address_id,
  e.created_at,
  e.updated_at,
  e.discussion_requested_at,
  e.discussion_note
from public.estimates e
where e.customer_id = public.my_customer_id();

comment on view public.estimates_customer is
  'P0/0181 customer JWT SELECT, plus discussion request fields (0502). Omits target_margin, internal notes, created_by, commission, and the staff approval actor.';

grant select on public.estimates_customer to authenticated;
revoke all on public.estimates_customer from anon, public;

-- ---------------------------------------------------------------------------
-- Portal column guard (replaces the 0179 function body).
--
-- DIRECT customer UPDATE allowlist is unchanged:
--   sent → declined | changes_requested
--   changes_requested → declined
--   plus customer_response_note / updated_at
-- A decline now also requires a non-empty customer_response_note.
--
-- Discussion columns are NOT a direct UPDATE. They change only inside
-- portal_request_estimate_discussion after it sets the transaction-local GUC
-- app.allow_portal_discussion_mutation. That path cannot change status or
-- any commercial column.
--
-- Approval still uses app.allow_portal_approval_mutation from
-- record_estimate_approval_safe. This function does not grant a setter.
-- ---------------------------------------------------------------------------
create or replace function public.estimates_protect_portal_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_new jsonb;
  v_old jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Discussion RPC only. Narrower than the approval GUC: status and price stay put.
  if current_setting('app.allow_portal_discussion_mutation', true) = 'true' then
    if new.customer_id is distinct from old.customer_id
       or new.status is distinct from old.status then
      raise exception
        'PORTAL_ESTIMATE_FORBIDDEN: discussion cannot change ownership or status.'
        using errcode = 'P0001';
    end if;
    v_new := to_jsonb(new)
      - 'discussion_requested_at' - 'discussion_note' - 'updated_at';
    v_old := to_jsonb(old)
      - 'discussion_requested_at' - 'discussion_note' - 'updated_at';
    if v_new is distinct from v_old then
      raise exception
        'PORTAL_ESTIMATE_FORBIDDEN: discussion cannot change commercial estimate fields.'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if current_setting('app.allow_portal_approval_mutation', true) = 'true' then
    return new;
  end if;

  if public.accounting_is_service_role() then
    return new;
  end if;

  v_role := coalesce(public.user_role(auth.uid())::text, '');
  if v_role is distinct from 'customer' then
    return new;
  end if;

  if new.customer_id is distinct from old.customer_id then
    raise exception 'PORTAL_ESTIMATE_FORBIDDEN: cannot reassign this estimate.'
      using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'sent' and new.status in ('declined', 'changes_requested'))
      or (old.status = 'changes_requested' and new.status = 'declined')
    ) then
      raise exception
        'PORTAL_ESTIMATE_FORBIDDEN: customers cannot set that estimate status.'
        using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'declined'
     and nullif(btrim(coalesce(new.customer_response_note, '')), '') is null then
    raise exception
      'DECLINE_REASON_REQUIRED: a reason is required to decline an estimate.'
      using errcode = 'P0001';
  end if;

  v_new := to_jsonb(new) - 'status' - 'customer_response_note' - 'updated_at';
  v_old := to_jsonb(old) - 'status' - 'customer_response_note' - 'updated_at';
  if v_new is distinct from v_old then
    raise exception
      'PORTAL_ESTIMATE_FORBIDDEN: customers cannot change commercial estimate fields.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.estimates_protect_portal_columns() from public, anon, authenticated;
grant execute on function public.estimates_protect_portal_columns() to service_role;

comment on function public.estimates_protect_portal_columns() is
  'Portal JWT may decline (with a reason) or request changes, plus the response note. Discussion columns change only while app.allow_portal_discussion_mutation is set by portal_request_estimate_discussion. Approval commercial mutation stays on app.allow_portal_approval_mutation.';

create or replace function public.portal_request_estimate_discussion(
  p_estimate_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_customer uuid;
  v_est public.estimates%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_estimate_id is null then
    return jsonb_build_object(
      'ok', false, 'code', 'DISCUSSION_ARGS', 'error', 'estimate_id required.'
    );
  end if;
  if v_note is not null and length(v_note) > 2000 then
    return jsonb_build_object(
      'ok', false, 'code', 'DISCUSSION_NOTE', 'error', 'That note is too long.'
    );
  end if;
  if public.accounting_is_service_role() then
    return jsonb_build_object(
      'ok', false, 'code', 'DISCUSSION_SERVICE_ROLE',
      'error', 'Portal discussion cannot use service_role.'
    );
  end if;

  v_role := coalesce(public.user_role(v_uid)::text, '');
  if v_role is distinct from 'customer' then
    return jsonb_build_object(
      'ok', false, 'code', 'DISCUSSION_ROLE',
      'error', 'Only the customer can request a discussion.'
    );
  end if;

  v_customer := public.my_customer_id();
  if v_customer is null then
    return jsonb_build_object(
      'ok', false, 'code', 'DISCUSSION_CUSTOMER',
      'error', 'Your account is not linked to a customer profile.'
    );
  end if;

  select * into v_est from public.estimates where id = p_estimate_id;
  if not found or v_est.customer_id is distinct from v_customer then
    return jsonb_build_object(
      'ok', false, 'code', 'DISCUSSION_NOT_FOUND',
      'error', 'That estimate is not available.'
    );
  end if;
  if v_est.status not in ('sent', 'changes_requested') then
    return jsonb_build_object(
      'ok', false, 'code', 'DISCUSSION_STATUS',
      'error', 'This estimate is no longer open for a discussion request.'
    );
  end if;

  perform set_config('app.allow_portal_discussion_mutation', 'true', true);
  update public.estimates
     set discussion_requested_at = now(),
         discussion_note = v_note,
         updated_at = now()
   where id = p_estimate_id
     and customer_id = v_customer;
  perform set_config('app.allow_portal_discussion_mutation', 'false', true);

  return jsonb_build_object('ok', true, 'estimate_id', p_estimate_id);
end;
$$;

revoke all on function public.portal_request_estimate_discussion(uuid, text) from public, anon;
grant execute on function public.portal_request_estimate_discussion(uuid, text) to authenticated;

comment on function public.portal_request_estimate_discussion(uuid, text) is
  'Customer asks to discuss an open estimate. Does not approve, decline, or change the price. Sets discussion_requested_at under app.allow_portal_discussion_mutation.';
