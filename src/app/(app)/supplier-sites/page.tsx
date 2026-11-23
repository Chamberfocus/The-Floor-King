import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { listSupplierSiteOpens, listSupplierSites } from "@/lib/data/supplier-sites";
import { listSuppliers } from "@/lib/data/suppliers";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import {
  SUPPLIER_SITE_OPEN_ROLES,
  SUPPLIER_SITE_SAVE_ROLES,
  supplierSitePurpose,
  supplierVaultReady,
} from "@/lib/supplier-vault";
import { SupplierSitesPanel } from "./supplier-sites-panel";

export const metadata: Metadata = { title: "Supplier sites" };
export const dynamic = "force-dynamic";

export default async function SupplierSitesPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; purpose?: string }>;
}) {
  const profile = await requireRole([...SUPPLIER_SITE_OPEN_ROLES]);
  const query = await searchParams;
  const vendorId = query.vendor?.trim() ?? "";
  const purpose = supplierSitePurpose(query.purpose ?? "") ?? "";
  const canSave = (SUPPLIER_SITE_SAVE_ROLES as readonly string[]).includes(profile.role);
  const vaultReady = supplierVaultReady(process.env.SUPPLIER_VAULT_KEY);

  const [{ ready, sites }, suppliers] = await Promise.all([
    listSupplierSites(),
    listSuppliers(),
  ]);

  const vendor = suppliers.find((row) => row.id === vendorId) ?? null;
  const visible = sites.filter((site) => {
    if (vendor && site.supplierId !== vendor.id) return false;
    if (purpose && site.purpose !== purpose) return false;
    return true;
  });
  visible.sort((a, b) => {
    if (a.purpose !== b.purpose) return a.purpose === "order" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  let opens: { id: string; siteName: string; actorName: string; when: string }[] = [];
  if (canSave && ready) {
    const rows = await listSupplierSiteOpens(20);
    const names = new Map<string, string>();
    if (rows.length) {
      const supabase = await createClient();
      const ids = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => Boolean(id)))];
      if (ids.length) {
        const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        for (const person of data ?? []) {
          names.set(person.id as string, (person.full_name as string) || "Someone");
        }
      }
    }
    const siteNames = new Map(sites.map((site) => [site.id, site.name]));
    opens = rows.map((row) => ({
      id: row.id,
      siteName: siteNames.get(row.siteId) ?? "A supplier site",
      actorName: row.actorId ? names.get(row.actorId) ?? "Someone" : "Someone",
      when: formatDateTime(row.createdAt),
    }));
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Supplier sites"
        description="Ordering websites and the places you pay manufacturers and distributors. Open copies the password so you can paste it on their sign-in page."
      />

      {!ready ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          Supplier sites are not turned on yet. Apply migration{" "}
          <span className="font-medium">0516_supplier_site_vault.sql</span> in Supabase, then add each login here.
        </p>
      ) : null}

      {ready && !vaultReady ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          {canSave
            ? "Passwords stay off this page until SUPPLIER_VAULT_KEY is set on the server. You can still save the website and the username."
            : "Passwords are locked until the vault key is set. You can still open the website."}
        </p>
      ) : null}

      {ready && vaultReady ? (
        <p className="text-sm text-muted-foreground">
          {canSave
            ? "You save the password. You and the office can open the site. A password is encrypted, and it is not shown in this list. Salespeople never see this page."
            : "Open copies the password. You cannot change a saved password. That stays with the owner."}
        </p>
      ) : null}

      {vendor || purpose ? (
        <p className="text-sm text-muted-foreground">
          {vendor ? `Showing ${vendor.name}` : "Showing sites"}
          {purpose === "pay" ? " pay sites" : purpose === "order" ? " ordering sites" : ""}.{" "}
          <Link href="/supplier-sites" className="text-primary hover:underline">
            Show every site
          </Link>
        </p>
      ) : null}

      {ready ? (
        <SupplierSitesPanel
          sites={visible}
          suppliers={suppliers.map((row) => ({ id: row.id, name: row.name }))}
          canSave={canSave}
          vaultReady={vaultReady}
          presetVendor={vendor?.id ?? ""}
          presetPurpose={purpose}
          opens={opens}
        />
      ) : null}
    </div>
  );
}
