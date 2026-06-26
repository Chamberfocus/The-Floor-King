import { createClient } from "@/lib/supabase/server";
import { lineQty, type CalcLine } from "@/lib/estimate-calc";

export type MaterialSource = "stock" | "order";

export interface JobMaterialLine {
  lineId: string;
  room: string | null;
  description: string;
  productId: string | null;
  productName: string | null;
  supplier: string | null; // vendor we order it from (for the PO)
  category: string | null;
  lengthIn: number | null; // cut measurements to order (carpet especially)
  widthIn: number | null;
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
    | "order" // special-order → PO
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
}

type RawLine = CalcLine & {
  id: string;
  room: string | null;
  description: string;
  product_id: string | null;
  source: string | null;
  unit: string | null;
  category: string | null;
  length_in: number | null;
  width_in: number | null;
  manufacturer: string | null;
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

  const productIds = [
    ...new Set(lines.map((l) => l.product_id).filter(Boolean)),
  ] as string[];
  const prodById = new Map<
    string,
    { name: string; track_stock: boolean; on_hand: number; reserved: number; material_rate: number; supplier: string | null }
  >();
  if (productIds.length) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, track_stock, on_hand, reserved, material_rate, supplier")
      .in("id", productIds);
    for (const p of prods ?? []) {
      prodById.set(p.id as string, {
        name: (p.name as string) ?? "",
        track_stock: Boolean(p.track_stock),
        on_hand: Number(p.on_hand) || 0,
        reserved: Number(p.reserved) || 0,
        material_rate: Number(p.material_rate) || 0,
        supplier: (p.supplier as string) || null,
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
    const resolvedSource: MaterialSource =
      explicit ?? (canStock ? "stock" : "order");

    let status: JobMaterialLine["status"];
    if (resolvedSource === "order") status = "order";
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
      category: l.category ?? null,
      lengthIn: l.length_in ?? null,
      widthIn: l.width_in ?? null,
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

  return {
    jobId,
    estimateId: (job.estimate_id as string) ?? null,
    lines: out,
    hasStock: out.some((l) => l.resolvedSource === "stock"),
    hasOrder: out.some((l) => l.resolvedSource === "order"),
    hasPO,
  };
}
