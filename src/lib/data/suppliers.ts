import { createClient } from "@/lib/supabase/server";
import type { Supplier, SupplierKind } from "@/lib/types";

type DB = Awaited<ReturnType<typeof createClient>>;

export async function listSuppliers(): Promise<Supplier[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("*")
    .order("name", { ascending: true });
  return (data ?? []) as Supplier[];
}

export interface SupplierRef {
  id: string;
  name: string;
  kind: SupplierKind;
}

export interface SupplierLookup {
  byName: Map<string, SupplierRef>;
  byId: Map<string, SupplierRef>;
}

/**
 * One place to turn a vendor name or a product's supplier_id into a real
 * supplier row (with its Manufacturer/Distributor type). Used wherever POs are
 * created so they group by vendor and carry the right source type instead of
 * trusting free-text spelling. Accepts any Supabase client (RLS or admin).
 */
export async function buildSupplierLookup(db: DB): Promise<SupplierLookup> {
  const { data } = await db.from("suppliers").select("id, name, kind");
  const byName = new Map<string, SupplierRef>();
  const byId = new Map<string, SupplierRef>();
  for (const s of data ?? []) {
    const ref: SupplierRef = {
      id: s.id as string,
      name: (s.name as string) ?? "",
      kind: (s.kind as SupplierKind) ?? "distributor",
    };
    byId.set(ref.id, ref);
    if (ref.name) byName.set(ref.name.trim().toLowerCase(), ref);
  }
  return { byName, byId };
}

/**
 * Resolve the supplier for a material line given its linked product's
 * supplier_id / supplier text and the line's own manufacturer fallback.
 * Returns a stable grouping key, the display name, and the resolved ref.
 */
export function resolveLineSupplier(
  lookup: SupplierLookup,
  opts: { productSupplierId?: string | null; supplierName?: string | null },
): { key: string; name: string; ref: SupplierRef | null } {
  let ref: SupplierRef | null = null;
  if (opts.productSupplierId) ref = lookup.byId.get(opts.productSupplierId) ?? null;
  const name = (opts.supplierName ?? "").trim();
  if (!ref && name) ref = lookup.byName.get(name.toLowerCase()) ?? null;
  if (ref) return { key: `id:${ref.id}`, name: ref.name, ref };
  const fallback = name || "Special order";
  return { key: `name:${fallback.toLowerCase()}`, name: fallback, ref: null };
}
