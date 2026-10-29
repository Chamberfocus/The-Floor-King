import {
  mergeSupplierFact,
  storedFactFromRow,
  type SupplierItemFact,
} from "@/lib/supplier-facts";

/**
 * Save and read what a mill last said about an item.
 * Missing table must not take down a price import or a catalog search.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export interface MillFactFields {
  mill_available?: number | null;
  mill_uom?: string | null;
  mill_spec_url?: string | null;
  mill_width_ft?: number | null;
  mill_length_ft?: number | null;
  mill_description?: string | null;
  mill_checked_at?: string | null;
}

export function factsTableMissing(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("supplier_item_facts") &&
    (m.includes("does not exist") ||
      m.includes("could not find") ||
      m.includes("schema cache") ||
      m.includes("42p01") ||
      m.includes("pgrst205"))
  );
}

function skuKey(sku: string | null | undefined): string {
  return (sku ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function dedupeFacts(facts: SupplierItemFact[]): SupplierItemFact[] {
  const bySku = new Map<string, ReturnType<typeof mergeSupplierFact>>();
  for (const fact of facts) {
    const sku = fact.supplierSku.trim();
    if (!sku) continue;
    const key = skuKey(sku);
    const prev = bySku.get(key) ?? null;
    bySku.set(key, mergeSupplierFact(prev, { ...fact, supplierSku: sku }));
  }
  return [...bySku.values()].map((row) => ({
    supplierSku: row.supplier_sku,
    availableQty: row.available_qty,
    availableUom: row.available_uom,
    rollWidthFt: row.roll_width_ft,
    rollLengthFt: row.roll_length_ft,
    description: row.description,
    specUrl: row.spec_url,
    details: row.details,
  }));
}

/**
 * Upsert mill facts for one supplier.
 * An incoming null does not wipe a quantity, roll size, or spec link already stored.
 */
export async function saveSupplierItemFacts(
  db: Db,
  supplierId: string,
  facts: SupplierItemFact[],
): Promise<{ saved: number; error: string | null }> {
  const rows = dedupeFacts(facts);
  if (!rows.length) return { saved: 0, error: null };

  let saved = 0;
  const checkedAt = new Date().toISOString();
  try {
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const skus = chunk.map((row) => row.supplierSku);
      const { data, error: readError } = await db
        .from("supplier_item_facts")
        .select(
          "supplier_sku, available_qty, available_uom, roll_width_ft, roll_length_ft, description, spec_url, details",
        )
        .eq("supplier_id", supplierId)
        .in("supplier_sku", skus);
      if (readError) return { saved, error: readError.message as string };

      const existing = new Map<string, ReturnType<typeof storedFactFromRow>>();
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        const stored = storedFactFromRow(row);
        if (stored.supplier_sku) existing.set(skuKey(stored.supplier_sku), stored);
      }

      const payload = chunk.map((fact) => {
        const merged = mergeSupplierFact(existing.get(skuKey(fact.supplierSku)) ?? null, fact);
        return {
          supplier_id: supplierId,
          supplier_sku: merged.supplier_sku,
          available_qty: merged.available_qty,
          available_uom: merged.available_uom,
          roll_width_ft: merged.roll_width_ft,
          roll_length_ft: merged.roll_length_ft,
          description: merged.description,
          spec_url: merged.spec_url,
          details: merged.details,
          checked_at: checkedAt,
        };
      });

      const { error: writeError } = await db
        .from("supplier_item_facts")
        .upsert(payload, { onConflict: "supplier_id,supplier_sku" });
      if (writeError) return { saved, error: writeError.message as string };
      saved += payload.length;
    }
  } catch (err) {
    return { saved, error: err instanceof Error ? err.message : "Could not save supplier facts." };
  }
  return { saved, error: null };
}

/**
 * Attach the latest mill report onto catalog rows that are attributed to that supplier.
 * A missing table, or a role that cannot read the table, leaves the products unchanged.
 */
export async function attachMillFacts<
  T extends { sku?: string | null; supplier_id?: string | null },
>(db: Db, products: T[]): Promise<T[]> {
  if (!products.length) return products;
  const skus = [...new Set(products.map((p) => (p.sku ?? "").trim()).filter(Boolean))];
  if (!skus.length) return products;

  const byKey = new Map<string, Record<string, unknown>>();
  try {
    for (let i = 0; i < skus.length; i += 100) {
      const chunk = skus.slice(i, i + 100);
      const { data, error } = await db
        .from("supplier_item_facts")
        .select(
          "supplier_id, supplier_sku, available_qty, available_uom, roll_width_ft, roll_length_ft, description, spec_url, checked_at",
        )
        .in("supplier_sku", chunk);
      if (error) return products;
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        const supplierId = String(row.supplier_id ?? "");
        const sku = skuKey(String(row.supplier_sku ?? ""));
        if (!supplierId || !sku) continue;
        byKey.set(`${supplierId}|${sku}`, row);
      }
    }
  } catch {
    return products;
  }

  for (const product of products) {
    const supplierId = product.supplier_id ?? "";
    const sku = skuKey(product.sku);
    if (!supplierId || !sku) continue;
    const row = byKey.get(`${supplierId}|${sku}`);
    if (!row) continue;
    const stored = storedFactFromRow(row);
    const target = product as T & MillFactFields;
    target.mill_available = stored.available_qty;
    target.mill_uom = stored.available_uom;
    target.mill_spec_url = stored.spec_url;
    target.mill_width_ft = stored.roll_width_ft;
    target.mill_length_ft = stored.roll_length_ft;
    target.mill_description = stored.description;
    target.mill_checked_at = row.checked_at == null ? null : String(row.checked_at);
  }
  return products;
}
