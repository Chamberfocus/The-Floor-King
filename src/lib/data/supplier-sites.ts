import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SUPPLIER_SITE_LIST_COLUMNS,
  supplierSiteTableMissing,
  type SupplierSitePurpose,
} from "@/lib/supplier-vault";

export interface SupplierSiteRow {
  id: string;
  supplierId: string | null;
  name: string;
  purpose: SupplierSitePurpose;
  siteUrl: string;
  username: string;
  hasSecret: boolean;
  updatedAt: string;
}

export interface SupplierSiteOpenRow {
  id: string;
  siteId: string;
  actorId: string | null;
  createdAt: string;
}

type SiteRecord = {
  id: string;
  supplier_id: string | null;
  name: string;
  purpose: string;
  site_url: string;
  username: string;
  has_secret: boolean;
  updated_at: string;
};

function asPurpose(value: string): SupplierSitePurpose {
  return value === "pay" ? "pay" : "order";
}

export function toSupplierSiteRow(row: SiteRecord): SupplierSiteRow {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    name: row.name,
    purpose: asPurpose(row.purpose),
    siteUrl: row.site_url,
    username: row.username ?? "",
    hasSecret: row.has_secret === true,
    updatedAt: row.updated_at,
  };
}

export async function listSupplierSites(): Promise<
  { ready: true; sites: SupplierSiteRow[] } | { ready: false; sites: [] }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_sites")
    .select(SUPPLIER_SITE_LIST_COLUMNS)
    .order("name", { ascending: true });
  if (error) {
    if (supplierSiteTableMissing(error.message)) return { ready: false, sites: [] };
    return { ready: true, sites: [] };
  }
  return { ready: true, sites: ((data ?? []) as SiteRecord[]).map(toSupplierSiteRow) };
}

export async function listSupplierSiteOpens(limit = 20): Promise<SupplierSiteOpenRow[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("supplier_site_opens")
      .select("id, site_id, actor_id, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((row) => ({
      id: row.id as string,
      siteId: row.site_id as string,
      actorId: (row.actor_id as string | null) ?? null,
      createdAt: row.created_at as string,
    }));
  } catch {
    return [];
  }
}
