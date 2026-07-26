import { createClient } from "@/lib/supabase/server";
import { lineQty, type CalcLine } from "@/lib/estimate-calc";
import type { LineMeasurement } from "@/lib/types";

export type MaterialSource = "stock" | "order";

export interface JobMaterialLine {
  lineId: string;
  room: string | null;
  description: string;
  productId: string | null;
  productName: string | null;
  supplier: string | null; // vendor we order it from (for the PO)
  manufacturer: string | null;
  color: string | null;
  category: string | null;
  sqftPerBox: number | null; // hard surface: coverage per carton (for box count)
  rollWidthFt: number | null; // carpet: broadloom width for the roll
  orderAsRoll: boolean; // carpet: order a full roll vs cut pieces
  isFill: boolean; // carpet: a fill / seam piece cut for an area
  lengthIn: number | null; // cut measurements to order (carpet especially)
  widthIn: number | null;
  measurements: LineMeasurement[] | null; // first-class measured pieces / cuts
  qty: number; // quantity needed for the job
  unit: string;
  trackStock: boolean;
  onHand: number;
  available: number; // on_hand − reserved (across all jobs)
  unitCost: number; // our cost per unit (products.material_rate)
  source: MaterialSource | null; // explicit choice, or null = auto
  resolvedSource: MaterialSource; // what we'll actually do
  reservedQty: number; // reserved for THIS line
  pulledQty: number; // already pulled for THIS line
  status:
    | "order" // special-order → PO, not yet received
    | "arrived" // special-order whose PO has been received (material is in)
    | "short" // from stock but not enough on hand
    | "to_reserve" // from stock, nothing reserved yet
    | "reserved" // reserved, waiting to pull
    | "pulled"; // pulled from stock
}

export interface JobMaterials {
  jobId: string;
  estimateId: string | null;
  lines: JobMaterialLine[];
  hasStock: boolean;
  hasOrder: boolean;
  hasPO: boolean;
  /** All ordered lines have arrived (their POs are received). Drives the
   *  job/warehouse "Materials arrived" state + the pipeline stage advance. */
  materialsArrived: boolean;
}

type RawLine = CalcLine & {
  id: string;
  room: string | null;
  description: string;
  product_id: string | null;
  source: string | null;
  from_stock: boolean | null; // estimate said "pull from stock" → not on the PO
  unit: string | null;
  category: string | null;
  length_in: number | null;
  width_in: number | null;
  manufacturer: string | null;
  color: string | null;
  sqft_per_box: number | null;
  roll_width_ft: number | null;
  order_as_roll: boolean | null;
  is_fill: boolean | null;
  measurements: LineMeasurement[] | null;
};

export async function getJobMaterials(
  jobId: string,
  dbArg?: Awaited<ReturnType<typeof createClient>>,
): Promise<JobMaterials> {
  // Accept an elevated client so prep can run from a customer's portal-approval.
  const supabase = dbArg ?? (await createClient());
  const { data: job } = await supabase
    .from("jobs")
    .select("option_id, estimate_id")
    .eq("id", jobId)
    .maybeSingle();

  const empty: JobMaterials = {
    jobId,
    estimateId: (job?.estimate_id as string) ?? null,
    lines: [],
    hasStock: false,
    hasOrder: false,
    hasPO: false,
    materialsArrived: false,
  };
  if (!job?.option_id) return empty;

  const { data: lineData } = await supabase
    .from("estimate_line_items")
    .select("*")
    .eq("option_id", job.option_id as string)
    .neq("line_type", "flat")
    .neq("category", "labor") // labor (install, tear-out, prep) isn't material
    .order("position", { ascending: true });
  const lines = (lineData ?? []) as RawLine[];
  if (!lines.length) return empty;

  // Which ordered lines have their PO received (the material is physically in)?
  // po_items.line_id links back to this job's estimate line.
  const lineIds = lines.map((l) => l.id);
  const arrivedLineIds = new Set<string>();
  if (lineIds.length) {
    const { data: poRows } = await supabase
      .from("po_items")
      .select("line_id, po:purchase_orders(status)")
      .in("line_id", lineIds);
    for (const r of (poRows ?? []) as {
      line_id: string | null;
      po?: { status: string } | { status: string }[] | null;
    }[]) {
      const po = Array.isArray(r.po) ? r.po[0] : r.po;
      if (r.line_id && po?.status === "received") arrivedLineIds.add(r.line_id);
    }
  }

  const productIds = [
    ...new Set(lines.map((l) => l.product_id).filter(Boolean)),
  ] as string[];
  const prodById = new Map<
    string,
    { name: string; track_stock: boolean; on_hand: number; reserved: number; material_rate: number; supplier: string | null; category: string | null }
  >();
  if (productIds.length) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, track_stock, on_hand, reserved, material_rate, supplier, category")
      .in("id", productIds);
    for (const p of prods ?? []) {
      prodById.set(p.id as string, {
        name: (p.name as string) ?? "",
        track_stock: Boolean(p.track_stock),
        on_hand: Number(p.on_hand) || 0,
        reserved: Number(p.reserved) || 0,
        material_rate: Number(p.material_rate) || 0,
        supplier: (p.supplier as string) || null,
        category: (p.category as string) || null,
      });
    }
  }

  // Movements for this job, to compute per-line reserved / pulled.
  const { data: movData } = await supabase
    .from("stock_movements")
    .select("line_id, kind, qty")
    .eq("job_id", jobId);
  const reservedByLine = new Map<string, number>();
  const pulledByLine = new Map<string, number>();
  for (const m of movData ?? []) {
    const lid = m.line_id as string | null;
    if (!lid) continue;
    const q = Number(m.qty) || 0;
    if (m.kind === "reserve") {
      reservedByLine.set(lid, (reservedByLine.get(lid) ?? 0) + q);
    } else if (m.kind === "release") {
      reservedByLine.set(lid, (reservedByLine.get(lid) ?? 0) + q); // release qty is negative
    } else if (m.kind === "pull") {
      pulledByLine.set(lid, (pulledByLine.get(lid) ?? 0) + Math.abs(q));
    }
  }

  // Is there already a PO for this estimate?
  let hasPO = false;
  if (job.estimate_id) {
    const { count } = await supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("estimate_id", job.estimate_id as string);
    hasPO = (count ?? 0) > 0;
  }

  const out: JobMaterialLine[] = lines.map((l) => {
    const qty = Math.round(lineQty(l) * 100) / 100;
    const p = l.product_id ? prodById.get(l.product_id) : undefined;
    const onHand = p?.on_hand ?? 0;
    const reservedGlobal = p?.reserved ?? 0;
    const available = Math.round((onHand - reservedGlobal) * 100) / 100;
    const reservedQty = Math.max(0, pulledByLine.has(l.id) || reservedByLine.has(l.id)
      ? (reservedByLine.get(l.id) ?? 0) - (pulledByLine.get(l.id) ?? 0)
      : 0);
    const pulledQty = pulledByLine.get(l.id) ?? 0;

    const explicit = (l.source === "stock" || l.source === "order"
      ? l.source
      : null) as MaterialSource | null;
    // Auto: if it's a stock-tracked product with enough on hand, sell from stock.
    const canStock = Boolean(p?.track_stock);
    // "Pull from stock" on the estimate is authoritative — it's off the PO, so
    // the warehouse view must treat it as stock too (keeps sourcing consistent).
    const resolvedSource: MaterialSource = l.from_stock
      ? "stock"
      : explicit ?? (canStock ? "stock" : "order");

    let status: JobMaterialLine["status"];
    if (resolvedSource === "order")
      status = arrivedLineIds.has(l.id) ? "arrived" : "order";
    else if (pulledQty >= qty - 0.001 && qty > 0) status = "pulled";
    else if (reservedQty >= qty - 0.001 && qty > 0) status = "reserved";
    else if (available + reservedQty + pulledQty < qty) status = "short";
    else status = "to_reserve";

    return {
      lineId: l.id,
      room: l.room,
      description: l.description,
      productId: l.product_id,
      productName: p?.name ?? null,
      supplier: p?.supplier ?? l.manufacturer ?? null,
      manufacturer: l.manufacturer ?? null,
      color: l.color ?? null,
      sqftPerBox: l.sqft_per_box ?? null,
      rollWidthFt: l.roll_width_ft ?? null,
      orderAsRoll: !!l.order_as_roll,
      isFill: !!l.is_fill,
      // Prefer the product's LIVE category so re-categorizing a product (e.g.
      // roll-good ↔ hard-surface) corrects the cut logic on existing jobs;
      // fall back to the line's snapshot for one-off/manual lines.
      category: p?.category ?? l.category ?? null,
      lengthIn: l.length_in ?? null,
      widthIn: l.width_in ?? null,
      measurements: l.measurements ?? null,
      qty,
      unit: l.unit || (l.measure_unit === "sqyd" ? "sq yd" : "sq ft"),
      trackStock: canStock,
      onHand,
      available,
      unitCost: p?.material_rate ?? 0,
      source: explicit,
      resolvedSource,
      reservedQty,
      pulledQty,
      status,
    };
  });

  const orderLines = out.filter((l) => l.resolvedSource === "order");
  return {
    jobId,
    estimateId: (job.estimate_id as string) ?? null,
    lines: out,
    hasStock: out.some((l) => l.resolvedSource === "stock"),
    hasOrder: orderLines.length > 0,
    hasPO,
    // Every special-order line has arrived (nothing left on order).
    materialsArrived:
      orderLines.length > 0 && orderLines.every((l) => l.status === "arrived"),
  };
}
