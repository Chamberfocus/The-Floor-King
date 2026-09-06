"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getJobMaterials } from "@/lib/data/job-materials";
import { seedJobScopeIfEmpty } from "@/lib/data/job-operational-lines";
import {
  syncJobPurchasingCoverage,
  type JobPurchasingSyncResult,
} from "@/lib/data/job-purchasing";
import { type CalcLine } from "@/lib/estimate-calc";
import { stockPullNeedQty } from "@/lib/job-operational-scope";
import {
  excessReservation,
  netReservedQty,
  orphanedStockLineIds,
} from "@/lib/job-stock-reserve";
import type { EstimateLineItem } from "@/lib/types";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
const round = (n: number) => Math.round(n * 100) / 100;

type DB = Awaited<ReturnType<typeof createClient>>;

/** Load one operational line (job scope first, estimate fallback for legacy). */
async function loadOpsLine(
  db: DB,
  jobId: string,
  lineId: string,
): Promise<(EstimateLineItem & CalcLine) | null> {
  await seedJobScopeIfEmpty(db, jobId);
  const { data: jobLine } = await db
    .from("job_line_items")
    .select("*")
    .eq("job_id", jobId)
    .eq("id", lineId)
    .maybeSingle();
  if (jobLine) return jobLine as EstimateLineItem & CalcLine;
  const { data: estLine } = await db
    .from("estimate_line_items")
    .select("*")
    .eq("id", lineId)
    .maybeSingle();
  return (estLine as EstimateLineItem & CalcLine) ?? null;
}

/** Persist sourcing on the operational job line — never the approved estimate. */
async function updateOpsLineSource(
  db: DB,
  jobId: string,
  lineId: string,
  source: string,
): Promise<void> {
  await seedJobScopeIfEmpty(db, jobId);
  const { data: updated } = await db
    .from("job_line_items")
    .update({ source })
    .eq("job_id", jobId)
    .eq("id", lineId)
    .select("id");
  // Legacy: job never got a copy and line only exists on the estimate.
  if (!updated?.length) {
    await db.from("estimate_line_items").update({ source }).eq("id", lineId);
  }
}

/** Reserved/pulled so far for one line on one job (from the ledger). */
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

/** Reserved is mutated only inside reserve/release/consume RPCs (F6-P4). */

async function userId(db: DB): Promise<string | null> {
  const {
    data: { user },
  } = await db.auth.getUser();
  return user?.id ?? null;
}

/** Release reservations for removed lines and trim excess on surviving stock lines. */
async function reconcileStaleReservations(
  db: DB,
  jobId: string,
  mats: Awaited<ReturnType<typeof getJobMaterials>>,
  uid: string | null,
): Promise<void> {
  const stockLines = mats.lines.filter((l) => l.resolvedSource === "stock");
  const currentStockLineIds = stockLines.map((l) => l.lineId);

  const { data: movements } = await db
    .from("stock_movements")
    .select("line_id, product_id, kind, qty")
    .eq("job_id", jobId)
    .in("kind", ["reserve", "release", "pull"]);

  const byLine = new Map<string, { kind: string; qty: number }[]>();
  const productByLine = new Map<string, string>();
  for (const m of movements ?? []) {
    const lid = m.line_id as string | null;
    if (!lid) continue;
    const arr = byLine.get(lid) ?? [];
    arr.push({ kind: m.kind as string, qty: Number(m.qty) || 0 });
    byLine.set(lid, arr);
    if (m.product_id) productByLine.set(lid, m.product_id as string);
  }

  const releaseLine = async (lineId: string, amount: number) => {
    if (amount <= 0.001) return;
    const productId = productByLine.get(lineId);
    if (!productId) return;
    await db.rpc("release_inventory_safe", {
      p_product_id: productId,
      p_qty: amount,
      p_job_id: jobId,
      p_line_id: lineId,
      p_created_by: uid,
    });
  };

  for (const lineId of orphanedStockLineIds(
    [...byLine.keys()],
    currentStockLineIds,
  )) {
    const reserved = netReservedQty(byLine.get(lineId) ?? []);
    await releaseLine(lineId, reserved);
  }

  for (const l of stockLines) {
    if (!l.productId) continue;
    const excess = excessReservation(l.reservedQty, l.qty, l.pulledQty);
    await releaseLine(l.lineId, excess);
  }
}

/**
 * Prepare a job's materials: for each material line, sell from stock (reserve)
 * or special-order (build a PO). Safe to run again — it only reserves what's
 * still outstanding and only creates a PO if there isn't one yet.
 */
export async function prepareJobMaterials(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  if (!jobId) return;
  const result = await prepareJobMaterialsFor(jobId);
  if (result?.alreadyFullyCovered && result.message) {
    redirect(
      `/jobs/${jobId}?purchasing_message=${encodeURIComponent(result.message)}`,
    );
  }
}

/** Core prep, callable from other server code (e.g. on job creation). Pass
 *  `admin` to run elevated — needed when triggered by a customer's portal
 *  approval, where the RLS session can't read products or write stock/POs. */
export async function prepareJobMaterialsFor(
  jobId: string,
  opts?: { admin?: boolean },
): Promise<JobPurchasingSyncResult | null> {
  if (!jobId) return null;
  const db = (opts?.admin ? createAdminClient() : await createClient()) as DB;
  await seedJobScopeIfEmpty(db, jobId);
  const mats = await getJobMaterials(jobId, db);
  const uid = await userId(db);

  await reconcileStaleReservations(db, jobId, mats, uid);

  // Stock: reserve. Order: coverage-driven draft adjust / supplemental PO
  // (never uses estimate-wide hasPO; never rewrites ordered/received/closed).
  for (const l of mats.lines) {
    if (!l.source) {
      await updateOpsLineSource(db, jobId, l.lineId, l.resolvedSource);
    }
    if (l.resolvedSource === "order") continue;
    if (!l.productId || !l.trackStock) continue;
    const outstanding = round(l.qty - l.reservedQty - l.pulledQty);
    if (outstanding <= 0) continue;
    const toReserve = Math.min(outstanding, Math.max(0, l.available));
    if (toReserve <= 0) continue;
    await db.rpc("reserve_inventory_safe", {
      p_product_id: l.productId,
      p_qty: toReserve,
      p_job_id: jobId,
      p_line_id: l.lineId,
      p_created_by: uid,
    });
  }

  const purchasing = await syncJobPurchasingCoverage(db, jobId, { uid });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/inventory");
  revalidatePath("/purchase-orders");
  return purchasing;
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
    const line = await loadOpsLine(db, jobId, lineId);
    const led = await lineLedger(db, jobId, lineId);
    if (line?.product_id && led.reserved > 0) {
      await db.rpc("release_inventory_safe", {
        p_product_id: line.product_id,
        p_qty: led.reserved,
        p_job_id: jobId,
        p_line_id: lineId,
        p_created_by: await userId(db),
      });
    }
  }
  await updateOpsLineSource(db, jobId, lineId, source);
  // Reconcile draft purchasing after stock↔order flips (job-only lines included).
  await syncJobPurchasingCoverage(db, jobId, { uid: await userId(db) });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/inventory");
  revalidatePath("/purchase-orders");
}

/** Pull a stock line for the job: on-hand drops, cost lands on the job. */
export async function pullJobLine(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  const lineId = str(formData.get("line_id"));
  if (!jobId || !lineId) return;
  const db = await createClient();

  const line = await loadOpsLine(db, jobId, lineId);
  if (!line?.product_id) return;
  const productId = line.product_id as string;

  const { data: prod } = await db
    .from("products")
    .select("on_hand, reserved, avg_unit_cost, material_rate")
    .eq("id", productId)
    .maybeSingle();
  if (!prod) return;

  // Step 3 D2: pull the same physical need as stage / reserve / PO (waste in).
  const need = stockPullNeedQty(line);
  const led = await lineLedger(db, jobId, lineId);
  const outstanding = round(need - led.pulled);
  if (outstanding <= 0) return;
  const onHand = Number(prod.on_hand) || 0;
  // Fail-closed: do not silently partial-pull past on-hand.
  if (outstanding > onHand + 0.00005) return;
  const pull = outstanding;
  if (pull <= 0) return;

  await db.rpc("consume_inventory_safe", {
    p_product_id: productId,
    p_qty: pull,
    p_job_id: jobId,
    p_line_id: lineId,
    p_created_by: await userId(db),
    p_release_reserved: true,
  });

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
