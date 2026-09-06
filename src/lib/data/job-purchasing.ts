/**
 * Job purchasing sync — coverage-driven draft adjust / supplemental create.
 * Operational source: job_line_items. Never rewrites ordered/received/closed.
 */
import { buildSupplierLookup, resolveLineSupplier } from "@/lib/data/suppliers";
import { lineQty, lineOrderQty, type CalcLine } from "@/lib/estimate-calc";
import { isMaterialLine } from "@/lib/job-scope";
import { materialNeedQty } from "@/lib/job-operational-scope";
import {
  buildLegacyCoverageContext,
  computeLineCoverage,
  isDraftPoStatus,
  isNonCoveringPoStatus,
  planPurchasingAdjustWithReview,
  type CoveragePoItem,
  type LineCoverage,
} from "@/lib/po-coverage";
import type { EstimateLineItem, PoSourceType } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = { from: (table: string) => any };

const round = (n: number) => Math.round(n * 100) / 100;

export interface JobPurchasingSyncResult {
  adjustedDrafts: number;
  createdSupplementalItems: number;
  createdPos: number;
  excessLines: { jobLineId: string; excessIssued: number }[];
  coverages: LineCoverage[];
  /** Unlinked legacy PO items need manual review before auto-ordering. */
  legacyPoReviewRequired: boolean;
  /** True when every purchase line already has gap ≈ 0 after sync. */
  alreadyFullyCovered: boolean;
  message: string | null;
}

type OpsLine = EstimateLineItem & CalcLine & { id: string };

/** Load PO items that may cover this job (by job_id or estimate_id). */
export async function loadJobCoverageItems(
  db: DB,
  jobId: string,
  estimateId: string | null,
): Promise<CoveragePoItem[]> {
  const poQuery = db
    .from("purchase_orders")
    .select("id, status, job_id, estimate_id");
  // Prefer job-linked POs; also include estimate-linked (legacy) so we see them
  // but only items with job_line_id count toward coverage.
  let pos: { id: string; status: string }[] = [];
  if (estimateId) {
    const { data } = await poQuery.or(
      `job_id.eq.${jobId},estimate_id.eq.${estimateId}`,
    );
    pos = (data ?? []) as { id: string; status: string }[];
  } else {
    const { data } = await poQuery.eq("job_id", jobId);
    pos = (data ?? []) as { id: string; status: string }[];
  }
  if (!pos.length) return [];

  const statusByPo = new Map(pos.map((p) => [p.id, p.status]));
  const poIds = pos.map((p) => p.id);
  const { data: items, error } = await db
    .from("po_items")
    .select(
      "id, po_id, product_id, quantity, job_line_id, received_qty, received_at",
    )
    .in("po_id", poIds);

  // Pre-migration: job_line_id column missing — fall back without it.
  if (error) {
    const { data: legacy } = await db
      .from("po_items")
      .select("id, po_id, product_id, quantity, received_qty, received_at")
      .in("po_id", poIds);
    return ((legacy ?? []) as Record<string, unknown>[]).map((r) => ({
      poItemId: r.id as string,
      poId: r.po_id as string,
      jobLineId: null,
      productId: (r.product_id as string | null) ?? null,
      quantity: Number(r.quantity) || 0,
      receivedQty:
        r.received_qty == null ? null : Number(r.received_qty) || 0,
      receivedAt: (r.received_at as string | null) ?? null,
      poStatus: statusByPo.get(r.po_id as string) ?? "draft",
    }));
  }

  return ((items ?? []) as Record<string, unknown>[]).map((r) => ({
    poItemId: r.id as string,
    poId: r.po_id as string,
    jobLineId: (r.job_line_id as string | null) ?? null,
    productId: (r.product_id as string | null) ?? null,
    quantity: Number(r.quantity) || 0,
    receivedQty: r.received_qty == null ? null : Number(r.received_qty) || 0,
    receivedAt: (r.received_at as string | null) ?? null,
    poStatus: statusByPo.get(r.po_id as string) ?? "draft",
  }));
}

async function loadOrderMaterialLines(
  db: DB,
  jobId: string,
): Promise<OpsLine[]> {
  const { data } = await db
    .from("job_line_items")
    .select("*")
    .eq("job_id", jobId)
    .order("position", { ascending: true });
  const lines = (data ?? []) as OpsLine[];
  return lines.filter(
    (l) =>
      l.line_type !== "flat" &&
      l.category !== "labor" &&
      isMaterialLine(l) &&
      !l.from_stock &&
      (l as { source?: string | null }).source !== "stock" &&
      lineQty(l) > 0,
  );
}

/**
 * Ensure draft purchasing coverage matches operational need for order-sourced
 * job lines. Idempotent. Never mutates ordered/received/closed PO items.
 */
export async function syncJobPurchasingCoverage(
  db: DB,
  jobId: string,
  opts?: { uid?: string | null },
): Promise<JobPurchasingSyncResult> {
  const empty: JobPurchasingSyncResult = {
    adjustedDrafts: 0,
    createdSupplementalItems: 0,
    createdPos: 0,
    excessLines: [],
    coverages: [],
    legacyPoReviewRequired: false,
    alreadyFullyCovered: true,
    message: "Material need is already fully covered.",
  };
  if (!jobId) return empty;

  const { data: job } = await db
    .from("jobs")
    .select("id, estimate_id, customer_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return empty;

  const estimateId = (job.estimate_id as string | null) ?? null;
  const customerId = (job.customer_id as string | null) ?? null;
  const orderLines = await loadOrderMaterialLines(db, jobId);
  // Also include lines resolved to "order" via missing source + no from_stock
  // when source is null — loadOrderMaterialLines already excludes from_stock
  // and source===stock. Lines with source null and track_stock products may be
  // stock — those are handled in prepare, not here. Only explicit order / non-stock.

  // Refine: include lines whose source is order OR (null and not from_stock).
  // Stock-tracked auto-stock is filtered in prepare before calling us with
  // only order line ids — here we sync ALL non-stock material lines; stock
  // lines simply won't be in orderLines if source was set to stock.
  const materialOrderLines = orderLines.filter((l) => {
    const src = (l as { source?: string | null }).source;
    if (src === "order") return true;
    if (src === "stock") return false;
    return !l.from_stock;
  });

  let coverageItems = await loadJobCoverageItems(db, jobId, estimateId);
  const coverages: LineCoverage[] = [];
  const excessLines: { jobLineId: string; excessIssued: number }[] = [];
  let adjustedDrafts = 0;
  let createdSupplementalItems = 0;
  let createdPos = 0;

  const lookup = await buildSupplierLookup(db as never);
  const productIds = [
    ...new Set(
      materialOrderLines.map((l) => l.product_id).filter(Boolean) as string[],
    ),
  ];
  const psupplier = new Map<string, string | null>();
  const psupplierId = new Map<string, string | null>();
  const pname = new Map<string, string>();
  const punit = new Map<string, string>();
  const pcost = new Map<string, number>();
  if (productIds.length) {
    const { data: prods } = await db
      .from("products")
      .select("id, name, unit, material_rate, supplier, supplier_id, track_stock")
      .in("id", productIds);
    for (const p of prods ?? []) {
      psupplier.set(p.id as string, (p.supplier as string) || null);
      psupplierId.set(p.id as string, (p.supplier_id as string) || null);
      pname.set(p.id as string, (p.name as string) ?? "");
      punit.set(p.id as string, String(p.unit ?? "").toLowerCase());
      pcost.set(p.id as string, Number(p.material_rate) || 0);
    }
  }

  // Skip auto-stock products that haven't been flipped to order.
  const trackStock = new Map<string, boolean>();
  if (productIds.length) {
    const { data: prods } = await db
      .from("products")
      .select("id, track_stock")
      .in("id", productIds);
    for (const p of prods ?? [])
      trackStock.set(p.id as string, Boolean(p.track_stock));
  }
  const purchaseLines = materialOrderLines.filter((l) => {
    const src = (l as { source?: string | null }).source;
    if (l.from_stock || src === "stock") return false;
    if (src === "order") return true;
    if (l.product_id && trackStock.get(l.product_id)) return false;
    return true;
  });

  const legacyCtx = buildLegacyCoverageContext(
    purchaseLines.map((l) => ({
      id: l.id,
      productId: (l.product_id as string | null) ?? null,
    })),
    coverageItems,
  );

  type PendingSupp = {
    line: OpsLine;
    qty: number;
    vendorKey: string;
    vendorName: string;
    supplierId: string | null;
    sourceType: PoSourceType;
  };
  const pending: PendingSupp[] = [];

  for (const line of purchaseLines) {
    const need = materialNeedQty(line);
    const legacyExtra = legacyCtx.legacyByLine.get(line.id) ?? [];
    const cov = computeLineCoverage(line.id, need, coverageItems, legacyExtra);
    coverages.push(cov);
    if (cov.excessIssued > 0.001) {
      excessLines.push({
        jobLineId: line.id,
        excessIssued: cov.excessIssued,
      });
    }

    const plan = planPurchasingAdjustWithReview(cov, legacyCtx.reviewRequired);

    if (plan.shouldAdjustDraft && plan.targetDraftQty >= 0) {
      const draftItems = coverageItems.filter(
        (i) =>
          i.jobLineId === line.id &&
          isDraftPoStatus(i.poStatus) &&
          !isNonCoveringPoStatus(i.poStatus),
      );
      if (draftItems.length) {
        // Put all desired draft qty on the first draft item; zero/remove extras.
        const [primary, ...rest] = draftItems;
        if (plan.targetDraftQty <= 0.001) {
          await db.from("po_items").delete().eq("id", primary.poItemId);
          for (const r of rest)
            await db.from("po_items").delete().eq("id", r.poItemId);
          adjustedDrafts += 1 + rest.length;
        } else {
          await db
            .from("po_items")
            .update({ quantity: plan.targetDraftQty })
            .eq("id", primary.poItemId);
          for (const r of rest)
            await db.from("po_items").delete().eq("id", r.poItemId);
          adjustedDrafts += 1;
        }
      }
    } else if (plan.supplementalQty > 0.001) {
      const resolved = resolveLineSupplier(lookup, {
        productSupplierId: line.product_id
          ? psupplierId.get(line.product_id)
          : null,
        supplierName:
          (line.product_id ? psupplier.get(line.product_id) : null) ||
          line.manufacturer ||
          null,
      });
      pending.push({
        line,
        qty: plan.supplementalQty,
        vendorKey: resolved.key,
        vendorName: resolved.name,
        supplierId: resolved.ref?.id ?? null,
        sourceType: (resolved.ref?.kind ?? "distributor") as PoSourceType,
      });
    }
  }

  // Refresh coverage before creating supplements (idempotent / race soften).
  if (pending.length) {
    coverageItems = await loadJobCoverageItems(db, jobId, estimateId);
    const stillNeeded: PendingSupp[] = [];
    for (const p of pending) {
      const need = materialNeedQty(p.line);
      const cov = computeLineCoverage(p.line.id, need, coverageItems);
      const plan = planPurchasingAdjustWithReview(cov, legacyCtx.reviewRequired);
      if (plan.supplementalQty > 0.001) {
        stillNeeded.push({ ...p, qty: plan.supplementalQty });
      } else if (plan.shouldAdjustDraft) {
        // Another writer created a draft — adjust instead.
        const draftItems = coverageItems.filter(
          (i) => i.jobLineId === p.line.id && isDraftPoStatus(i.poStatus),
        );
        if (draftItems[0]) {
          await db
            .from("po_items")
            .update({ quantity: plan.targetDraftQty })
            .eq("id", draftItems[0].poItemId);
          adjustedDrafts += 1;
        }
      }
    }

    // Group supplements by vendor.
    const groups = new Map<string, PendingSupp[]>();
    for (const p of stillNeeded) {
      const arr = groups.get(p.vendorKey) ?? [];
      arr.push(p);
      groups.set(p.vendorKey, arr);
    }

    for (const [, group] of groups) {
      const g0 = group[0];
      // Prefer an existing DRAFT PO for this job + vendor.
      let poId: string | null = null;
      let startPos = 0;
      const { data: draftPos } = await db
        .from("purchase_orders")
        .select("id")
        .eq("job_id", jobId)
        .eq("status", "draft")
        .eq("supplier_id", g0.supplierId)
        .limit(1);
      if (g0.supplierId && draftPos?.[0]) {
        poId = draftPos[0].id as string;
      } else if (!g0.supplierId) {
        const { data: unnamed } = await db
          .from("purchase_orders")
          .select("id, supplier")
          .eq("job_id", jobId)
          .eq("status", "draft")
          .is("supplier_id", null)
          .limit(5);
        const match = (unnamed ?? []).find(
          (p: { id: string; supplier?: string | null }) =>
            ((p.supplier as string) || "").toLowerCase() ===
            (g0.vendorName || "").toLowerCase(),
        );
        if (match) poId = match.id as string;
      }

      if (poId) {
        const { data: last } = await db
          .from("po_items")
          .select("position")
          .eq("po_id", poId)
          .order("position", { ascending: false })
          .limit(1)
          .maybeSingle();
        startPos = ((last?.position as number) ?? -1) + 1;
      } else {
        const { data: po, error } = await db
          .from("purchase_orders")
          .insert({
            customer_id: customerId,
            estimate_id: estimateId,
            job_id: jobId,
            supplier: g0.vendorName,
            supplier_id: g0.supplierId,
            source_type: g0.sourceType,
            status: "draft",
            created_by: opts?.uid ?? null,
          })
          .select("id")
          .single();
        if (error || !po) continue;
        poId = po.id as string;
        createdPos += 1;
        startPos = 0;
      }

      const rows = group.map((p, i) => {
        const l = p.line;
        const base =
          l.description ||
          (l.product_id ? pname.get(l.product_id) : "") ||
          "Item";
        const lineUnit = String(
          l.unit || (l.measure_unit === "sqyd" ? "sq yd" : "sq ft"),
        );
        const catUnit = (l.product_id ? punit.get(l.product_id) : "")?.replace(
          /\s+/g,
          "",
        );
        const lineUnitNorm = lineUnit.toLowerCase().replace(/\s+/g, "");
        const catCost = l.product_id ? pcost.get(l.product_id) : undefined;
        const unitsAgree =
          !!catUnit &&
          (catUnit === lineUnitNorm ||
            (["sqft", "sf"].includes(catUnit) &&
              ["sqft", "sf"].includes(lineUnitNorm)) ||
            (["sqyd", "sy"].includes(catUnit) &&
              ["sqyd", "sy"].includes(lineUnitNorm)));
        const ownCost =
          Number(l.material_cost) || Number(l.material_rate) || 0;
        return {
          po_id: poId,
          product_id: l.product_id,
          position: startPos + i,
          description: base,
          quantity: round(p.qty),
          unit: lineUnit,
          unit_cost:
            unitsAgree && catCost != null ? catCost : ownCost,
          manufacturer: l.manufacturer ?? null,
          style: l.style ?? null,
          color: l.color ?? null,
          item_no: l.item_no ?? null,
          category: l.category ?? null,
          sqft_per_box: l.sqft_per_box ?? null,
          roll_width_ft: l.roll_width_ft ?? null,
          job_line_id: l.id,
        };
      });

      let { error: itemErr } = await db.from("po_items").insert(rows);
      if (itemErr) {
        // Pre-migration fallback without job_line_id / unit helpers.
        const legacy = rows.map(
          ({
            job_line_id: _j,
            category: _c,
            sqft_per_box: _s,
            roll_width_ft: _r,
            ...rest
          }) => rest,
        );
        ({ error: itemErr } = await db.from("po_items").insert(legacy));
      }
      if (!itemErr) createdSupplementalItems += rows.length;
    }
  }

  // Final coverage snapshot
  coverageItems = await loadJobCoverageItems(db, jobId, estimateId);
  const finalLegacy = buildLegacyCoverageContext(
    purchaseLines.map((l) => ({
      id: l.id,
      productId: (l.product_id as string | null) ?? null,
    })),
    coverageItems,
  );
  const finalCoverages = purchaseLines.map((line) =>
    computeLineCoverage(
      line.id,
      materialNeedQty(line),
      coverageItems,
      finalLegacy.legacyByLine.get(line.id) ?? [],
    ),
  );

  const final = finalCoverages.length ? finalCoverages : coverages;
  const fullyCovered =
    final.length > 0 && final.every((c) => c.gap <= 0.001);
  return {
    adjustedDrafts,
    createdSupplementalItems,
    createdPos,
    excessLines,
    coverages: final,
    legacyPoReviewRequired: legacyCtx.reviewRequired,
    alreadyFullyCovered: fullyCovered && createdSupplementalItems === 0 && createdPos === 0,
    message: fullyCovered
      ? "Material need is already fully covered."
      : createdSupplementalItems > 0 || createdPos > 0
        ? null
        : adjustedDrafts > 0
          ? "Draft purchasing adjusted to remaining gap."
          : null,
  };
}

/** Re-export helpers used by materials UI. */
export { computeLineCoverage, materialNeedQty, lineOrderQty };
