-- Supplier sites stay with the owner. The owner signs in as admin.
-- Office, salespeople, installers, and the warehouse cannot read these rows.
-- Safe to run after 0516. If 0516 has not been applied yet, this does nothing.

do $$
begin
  if to_regclass('public.supplier_sites') is null then
    return;
  end if;

  drop policy if exists supplier_sites_select on public.supplier_sites;
  create policy supplier_sites_select on public.supplier_sites
    for select to authenticated
    using (public.user_role(auth.uid())::text = 'admin');
end $$;
