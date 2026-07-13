"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/auth";
import { searchCatalog } from "@/lib/data/products";
import type { Product, ProductCategory } from "@/lib/types";

/** Live catalog search for the estimate material picker (active products). */
export async function searchCatalogProducts(query: string): Promise<Product[]> {
  return searchCatalog(query, { activeOnly: true, limit: 40 });
}

export interface ProductFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function money(v: FormDataEntryValue | null): number {
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : 0;
}

function readFields(formData: FormData) {
  return {
    name: str(formData.get("name")),
    category: (str(formData.get("category")) || "other") as ProductCategory,
    unit: str(formData.get("unit")) || "sqft",
    material_rate: money(formData.get("material_rate")),
    labor_rate: money(formData.get("labor_rate")),
    sku: str(formData.get("sku")) || null,
    manufacturer: str(formData.get("manufacturer")) || null,
    style: str(formData.get("style")) || null,
    color: str(formData.get("color")) || null,
    supplier: str(formData.get("supplier")) || null,
    notes: str(formData.get("notes")) || null,
    // Vendor-unit helpers (auto-fill onto a PO): hard-surface carton coverage +
    // carpet broadloom width.
    sqft_per_box: (() => { const n = parseFloat(str(formData.get("sqft_per_box"))); return Number.isFinite(n) && n > 0 ? n : null; })(),
    roll_width_ft: (() => { const n = parseFloat(str(formData.get("roll_width_ft"))); return Number.isFinite(n) && n > 0 ? n : null; })(),
  };
}

export async function createProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const fields = readFields(formData);
  if (!fields.name) return { error: "A product name is required." };

  const supabase = await createClient();
  let { error } = await supabase.from("products").insert(fields);
  if (error) {
    // Fallback for before the catalog vendor-unit migration (0099) is run.
    const { sqft_per_box: _s, roll_width_ft: _r, ...legacy } = fields;
    ({ error } = await supabase.from("products").insert(legacy));
  }
  if (error) return { error: error.message };

  revalidatePath("/catalog");
  redirect("/catalog");
}

/**
 * Create a product and return it — used by the estimate wizard's "add new
 * product" so a material entered on a line is saved to the catalog and linked.
 */
export async function createProductInline(input: {
  name: string;
  category?: string;
  unit?: string;
  material_rate?: number | string;
  labor_rate?: number | string;
  sku?: string;
  manufacturer?: string;
  style?: string;
  color?: string;
}): Promise<{ error: string | null; product?: Product }> {
  const name = input.name?.trim();
  if (!name) return { error: "A product name is required." };

  // Salespeople build estimates and must be able to add an off-catalog product
  // on the fly — but the catalog is read-only for them under RLS. Verify the
  // caller is an estimate-builder role, then write with the service role (the
  // same elevate-after-check pattern used across the app).
  try {
    await assertRole(["admin", "office", "sales_manager", "salesman"]);
  } catch {
    return { error: "You don't have permission to add catalog products." };
  }

  const numOr0 = (v: number | string | undefined) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : 0;
  };

  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    return { error: "Catalog isn't configured on the server." };
  }
  const { data, error } = await supabase
    .from("products")
    .insert({
      name,
      category: (input.category || "other") as ProductCategory,
      unit: input.unit?.trim() || "sqft",
      material_rate: numOr0(input.material_rate),
      labor_rate: numOr0(input.labor_rate),
      sku: input.sku?.trim() || null,
      manufacturer: input.manufacturer?.trim() || null,
      style: input.style?.trim() || null,
      color: input.color?.trim() || null,
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/catalog");
  return { error: null, product: data as Product };
}

export async function updateProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing product id." };
  const fields = readFields(formData);
  if (!fields.name) return { error: "A product name is required." };

  const supabase = await createClient();
  const active = str(formData.get("active")) === "on";
  let { error } = await supabase
    .from("products")
    .update({ ...fields, active })
    .eq("id", id);
  if (error) {
    // Fallback for before the catalog vendor-unit migration (0099) is run.
    const { sqft_per_box: _s, roll_width_ft: _r, ...legacy } = fields;
    ({ error } = await supabase
      .from("products")
      .update({ ...legacy, active })
      .eq("id", id));
  }
  if (error) return { error: error.message };

  revalidatePath("/catalog");
  revalidatePath("/inventory");
  return { error: null, ok: true };
}

type DedupeRow = {
  id: string;
  name: string | null;
  sku: string | null;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  on_hand: number | null;
  reserved: number | null;
  notes: string | null;
  supplier: string | null;
  created_at: string;
};

const dedupeNorm = (v: string | null) =>
  (v ?? "").toString().normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dedupeTight = (v: string | null) => dedupeNorm(v).replace(/\s+/g, "");
/** A SKU we trust as an identity: ≥3 chars, alphanumeric, not all one char. */
function trustySku(sku: string | null): string {
  const s = dedupeTight(sku);
  return s.length >= 3 && /[a-z0-9]/.test(s) && !/^(.)\1*$/.test(s) ? s : "";
}
/** The duplicate signature: same SKU = same product; else same normalized name. */
function dedupeSignature(r: DedupeRow): string | null {
  const sku = trustySku(r.sku);
  if (sku) return `s:${sku}`;
  const name = dedupeNorm(r.name);
  return name ? `n:${name}` : null;
}
/** How "complete" a record is — the keeper should be the richest one. */
function dedupeScore(r: DedupeRow): number {
  return [r.sku, r.manufacturer, r.style, r.color, r.notes, r.supplier].filter(
    (v) => (v ?? "").toString().trim(),
  ).length;
}

/**
 * Intelligently merge duplicate products. Two products are the same item when
 * they share a trustworthy SKU, or (failing that) the same normalized name —
 * so re-imported lists collapse even if a manufacturer/color was entered
 * differently. For each set we keep ONE record (the one with stock, then the
 * most complete, then the oldest), fold the others' inventory into it, re-point
 * any estimate/PO lines at the keeper so nothing loses its link, then delete
 * the extras. Runs with the service-role client and reports the REAL number
 * removed (the old tool counted attempts, so it claimed success even when RLS
 * silently blocked the delete).
 */
export async function dedupeProducts(): Promise<{
  error: string | null;
  removed?: number;
  groups?: number;
}> {
  try {
    await assertRole(["admin", "office", "sales_manager"]);
  } catch {
    return { error: "You don't have permission to clean up the catalog." };
  }
  const admin = createAdminClient();

  // Page through the WHOLE catalog (Supabase caps a select at 1000 rows).
  const all: DedupeRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("products")
      .select(
        "id, name, sku, manufacturer, style, color, on_hand, reserved, notes, supplier, created_at",
      )
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) return { error: error.message };
    const batch = (data ?? []) as DedupeRow[];
    all.push(...batch);
    if (batch.length < 1000) break;
  }

  // Group by signature (rows already oldest-first, so the first seen is oldest).
  const groups = new Map<string, DedupeRow[]>();
  for (const r of all) {
    const key = dedupeSignature(r);
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  // For each duplicate set: pick the keeper, fold stock, re-point references.
  const dupIds: string[] = [];
  let mergedGroups = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    mergedGroups += 1;

    const keeper = rows.reduce((best, r) => {
      const bStock = (Number(best.on_hand) || 0) + (Number(best.reserved) || 0);
      const rStock = (Number(r.on_hand) || 0) + (Number(r.reserved) || 0);
      if (rStock !== bStock) return rStock > bStock ? r : best;
      const bs = dedupeScore(best);
      const rs = dedupeScore(r);
      if (rs !== bs) return rs > bs ? r : best;
      return best; // tie → keep the earlier (oldest) record
    });

    const groupDupIds: string[] = [];
    let foldOnHand = 0;
    let foldReserved = 0;
    for (const r of rows) {
      if (r.id === keeper.id) continue;
      groupDupIds.push(r.id);
      foldOnHand += Number(r.on_hand) || 0;
      foldReserved += Number(r.reserved) || 0;
    }
    if (!groupDupIds.length) continue;

    // Preserve inventory: roll the duplicates' stock into the keeper.
    if (foldOnHand || foldReserved) {
      await admin
        .from("products")
        .update({
          on_hand: (Number(keeper.on_hand) || 0) + foldOnHand,
          reserved: (Number(keeper.reserved) || 0) + foldReserved,
        })
        .eq("id", keeper.id);
    }

    // Keep estimates & POs linked: move their lines to the keeper before delete
    // (the FK is ON DELETE SET NULL, so without this they'd lose the product).
    await admin
      .from("estimate_line_items")
      .update({ product_id: keeper.id })
      .in("product_id", groupDupIds);
    await admin
      .from("po_items")
      .update({ product_id: keeper.id })
      .in("product_id", groupDupIds);

    dupIds.push(...groupDupIds);
  }

  if (!dupIds.length) return { error: null, removed: 0, groups: 0 };

  // Delete the extras and COUNT WHAT ACTUALLY WENT (via .select()).
  let removed = 0;
  for (let i = 0; i < dupIds.length; i += 200) {
    const batch = dupIds.slice(i, i + 200);
    const { data, error } = await admin
      .from("products")
      .delete()
      .in("id", batch)
      .select("id");
    if (error) return { error: error.message, removed };
    removed += data?.length ?? 0;
  }

  revalidatePath("/catalog");
  revalidatePath("/inventory");
  return { error: null, removed, groups: mergedGroups };
}

/** Delete every product (estimate lines keep their copied prices). */
export async function clearCatalog(): Promise<{
  error: string | null;
  removed?: number;
}> {
  try {
    await assertRole(["admin", "office", "sales_manager"]);
  } catch {
    return { error: "You don't have permission to clear the catalog." };
  }
  const admin = createAdminClient();
  // Delete in batches and count what actually went, so the result is truthful
  // even on a large catalog.
  let removed = 0;
  for (;;) {
    const { data: ids, error: selErr } = await admin
      .from("products")
      .select("id")
      .limit(1000);
    if (selErr) return { error: selErr.message, removed };
    const batch = (ids ?? []).map((r) => r.id as string);
    if (!batch.length) break;
    const { data, error } = await admin
      .from("products")
      .delete()
      .in("id", batch)
      .select("id");
    if (error) return { error: error.message, removed };
    removed += data?.length ?? 0;
    if ((data?.length ?? 0) < batch.length) break; // nothing more deletable
  }
  revalidatePath("/catalog");
  revalidatePath("/inventory");
  return { error: null, removed };
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("products").delete().eq("id", id);
  revalidatePath("/catalog");
  redirect("/catalog");
}
