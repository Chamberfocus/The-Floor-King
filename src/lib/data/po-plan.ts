import { createClient } from "@/lib/supabase/server";
import { lineQty, lineOrderQty } from "@/lib/estimate-calc";
import { isMaterialLine } from "@/lib/job-scope";
import {
  buildSupplierLookup,
  resolveLineSupplier,
  listActiveSuppliers,
} from "@/lib/data/suppliers";
import type { EstimateLineItem, Supplier } from "@/lib/types";

/** One material line as it appears on the ordering review. */
export interface OrderPlanLine {
  lineId: string;
  description: string;
  productId: string | null;
  qty: number;
  unit: string;
  unitCost: number;
  lineTotal: number;
  fromStock: boolean;
  category: string | null;
}

/** A company that will receive one PO (the lines it carries). */
export interface OrderPlanVendor {
  key: string;
  name: string;
  supplierId: string | null;
  hasExistingPo: boolean;
  existingPoId: string | null;
  existingPoDraft: boolean; // existing PO is still a draft → items append to it
  lines: OrderPlanLine[];
}

export interface EstimateOrderPlan {
  estimateId: string;
  customerId: string | null;
  vendors: OrderPlanVendor[]; // resolved-vendor groups
  unassigned: OrderPlanLine[]; // vendor unknown → user assigns a company
  fromStock: OrderPlanLine[]; // "pull from stock" lines, shown unchecked
  suppliers: Pick<Supplier, "id" | "name">[]; // for the assign-vendor dropdown
}

/**
 * Read every MATERIAL off an estimate and lay out the purchase orders it needs —
 * grouped by the company each material is ordered from — for a review-and-select
 * screen. Uses the SAME classifier as the staging sheet (isMaterialLine), so
 * labor and service "other" lines never reach a PO. This performs NO writes.
 */
export async function getEstimateOrderPlan(
  estimateId: string,
): Promise<EstimateOrderPlan> {
  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select("id, customer_id, accepted_option_id")
    .eq("id", estimateId)
    .maybeSingle();

  const empty: EstimateOrderPlan = {
    estimateId,
    customerId: (est?.customer_id as string | null) ?? null,
    vendors: [],
    unassigned: [],
    fromStock: [],
    suppliers: [],
  };
  if (!est) return empty;

  let optionId = (est.accepted_option_id as string | null) ?? null;
  if (!optionId) {
    const { data: opt } = await supabase
      .from("estimate_options")
      .select("id")
      .eq("estimate_id", estimateId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    optionId = (opt?.id as string) ?? null;
  }
  if (!optionId) return { ...empty, suppliers: await simpleSuppliers() };

  const { data: lineData } = await supabase
    .from("estimate_line_items")
    .select("*")
    .eq("option_id", optionId)
    .order("position", { ascending: true });
  const allLines = (lineData ?? []) as EstimateLineItem[];

  // Materials only (drops labor + service "other" lines), with a real quantity.
  const materials = allLines.filter(
    (l) => l.line_type !== "flat" && isMaterialLine(l) && lineQty(l) > 0,
  );

  // Product cost / name / supplier — same source as createPOFromEstimate.
  const productIds = [
    ...new Set(materials.map((l) => l.product_id).filter(Boolean) as string[]),
  ];
  const productCost = new Map<string, number>();
  const productName = new Map<string, string>();
  const productSupplier = new Map<string, string | null>();
  const productSupplierId = new Map<string, string | null>();
  if (productIds.length) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, material_rate, supplier, supplier_id")
      .in("id", productIds);
    for (const p of prods ?? []) {
      productCost.set(p.id as string, Number(p.material_rate) || 0);
      productName.set(p.id as string, (p.name as string) ?? "");
      productSupplier.set(p.id as string, (p.supplier as string) || null);
      productSupplierId.set(p.id as string, (p.supplier_id as string) || null);
    }
  }

  const lookup = await buildSupplierLookup(supabase);

  // Which vendors already have a PO for this estimate (per-vendor duplicate
  // guard — po_items has no line_id, so we can't guard per line).
  const { data: existingPos } = await supabase
    .from("purchase_orders")
    .select("id, supplier_id, supplier, status")
    .eq("estimate_id", estimateId);
  const poBySupplierId = new Map<string, { id: string; draft: boolean }>();
  const poBySupplierName = new Map<string, { id: string; draft: boolean }>();
  for (const p of existingPos ?? []) {
    const rec = { id: p.id as string, draft: p.status === "draft" };
    if (p.supplier_id) poBySupplierId.set(p.supplier_id as string, rec);
    if (p.supplier)
      poBySupplierName.set((p.supplier as string).trim().toLowerCase(), rec);
  }

  const costOf = (l: EstimateLineItem) =>
    (l.material_cost ?? 0) > 0
      ? (l.material_cost as number)
      : l.product_id
        ? (productCost.get(l.product_id) ?? 0)
        : 0;
  const nameOf = (l: EstimateLineItem) =>
    l.description ||
    (l.product_id ? productName.get(l.product_id) : null) ||
    l.room ||
    "Material";
  const toPlanLine = (l: EstimateLineItem): OrderPlanLine => {
    // Waste included: this is what gets BOUGHT, and it has to match what the
    // customer is billed for or the crew turns up short.
    const qty = Math.round(lineOrderQty(l) * 100) / 100;
    const unitCost = costOf(l);
    return {
      lineId: l.id,
      description: nameOf(l),
      productId: l.product_id ?? null,
      qty,
      unit: l.unit || (l.measure_unit === "sqyd" ? "sqyd" : "sqft"),
      unitCost,
      lineTotal: Math.round(qty * unitCost * 100) / 100,
      fromStock: !!l.from_stock,
      category: l.category ?? null,
    };
  };

  const vendors = new Map<string, OrderPlanVendor>();
  const unassigned: OrderPlanLine[] = [];
  const fromStock: OrderPlanLine[] = [];

  for (const l of materials) {
    const planLine = toPlanLine(l);
    if (l.from_stock) {
      fromStock.push(planLine);
      continue;
    }
    const resolved = resolveLineSupplier(lookup, {
      productSupplierId: l.product_id ? productSupplierId.get(l.product_id) : null,
      supplierName:
        (l.product_id ? productSupplier.get(l.product_id) : null) ||
        l.manufacturer ||
        null,
    });
    if (!resolved.ref) {
      unassigned.push(planLine);
      continue;
    }
    const existing =
      poBySupplierId.get(resolved.ref.id) ??
      poBySupplierName.get(resolved.name.trim().toLowerCase()) ??
      null;
    const g =
      vendors.get(resolved.key) ??
      ({
        key: resolved.key,
        name: resolved.name,
        supplierId: resolved.ref.id,
        hasExistingPo: !!existing,
        existingPoId: existing?.id ?? null,
        existingPoDraft: existing?.draft ?? false,
        lines: [],
      } satisfies OrderPlanVendor);
    g.lines.push(planLine);
    vendors.set(resolved.key, g);
  }

  return {
    estimateId,
    customerId: (est.customer_id as string | null) ?? null,
    vendors: [...vendors.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unassigned,
    fromStock,
    suppliers: await simpleSuppliers(),
  };
}

async function simpleSuppliers(): Promise<Pick<Supplier, "id" | "name">[]> {
  const all = await listActiveSuppliers();
  return all
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
