"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getJobMaterials } from "@/lib/data/job-materials";
import { buildSupplierLookup, resolveLineSupplier } from "@/lib/data/suppliers";
import { lineQty, type CalcLine } from "@/lib/estimate-calc";
import type { EstimateLineItem, PoSourceType } from "@/lib/types";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
const round = (n: number) => Math.round(n * 100) / 100;

type DB = Awaited<ReturnType<typeof createClient>>;

/** Reserved/pulled so far for one estimate line on one job (from the ledger). */
async function lineLedger(
  db: DB,
  jobId: string,
  lineId: string,
): Promise<{ reserved: number; pulled: number }> {
  const { data } = await db
    .from("stock_movements")
    .select("kind, qty")
    .eq("job_id", jobId)
    .eq("line_id", lineId);
  let reserved = 0;
  let pulled = 0;
  for (const m of data ?? []) {
    const q = Number(m.qty) || 0;
    if (m.kind === "reserve" || m.kind === "release") reserved += q;
    else if (m.kind === "pull") pulled += Math.abs(q);
  }
  return { reserved: Math.max(0, reserved - pulled), pulled };
}

async function adjustReserved(db: DB, productId: string, delta: number) {
  const { data } = await db
    .from("products")
    .select("reserved")
    .eq("id", productId)
    .maybeSingle();
  const next = Math.max(0, round((Number(data?.reserved) || 0) + delta));
  await db.from("products").update({ reserved: next }).eq("id", productId);
}

async function userId(db: DB): Promise<string | null> {
  const {
    data: { user },
  } = await db.auth.getUser();
  return user?.id ?? null;
}

/**
 * Prepare a job's materials: for each material line, sell from stock (reserve)
 * or special-order (build a PO). Safe to run again — it only reserves what's
 * still outstanding and only creates a PO if there isn't one yet.
 */
export async function prepareJobMaterials(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  await prepareJobMaterialsFor(jobId);
}

/** Core prep, callable from other server code (e.g. on job creation). Pass
 *  `admin` to run elevated — needed when triggered by a customer's portal
 *  approval, where the RLS session can't read products or write stock/POs. */
export async function prepareJobMaterialsFor(
  jobId: string,
  opts?: { admin?: boolean },
): Promise<void> {
  if (!jobId) return;
  const db = (opts?.admin ? createAdminClient() : await createClient()) as DB;
  const mats = await getJobMaterials(jobId, db);
  const uid = await userId(db);

  const orderLineIds: string[] = [];

  for (const l of mats.lines) {
    // Lock in the resolved source so it's stable.
    if (!l.source) {
      await db
        .from("estimate_line_items")
        .update({ source: l.resolvedSource })
        .eq("id", l.lineId);
    }
    if (l.resolvedSource === "order") {
      orderLineIds.push(l.lineId);
      continue;
    }
    // Stock: reserve whatever's still outstanding, up to what's available.
    if (!l.productId || !l.trackStock) continue;
    const outstanding = round(l.qty - l.reservedQty - l.pulledQty);
    if (outstanding <= 0) continue;
    const toReserve = Math.min(outstanding, Math.max(0, l.available));
    if (toReserve <= 0) continue;
    await adjustReserved(db, l.productId, toReserve);
    await db.from("stock_movements").insert({
      product_id: l.productId,
      qty: toReserve,
      kind: "reserve",
      job_id: jobId,
      line_id: l.lineId,
      created_by: uid,
    });
  }

  // Build one PO for the special-order lines (only if none exists yet).
  if (orderLineIds.length && !mats.hasPO && mats.estimateId) {
    await createPOForLines(db, jobId, mats.estimateId, orderLineIds, uid);
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/inventory");
  revalidatePath("/purchase-orders");
}

async function createPOForLines(
  db: DB,
  jobId: string,
  estimateId: string,
  lineIds: string[],
  uid: string | null,
) {
  const { data: est } = await db
    .from("estimates")
    .select("customer_id")
    .eq("id", estimateId)
    .maybeSingle();
  const { data: lineData } = await db
    .from("estimate_line_items")
    .select("*")
    .in("id", lineIds);
  const lines = (lineData ?? []) as (EstimateLineItem & CalcLine)[];
  if (!lines.length) return;

  const productIds = [
    ...new Set(lines.map((l) => l.product_id).filter(Boolean) as string[]),
  ];
  const cost = new Map<string, number>();
  const pname = new Map<string, string>();
  const psupplier = new Map<string, string | null>();
  const psupplierId = new Map<string, string | null>();
  if (productIds.length) {
    const { data: prods } = await db
      .from("products")
      .select("id, name, material_rate, supplier, supplier_id")
      .in("id", productIds);
    for (const p of prods ?? []) {
      cost.set(p.id as string, Number(p.material_rate) || 0);
      pname.set(p.id as string, p.name as string);
      psupplier.set(p.id as string, (p.supplier as string) || null);
      psupplierId.set(p.id as string, (p.supplier_id as string) || null);
    }
  }

  const lookup = await buildSupplierLookup(db);

  // One PO per supplier so each shows the vendor we order from, with the right
  // Manufacturer/Distributor source type.
  const groups = new Map<
    string,
    {
      name: string;
      supplierId: string | null;
      sourceType: PoSourceType;
      lines: typeof lines;
    }
  >();
  for (const l of lines) {
    const resolved = resolveLineSupplier(lookup, {
      productSupplierId: l.product_id ? psupplierId.get(l.product_id) : null,
      supplierName:
        (l.product_id ? psupplier.get(l.product_id) : null) ||
        l.manufacturer ||
        null,
    });
    const g = groups.get(resolved.key) ?? {
      name: resolved.name,
      supplierId: resolved.ref?.id ?? null,
      sourceType: (resolved.ref?.kind ?? "distributor") as PoSourceType,
      lines: [],
    };
    g.lines.push(l);
    groups.set(resolved.key, g);
  }

  for (const [, group] of groups) {
    const glines = group.lines;
    const { data: po, error } = await db
      .from("purchase_orders")
      .insert({
        customer_id: est?.customer_id ?? null,
        estimate_id: estimateId,
        job_id: jobId,
        supplier: group.name,
        supplier_id: group.supplierId,
        source_type: group.sourceType,
        created_by: uid,
      })
      .select("id")
      .single();
    if (error || !po) continue;

    const items = glines.map((l, i) => {
      const base =
        l.description || (l.product_id ? pname.get(l.product_id) : "") || "Item";
      // Carpet & any measured line: show the cut size to order, not just yards.
      const dims =
        l.length_in && l.width_in
          ? ` — ${ftIn(Number(l.width_in))} × ${ftIn(Number(l.length_in))}`
          : "";
      return {
        po_id: po.id,
        product_id: l.product_id,
        position: i,
        description: `${base}${dims}`,
        quantity: round(lineQty(l)),
        unit: l.unit || (l.measure_unit === "sqyd" ? "sq yd" : "sq ft"),
        unit_cost:
          (l.product_id ? cost.get(l.product_id) : undefined) ??
          (Number(l.material_cost) || Number(l.material_rate) || 0),
        manufacturer: l.manufacturer ?? null,
        style: l.style ?? null,
        color: l.color ?? null,
        item_no: l.item_no ?? null,
        // Vendor units: hard surface orders in cartons, carpet by the roll.
        category: l.category ?? null,
        sqft_per_box: l.sqft_per_box ?? null,
        roll_width_ft: l.roll_width_ft ?? null,
      };
    });
    const { error: itemErr } = await db.from("po_items").insert(items);
    if (itemErr) {
      // Fallback for before migration 0098 (po_items units) is run.
      const legacy = items.map(
        ({ category: _c, sqft_per_box: _s, roll_width_ft: _r, ...rest }) => rest,
      );
      await db.from("po_items").insert(legacy);
    }
  }
}

/** Inches → feet'inches" (e.g. 150 → 12'6"). */
function ftIn(inches: number): string {
  if (!Number.isFinite(inches) || inches <= 0) return "";
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches % 12);
  return inch > 0 ? `${ft}'${inch}"` : `${ft}'`;
}

/** Flip a single line between sell-from-stock and special-order. */
export async function setLineSource(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const lineId = str(formData.get("line_id"));
  const source = str(formData.get("source"));
  if (!jobId || !lineId || (source !== "stock" && source !== "order")) return;
  const db = await createClient();

  // Switching to order: release any reservation on this line.
  if (source === "order") {
    const { data: line } = await db
      .from("estimate_line_items")
      .select("product_id")
      .eq("id", lineId)
      .maybeSingle();
    const led = await lineLedger(db, jobId, lineId);
    if (line?.product_id && led.reserved > 0) {
      await adjustReserved(db, line.product_id as string, -led.reserved);
      await db.from("stock_movements").insert({
        product_id: line.product_id,
        qty: -led.reserved,
        kind: "release",
        job_id: jobId,
        line_id: lineId,
        created_by: await userId(db),
      });
    }
  }
  await db.from("estimate_line_items").update({ source }).eq("id", lineId);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/inventory");
}

/** Pull a stock line for the job: on-hand drops, cost lands on the job. */
export async function pullJobLine(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const lineId = str(formData.get("line_id"));
  if (!jobId || !lineId) return;
  const db = await createClient();

  const { data: line } = await db
    .from("estimate_line_items")
    .select("*")
    .eq("id", lineId)
    .maybeSingle();
  if (!line?.product_id) return;
  const productId = line.product_id as string;

  const { data: prod } = await db
    .from("products")
    .select("on_hand, reserved, material_rate")
    .eq("id", productId)
    .maybeSingle();
  if (!prod) return;

  const need = round(lineQty(line as CalcLine));
  const led = await lineLedger(db, jobId, lineId);
  const outstanding = round(need - led.pulled);
  if (outstanding <= 0) return;
  const onHand = Number(prod.on_hand) || 0;
  const pull = Math.min(outstanding, Math.max(0, onHand));
  if (pull <= 0) return;

  const releaseFromReserved = Math.min(pull, led.reserved);
  await db.from("stock_movements").insert({
    product_id: productId,
    qty: -pull,
    kind: "pull",
    job_id: jobId,
    line_id: lineId,
    unit_cost: Number(prod.material_rate) || 0,
    created_by: await userId(db),
  });
  await db
    .from("products")
    .update({
      on_hand: round(onHand - pull),
      reserved: Math.max(0, round((Number(prod.reserved) || 0) - releaseFromReserved)),
      last_movement_at: new Date().toISOString(),
    })
    .eq("id", productId);

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/inventory");
}

/** Pull every ready stock line at once (e.g. when staging the job). */
export async function pullAllStock(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  if (!jobId) return;
  const mats = await getJobMaterials(jobId);
  for (const l of mats.lines) {
    if (l.resolvedSource !== "stock") continue;
    if (l.pulledQty >= l.qty - 0.001) continue;
    const fd = new FormData();
    fd.set("job_id", jobId);
    fd.set("line_id", l.lineId);
    await pullJobLine(fd);
  }
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/inventory");
}
