import { createClient } from "@/lib/supabase/server";
import { optionCostTotals } from "@/lib/estimate-calc";
import { COMMITTED_PO_STATUSES } from "@/lib/po-calc";
import { round2, variancePercent, estimatedCostFor } from "@/lib/job-costing";
import type { EstimateLineItem, JobStatus } from "@/lib/types";

export interface CostComponent {
  estimated: number;
  actual: number | null; // null = not yet recorded
  variance: number | null; // actual − estimated, only when actual recorded
}

export interface ModifiedBillLine {
  description: string;
  change_reason: string;
}

export interface JobCostRow {
  jobId: string;
  title: string;
  status: JobStatus;
  materials: CostComponent;
  labor: CostComponent;
  estimatedTotal: number;
  actualTotal: number | null; // null when NO actuals recorded (→ "Not yet costed")
  varianceDollars: number | null;
  variancePct: number | null;
  hasActual: boolean;
  modifiedBillLines: ModifiedBillLine[];
}

export interface CustomerCosting {
  rows: JobCostRow[]; // sorted by varianceDollars desc; not-yet-costed jobs last
  summary: {
    costedJobs: number;
    totalJobs: number;
    totalEstimated: number;
    totalActual: number;
    totalVariance: number;
    avgVariancePct: number | null;
  };
}

const COMMITTED: readonly string[] = COMMITTED_PO_STATUSES; // real material spend (finance.ts)

/**
 * Read-only per-customer cost comparison. Estimated figures come from the job's
 * approval snapshot (falling back to the estimate's real line costs when the
 * snapshot predates the feature). Actual MATERIAL is derived live from committed
 * POs + stock pulls (the resolved source); actual LABOR is the installer-bill
 * total already stored on the job. This function performs NO writes.
 */
export async function getCustomerJobCosting(
  customerId: string,
): Promise<CustomerCosting> {
  const supabase = await createClient();
  const { data: jobRows } = await supabase
    .from("jobs")
    .select(
      "id, title, status, option_id, estimate_id, estimated_material_cost, estimated_labor_cost, actual_labor_cost",
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  const jobs = jobRows ?? [];
  const empty: CustomerCosting = {
    rows: [],
    summary: {
      costedJobs: 0,
      totalJobs: 0,
      totalEstimated: 0,
      totalActual: 0,
      totalVariance: 0,
      avgVariancePct: null,
    },
  };
  if (!jobs.length) return empty;

  const jobIds = jobs.map((j) => j.id as string);
  const jobIdSet = new Set(jobIds);
  const optionIds = [...new Set(jobs.map((j) => j.option_id).filter(Boolean))] as string[];
  const estimateIds = [...new Set(jobs.map((j) => j.estimate_id).filter(Boolean))] as string[];
  // First job seen per estimate — where an estimate-scoped PO attributes.
  const jobByEstimate = new Map<string, string>();
  for (const j of jobs) {
    const eid = j.estimate_id as string | null;
    if (eid && !jobByEstimate.has(eid)) jobByEstimate.set(eid, j.id as string);
  }

  // Estimated fallback: the estimate option's real material/labor cost split.
  const estByOption = new Map<string, { material: number; labor: number }>();
  if (optionIds.length) {
    const { data: lines } = await supabase
      .from("estimate_line_items")
      .select(
        "option_id, line_type, material_cost, labor_cost, waste_pct, quantity, unit, sqft, measure_unit, length_in, width_in",
      )
      .in("option_id", optionIds);
    const byOption = new Map<string, EstimateLineItem[]>();
    for (const l of (lines ?? []) as unknown as EstimateLineItem[]) {
      const arr = byOption.get(l.option_id) ?? [];
      arr.push(l);
      byOption.set(l.option_id, arr);
    }
    for (const [oid, ls] of byOption) {
      const ct = optionCostTotals(ls as Parameters<typeof optionCostTotals>[0]);
      estByOption.set(oid, { material: ct.material, labor: ct.labor });
    }
  }

  // Actual material — committed POs (by job_id, else by estimate_id) + stock pulls.
  const actualMaterialByJob = new Map<string, number>();
  const materialRecorded = new Set<string>();
  const addMaterial = (jobId: string | undefined, amount: number) => {
    if (!jobId || !jobIdSet.has(jobId)) return;
    actualMaterialByJob.set(jobId, (actualMaterialByJob.get(jobId) ?? 0) + amount);
    materialRecorded.add(jobId);
  };
  const seenPo = new Set<string>();
  const attributePo = (po: {
    id: string;
    job_id: string | null;
    estimate_id: string | null;
    items: { quantity: number | null; unit_cost: number | null }[] | null;
  }) => {
    if (seenPo.has(po.id)) return;
    seenPo.add(po.id);
    const total = (po.items ?? []).reduce(
      (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0),
      0,
    );
    const target =
      po.job_id && jobIdSet.has(po.job_id)
        ? po.job_id
        : po.estimate_id
          ? jobByEstimate.get(po.estimate_id)
          : undefined;
    addMaterial(target, total);
  };
  const poSelect = "id, job_id, estimate_id, status, items:po_items(quantity, unit_cost)";
  if (estimateIds.length) {
    const { data } = await supabase
      .from("purchase_orders")
      .select(poSelect)
      .in("estimate_id", estimateIds)
      .in("status", [...COMMITTED]);
    for (const p of (data ?? []) as never[]) attributePo(p);
  }
  {
    const { data } = await supabase
      .from("purchase_orders")
      .select(poSelect)
      .in("job_id", jobIds)
      .in("status", [...COMMITTED]);
    for (const p of (data ?? []) as never[]) attributePo(p);
  }
  // Materials pulled from our own stock — real cost to the job (F6-P4 SoT).
  const { data: pulls } = await supabase
    .from("stock_movements")
    .select("job_id, qty, unit_cost, extended_cost")
    .eq("kind", "pull")
    .in("job_id", jobIds);
  for (const m of pulls ?? []) {
    const cost =
      m.extended_cost != null
        ? Number(m.extended_cost) || 0
        : Math.abs(Number(m.qty) || 0) * (Number(m.unit_cost) || 0);
    addMaterial(m.job_id as string, cost);
  }

  // Modified installer-bill lines (is_modified) per job, with the reason.
  const modifiedByJob = new Map<string, ModifiedBillLine[]>();
  const { data: bills } = await supabase
    .from("installer_bills")
    .select("id, job_id")
    .in("job_id", jobIds);
  const billJob = new Map<string, string>();
  for (const b of bills ?? []) billJob.set(b.id as string, b.job_id as string);
  const billIds = [...billJob.keys()];
  if (billIds.length) {
    const { data: mlines } = await supabase
      .from("installer_bill_line_items")
      .select("bill_id, description, change_reason, is_modified")
      .in("bill_id", billIds)
      .eq("is_modified", true);
    for (const l of mlines ?? []) {
      const jid = billJob.get(l.bill_id as string);
      if (!jid) continue;
      const arr = modifiedByJob.get(jid) ?? [];
      arr.push({
        description: (l.description as string) || "Line item",
        change_reason: (l.change_reason as string) || "",
      });
      modifiedByJob.set(jid, arr);
    }
  }

  const rows: JobCostRow[] = jobs.map((j) => {
    const jobId = j.id as string;
    // Same rule as the close-out screen — snapshot if we have it, else recompute
    // from the estimate's lines. Shared so the two can never drift apart.
    const fallback = j.option_id ? estByOption.get(j.option_id as string) : undefined;
    const { material: estMaterial, labor: estLabor } = estimatedCostFor(
      {
        material: j.estimated_material_cost as number | null,
        labor: j.estimated_labor_cost as number | null,
      },
      fallback ?? null,
    );

    const actualMaterial = materialRecorded.has(jobId)
      ? round2(actualMaterialByJob.get(jobId) ?? 0)
      : null;
    const actualLabor =
      j.actual_labor_cost != null ? round2(Number(j.actual_labor_cost)) : null;

    const hasActual = actualMaterial != null || actualLabor != null;
    const estimatedTotal = round2(estMaterial + estLabor);
    const actualTotal = hasActual
      ? round2((actualMaterial ?? 0) + (actualLabor ?? 0))
      : null;
    const varianceDollars =
      actualTotal != null ? round2(actualTotal - estimatedTotal) : null;

    return {
      jobId,
      title: (j.title as string) || "Job",
      status: j.status as JobStatus,
      materials: {
        estimated: estMaterial,
        actual: actualMaterial,
        variance: actualMaterial != null ? round2(actualMaterial - estMaterial) : null,
      },
      labor: {
        estimated: estLabor,
        actual: actualLabor,
        variance: actualLabor != null ? round2(actualLabor - estLabor) : null,
      },
      estimatedTotal,
      actualTotal,
      varianceDollars,
      variancePct: variancePercent(varianceDollars, estimatedTotal),
      hasActual,
      modifiedBillLines: modifiedByJob.get(jobId) ?? [],
    };
  });

  // Worst (most over estimate) first; not-yet-costed jobs sink to the bottom.
  rows.sort((a, b) => {
    if (a.varianceDollars == null && b.varianceDollars == null) return 0;
    if (a.varianceDollars == null) return 1;
    if (b.varianceDollars == null) return -1;
    return b.varianceDollars - a.varianceDollars;
  });

  const costed = rows.filter((r) => r.hasActual);
  const totalEstimated = round2(costed.reduce((s, r) => s + r.estimatedTotal, 0));
  const totalActual = round2(costed.reduce((s, r) => s + (r.actualTotal ?? 0), 0));
  const pctVals = costed
    .map((r) => r.variancePct)
    .filter((v): v is number => v != null);
  const avgVariancePct = pctVals.length
    ? round2(pctVals.reduce((s, v) => s + v, 0) / pctVals.length)
    : null;

  return {
    rows,
    summary: {
      costedJobs: costed.length,
      totalJobs: rows.length,
      totalEstimated,
      totalActual,
      totalVariance: round2(totalActual - totalEstimated),
      avgVariancePct,
    },
  };
}
