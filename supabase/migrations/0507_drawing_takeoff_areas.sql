-- A salesperson can save the rooms read off their job drawing.
-- Office and admin already write customer_areas through ca_staff_all.
-- A salesman writes only their own customers. A sales manager writes any customer.
-- Does not change prices, inventory, or accounting.

drop policy if exists ca_sales_write on public.customer_areas;
create policy ca_sales_write on public.customer_areas
  for all to authenticated
  using (
    public.my_role() = 'sales_manager'
    or (
      public.my_role() = 'salesman'
      and public.mine_customer(customer_areas.customer_id)
    )
  )
  with check (
    public.my_role() = 'sales_manager'
    or (
      public.my_role() = 'salesman'
      and public.mine_customer(customer_areas.customer_id)
    )
  );
