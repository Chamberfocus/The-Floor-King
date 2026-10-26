-- Salespeople save the estimates they own. Office and sales managers save any.
-- Crew, warehouse, scheduler, and customers stay out.
-- Does not enable accounting. Does not change posting.

create or replace function public.apply_estimate_option_lines(
  p_option_id uuid,
  p_updates jsonb,
  p_inserts jsonb,
  p_delete_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  upd jsonb;
  ins jsonb;
  del_id uuid;
  row_id uuid;
  n_upd int := 0;
  n_ins int := 0;
  n_del int := 0;
  owned int;
begin
  -- Office, a sales manager, or the salesperson on this customer.
  -- The function bypasses row security, so this check is the lock.
  if not (
    public.is_staff()
    or public.my_role() = 'sales_manager'
    or (public.my_role() = 'salesman' and public.mine_option(p_option_id))
  ) then
    raise exception 'not authorized';
  end if;

  if p_option_id is null then
    raise exception 'option_id required';
  end if;

  -- Deletes first within the same transaction (FK stock SET NULL as today).
  if p_delete_ids is not null then
    foreach del_id in array p_delete_ids loop
      select count(*) into owned
        from public.estimate_line_items
       where id = del_id and option_id = p_option_id;
      if owned = 0 then
        raise exception 'line id does not belong to option';
      end if;
      delete from public.estimate_line_items
       where id = del_id and option_id = p_option_id;
      n_del := n_del + 1;
    end loop;
  end if;

  if p_updates is not null then
    for upd in select * from jsonb_array_elements(p_updates) loop
      row_id := nullif(upd->>'id', '')::uuid;
      if row_id is null then
        raise exception 'update missing id';
      end if;
      select count(*) into owned
        from public.estimate_line_items
       where id = row_id and option_id = p_option_id;
      if owned = 0 then
        raise exception 'line id does not belong to option';
      end if;

      update public.estimate_line_items set
        position               = coalesce((upd->'row'->>'position')::int, position),
        room                   = nullif(upd->'row'->>'room', ''),
        description            = coalesce(upd->'row'->>'description', description),
        note                   = nullif(upd->'row'->>'note', ''),
        line_type              = coalesce((upd->'row'->>'line_type')::public.line_type, line_type),
        category               = case
                                   when upd->'row' ? 'category' and nullif(upd->'row'->>'category','') is null then null
                                   when nullif(upd->'row'->>'category','') is not null
                                     then (upd->'row'->>'category')::public.product_category
                                   else category
                                 end,
        sqft                   = nullif(upd->'row'->>'sqft', '')::numeric,
        length_in              = nullif(upd->'row'->>'length_in', '')::numeric,
        width_in               = nullif(upd->'row'->>'width_in', '')::numeric,
        measure_unit           = coalesce(nullif(upd->'row'->>'measure_unit', ''), measure_unit),
        material_rate          = nullif(upd->'row'->>'material_rate', '')::numeric,
        labor_rate             = nullif(upd->'row'->>'labor_rate', '')::numeric,
        installed_rate         = nullif(upd->'row'->>'installed_rate', '')::numeric,
        flat_amount            = nullif(upd->'row'->>'flat_amount', '')::numeric,
        waste_pct              = coalesce(nullif(upd->'row'->>'waste_pct', '')::numeric, 0),
        product_id             = nullif(upd->'row'->>'product_id', '')::uuid,
        manufacturer           = nullif(upd->'row'->>'manufacturer', ''),
        style                  = nullif(upd->'row'->>'style', ''),
        color                  = nullif(upd->'row'->>'color', ''),
        item_no                = nullif(upd->'row'->>'item_no', ''),
        material_cost          = nullif(upd->'row'->>'material_cost', '')::numeric,
        labor_cost             = nullif(upd->'row'->>'labor_cost', '')::numeric,
        quantity               = nullif(upd->'row'->>'quantity', '')::numeric,
        unit                   = nullif(upd->'row'->>'unit', ''),
        from_stock             = coalesce((upd->'row'->>'from_stock')::boolean, false),
        margin_pct             = nullif(upd->'row'->>'margin_pct', '')::numeric,
        order_as_roll          = coalesce((upd->'row'->>'order_as_roll')::boolean, false),
        roll_width_ft          = nullif(upd->'row'->>'roll_width_ft', '')::numeric,
        sqft_per_box           = nullif(upd->'row'->>'sqft_per_box', '')::numeric,
        is_fill                = coalesce((upd->'row'->>'is_fill')::boolean, false),
        is_optional            = coalesce((upd->'row'->>'is_optional')::boolean, false),
        coverage_sqft          = nullif(upd->'row'->>'coverage_sqft', '')::numeric,
        coverage_thickness_in  = nullif(upd->'row'->>'coverage_thickness_in', '')::numeric,
        prep_thickness_in      = nullif(upd->'row'->>'prep_thickness_in', '')::numeric,
        prep_key               = nullif(upd->'row'->>'prep_key', ''),
        measurements           = case
                                   when upd->'row'->'measurements' is null then null
                                   when jsonb_typeof(upd->'row'->'measurements') = 'null' then null
                                   else upd->'row'->'measurements'
                                 end
      where id = row_id and option_id = p_option_id;
      n_upd := n_upd + 1;
    end loop;
  end if;

  if p_inserts is not null then
    for ins in select * from jsonb_array_elements(p_inserts) loop
      insert into public.estimate_line_items (
        option_id, position, room, description, note, line_type, category,
        sqft, length_in, width_in, measure_unit,
        material_rate, labor_rate, installed_rate, flat_amount, waste_pct,
        product_id, manufacturer, style, color, item_no,
        material_cost, labor_cost, quantity, unit, from_stock, margin_pct,
        order_as_roll, roll_width_ft, sqft_per_box, is_fill, is_optional,
        coverage_sqft, coverage_thickness_in, prep_thickness_in, prep_key,
        measurements
      ) values (
        p_option_id,
        coalesce((ins->>'position')::int, 0),
        nullif(ins->>'room', ''),
        coalesce(ins->>'description', ''),
        nullif(ins->>'note', ''),
        coalesce((ins->>'line_type')::public.line_type, 'mat_labor'),
        case
          when nullif(ins->>'category', '') is null then null
          else (ins->>'category')::public.product_category
        end,
        nullif(ins->>'sqft', '')::numeric,
        nullif(ins->>'length_in', '')::numeric,
        nullif(ins->>'width_in', '')::numeric,
        coalesce(nullif(ins->>'measure_unit', ''), 'sqft'),
        nullif(ins->>'material_rate', '')::numeric,
        nullif(ins->>'labor_rate', '')::numeric,
        nullif(ins->>'installed_rate', '')::numeric,
        nullif(ins->>'flat_amount', '')::numeric,
        coalesce(nullif(ins->>'waste_pct', '')::numeric, 0),
        nullif(ins->>'product_id', '')::uuid,
        nullif(ins->>'manufacturer', ''),
        nullif(ins->>'style', ''),
        nullif(ins->>'color', ''),
        nullif(ins->>'item_no', ''),
        nullif(ins->>'material_cost', '')::numeric,
        nullif(ins->>'labor_cost', '')::numeric,
        nullif(ins->>'quantity', '')::numeric,
        nullif(ins->>'unit', ''),
        coalesce((ins->>'from_stock')::boolean, false),
        nullif(ins->>'margin_pct', '')::numeric,
        coalesce((ins->>'order_as_roll')::boolean, false),
        nullif(ins->>'roll_width_ft', '')::numeric,
        nullif(ins->>'sqft_per_box', '')::numeric,
        coalesce((ins->>'is_fill')::boolean, false),
        coalesce((ins->>'is_optional')::boolean, false),
        nullif(ins->>'coverage_sqft', '')::numeric,
        nullif(ins->>'coverage_thickness_in', '')::numeric,
        nullif(ins->>'prep_thickness_in', '')::numeric,
        nullif(ins->>'prep_key', ''),
        case
          when ins->'measurements' is null then null
          when jsonb_typeof(ins->'measurements') = 'null' then null
          else ins->'measurements'
        end
      );
      n_ins := n_ins + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'updated', n_upd,
    'inserted', n_ins,
    'deleted', n_del
  );
end;
$$;

revoke all on function public.apply_estimate_option_lines(uuid, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.apply_estimate_option_lines(uuid, jsonb, jsonb, uuid[]) to authenticated;

-- The builder autosave is a draft only. The estimate itself is unchanged until Save.
-- Office already has ebd_staff. A sales manager saves any draft. A salesperson
-- saves the draft on a customer assigned to them. Scheduler, crew, warehouse,
-- and customers stay out.
drop policy if exists ebd_sales_own on public.estimate_builder_drafts;
create policy ebd_sales_own on public.estimate_builder_drafts
  for all to authenticated
  using (
    public.my_role() = 'sales_manager'
    or (
      public.my_role() = 'salesman'
      and public.mine_estimate(estimate_id)
    )
  )
  with check (
    public.my_role() = 'sales_manager'
    or (
      public.my_role() = 'salesman'
      and public.mine_estimate(estimate_id)
    )
  );

-- Vendor cost is the price the quote uses when it is recorded. Sales reads it.
-- Writing a vendor cost stays with the office (product_vendors_staff).
drop policy if exists product_vendors_sales_read on public.product_vendors;
create policy product_vendors_sales_read on public.product_vendors
  for select to authenticated
  using (public.my_role() in ('sales_manager', 'salesman'));
