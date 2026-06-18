import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { listInvoices, amountPaid } from "@/lib/data/invoices";
import { invoiceTotals } from "@/lib/invoice-calc";
import { listPurchaseOrders } from "@/lib/data/purchase-orders";
import { poTotal } from "@/lib/po-calc";
import { listJobs } from "@/lib/data/jobs";
import { laborCostByJob } from "@/lib/data/job-labor";
import { optionTotals, optionCostTotals, marginPct } from "@/lib/estimate-calc";
import type { CalcLine } from "@/lib/estimate-calc";
import type { Expense, LineType } from "@/lib/types";

export interface PeriodSummary {
  collected: number;
  billed: number;
  expenses: number;
  poSpend: number;
  subLabor: number;
  net: number;
}

/** Customers that have been cancelled — excluded from all financial totals. */
async function cancelledCustomerIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("customers")
    .select("id")
    .not("cancelled_at", "is", null);
  return new Set((data ?? []).map((c) => c.id as string));
}

export async function getPeriodSummary(
  start: string,
  end: string,
): Promise<PeriodSummary> {
  const supabase = await createClient();
  const cancelled = await cancelledCustomerIds(supabase);

  // Jobs belonging to cancelled customers — their labor & expenses don't count.
  const cancelledJobIds = new Set<string>();
  if (cancelled.size) {
    const { data: cjobs } = await supabase
      .from("jobs")
      .select("id, customer_id")
      .in("customer_id", [...cancelled]);
    for (const j of cjobs ?? []) cancelledJobIds.add(j.id as string);
  }

  const invoices = await listInvoices();
  // Invoices belonging to cancelled customers don't count anywhere.
  const liveInvoices = invoices.filter((i) => !cancelled.has(i.customer_id));
  const cancelledInvoiceIds = new Set(
    invoices.filter((i) => cancelled.has(i.customer_id)).map((i) => i.id),
  );

  const pays = await fetchAll<{ amount: number; invoice_id: string }>(
    (from, to) =>
      supabase
        .from("payments")
        .select("amount, paid_at, invoice_id")
        .gte("paid_at", start)
        .lte("paid_at", end)
        .range(from, to),
  );
  const collected = pays
    .filter((p) => !cancelledInvoiceIds.has(p.invoice_id))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const exps = await fetchAll<{ amount: number; job_id: string | null }>(
    (from, to) =>
      supabase
        .from("expenses")
        .select("amount, date, job_id")
        .gte("date", start)
        .lte("date", end)
        .range(from, to),
  );
  const expenses = exps
    .filter((e) => !cancelledJobIds.has(e.job_id as string))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // Subcontractor payouts marked paid in the period (the real labor cost).
  const lab = await fetchAll<{ amount: number; job_id: string }>((from, to) =>
    supabase
      .from("job_labor")
      .select("amount, paid, paid_on, job_id")
      .eq("paid", true)
      .gte("paid_on", start)
      .lte("paid_on", end)
      .range(from, to),
  );
  const subLabor = lab
    .filter((r) => !cancelledJobIds.has(r.job_id))
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const billed = liveInvoices
    .filter((i) => i.issue_date && i.issue_date >= start && i.issue_date <= end)
    .reduce(
      (s, i) => s + invoiceTotals(i.items ?? [], i.tax_rate, 0).total,
      0,
    );

  const pos = await listPurchaseOrders();
  const poSpend = pos
    .filter((p) => {
      const d = p.created_at.slice(0, 10);
      return d >= start && d <= end;
    })
    .reduce((s, p) => s + poTotal(p.items ?? []), 0);

  return {
    collected,
    billed,
    expenses,
    poSpend,
    subLabor,
    net: collected - expenses - poSpend - subLabor,
  };
}

export interface ARBuckets {
  total: number;
  current: number;
  d30: number;
  d60: number;
  d90plus: number;
  count: number;
}

export async function getOutstandingAR(): Promise<ARBuckets> {
  const supabase = await createClient();
  const cancelled = await cancelledCustomerIds(supabase);
  const invoices = await listInvoices();
  const today = Date.now();
  const b: ARBuckets = {
    total: 0,
    current: 0,
    d30: 0,
    d60: 0,
    d90plus: 0,
    count: 0,
  };
  for (const inv of invoices) {
    if (inv.status === "paid" || inv.status === "void") continue;
    if (cancelled.has(inv.customer_id)) continue;
    const bal = invoiceTotals(
      inv.items ?? [],
      inv.tax_rate,
      amountPaid(inv),
    ).balance;
    if (bal <= 0.005) continue;
    b.total += bal;
    b.count += 1;
    const ref = inv.issue_date ? new Date(inv.issue_date).getTime() : today;
    const age = Math.floor((today - ref) / 86400000);
    if (age <= 30) b.current += bal;
    else if (age <= 60) b.d30 += bal;
    else if (age <= 90) b.d60 += bal;
    else b.d90plus += bal;
  }
  return b;
}

export interface JobProfit {
  jobId: string;
  title: string;
  customer: string | null;
  status: string;
  revenue: number;
  quotedRevenue: number;
  billed: number;
  collected: number;
  revenueIsActual: boolean; // true when revenue comes from invoices, not the quote
  materialCost: number;
  laborCost: number; // subcontractor payouts
  otherCost: number; // logged expenses tagged to the job
  cost: number;
  profit: number;
  margin: number; // gross margin % of revenue
}

export async function getJobProfitability(): Promise<JobProfit[]> {
  const supabase = await createClient();
  const cancelled = await cancelledCustomerIds(supabase);
  const jobs = (await listJobs()).filter(
    (j) => j.option_id && !cancelled.has(j.customer_id),
  );
  if (!jobs.length) return [];

  const optionIds = [...new Set(jobs.map((j) => j.option_id))] as string[];
  const lines = await fetchAll<{
    option_id: string;
    sqft: number | null;
    length_in: number | null;
    width_in: number | null;
    measure_unit: "sqft" | "sqyd";
    material_rate: number | null;
    labor_rate: number | null;
    installed_rate: number | null;
    flat_amount: number | null;
    line_type: LineType;
  }>((from, to) =>
    supabase
      .from("estimate_line_items")
      .select(
        "option_id, sqft, length_in, width_in, measure_unit, material_rate, labor_rate, installed_rate, flat_amount, line_type",
      )
      .in("option_id", optionIds)
      .range(from, to),
  );
  const subtotalByOption = new Map<string, number>();
  const grouped = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = grouped.get(l.option_id) ?? [];
    arr.push(l);
    grouped.set(l.option_id, arr);
  }
  for (const [oid, ls] of grouped) {
    subtotalByOption.set(oid, optionTotals(ls, 0).subtotal);
  }

  const pos = await listPurchaseOrders();
  const poByEstimate = new Map<string, number>();
  for (const p of pos) {
    if (p.estimate_id) {
      poByEstimate.set(
        p.estimate_id,
        (poByEstimate.get(p.estimate_id) ?? 0) + poTotal(p.items ?? []),
      );
    }
  }

  const jobIds = jobs.map((j) => j.id);
  const expData = await fetchAll<{ job_id: string | null; amount: number }>(
    (from, to) =>
      supabase
        .from("expenses")
        .select("job_id, amount")
        .in("job_id", jobIds)
        .range(from, to),
  );
  const expByJob = new Map<string, number>();
  for (const e of expData) {
    if (e.job_id) {
      expByJob.set(
        e.job_id as string,
        (expByJob.get(e.job_id as string) ?? 0) + (Number(e.amount) || 0),
      );
    }
  }

  // Real labor cost: subcontractor payouts recorded against each job.
  const laborByJob = await laborCostByJob(jobs.map((j) => j.id));

  // Material pulled from our own stock — cost it to the job (was $0 before).
  const pullData = await fetchAll<{
    job_id: string | null;
    qty: number;
    unit_cost: number | null;
  }>((from, to) =>
    supabase
      .from("stock_movements")
      .select("job_id, qty, unit_cost")
      .eq("kind", "pull")
      .in("job_id", jobIds)
      .range(from, to),
  );
  const stockCostByJob = new Map<string, number>();
  for (const m of pullData) {
    if (!m.job_id) continue;
    const cost = Math.abs(Number(m.qty) || 0) * (Number(m.unit_cost) || 0);
    stockCostByJob.set(
      m.job_id as string,
      (stockCostByJob.get(m.job_id as string) ?? 0) + cost,
    );
  }

  // Actual revenue from invoices (pre-tax billed + cash collected), per job.
  const invoices = await listInvoices();
  const billedByJob = new Map<string, number>();
  const collectedByJob = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.job_id || inv.status === "void") continue;
    const t = invoiceTotals(inv.items ?? [], 0, 0); // pre-tax subtotal = revenue
    billedByJob.set(inv.job_id, (billedByJob.get(inv.job_id) ?? 0) + t.subtotal);
    collectedByJob.set(
      inv.job_id,
      (collectedByJob.get(inv.job_id) ?? 0) + amountPaid(inv),
    );
  }

  return jobs.map((j) => {
    const quotedRevenue = j.option_id
      ? (subtotalByOption.get(j.option_id) ?? 0)
      : 0;
    const billed = billedByJob.get(j.id) ?? 0;
    const collected = collectedByJob.get(j.id) ?? 0;
    const revenueIsActual = billed > 0;
    const revenue = revenueIsActual ? billed : quotedRevenue;

    const materialCost =
      (j.estimate_id ? (poByEstimate.get(j.estimate_id) ?? 0) : 0) +
      (stockCostByJob.get(j.id) ?? 0);
    const laborCost = laborByJob.get(j.id) ?? 0;
    const otherCost = expByJob.get(j.id) ?? 0;
    const cost = materialCost + laborCost + otherCost;
    const profit = revenue - cost;
    return {
      jobId: j.id,
      title: j.title ?? "Job",
      customer: j.customer_name,
      status: j.status,
      revenue,
      quotedRevenue,
      billed,
      collected,
      revenueIsActual,
      materialCost,
      laborCost,
      otherCost,
      cost,
      profit,
      margin: marginPct(revenue, cost),
    };
  });
}

export interface JobCostAnalysis {
  estRevenue: number;
  estMaterial: number;
  estLabor: number;
  estCost: number;
  estProfit: number;
  estMargin: number;
  actualMaterial: number; // from purchase orders
  actualLabor: number; // from subcontractor payouts
  actualExpense: number; // from logged expenses
  actualCost: number;
  actualProfit: number;
  actualMargin: number;
  costVariance: number; // actual − estimated (positive = over budget)
  marginDelta: number; // actual − estimated margin points
  hasEstimateCosts: boolean;
}

/** Estimated-vs-actual cost & margin for one job (post-completion analysis). */
export async function getJobCostAnalysis(
  jobId: string,
): Promise<JobCostAnalysis | null> {
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("option_id, estimate_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  const { data: lineData } = job.option_id
    ? await supabase
        .from("estimate_line_items")
        .select("*")
        .eq("option_id", job.option_id)
    : { data: [] };
  const lines = (lineData ?? []) as CalcLine[];

  const estRevenue = optionTotals(lines, 0).subtotal;
  const ct = optionCostTotals(lines);
  const estCost = ct.cost;
  const estProfit = estRevenue - estCost;

  const pos = await listPurchaseOrders();
  const poMaterial = pos
    .filter((p) => p.estimate_id && p.estimate_id === job.estimate_id)
    .reduce((s, p) => s + poTotal(p.items ?? []), 0);
  // Plus any material pulled from our own stock for this job.
  const { data: pullRows } = await supabase
    .from("stock_movements")
    .select("qty, unit_cost")
    .eq("kind", "pull")
    .eq("job_id", jobId);
  const stockMaterial = (pullRows ?? []).reduce(
    (s, m) => s + Math.abs(Number(m.qty) || 0) * (Number(m.unit_cost) || 0),
    0,
  );
  const actualMaterial = poMaterial + stockMaterial;

  const { data: expData } = await supabase
    .from("expenses")
    .select("amount")
    .eq("job_id", jobId);
  const actualExpense = (expData ?? []).reduce(
    (s, e) => s + (Number(e.amount) || 0),
    0,
  );

  // Real labor cost: subcontractor payouts recorded against the job.
  const { data: labData } = await supabase
    .from("job_labor")
    .select("amount")
    .eq("job_id", jobId);
  const actualLabor = (labData ?? []).reduce(
    (s, r) => s + (Number(r.amount) || 0),
    0,
  );

  const actualCost = actualMaterial + actualLabor + actualExpense;
  const actualProfit = estRevenue - actualCost;

  return {
    estRevenue,
    estMaterial: ct.material,
    estLabor: ct.labor,
    estCost,
    estProfit,
    estMargin: marginPct(estRevenue, estCost),
    actualMaterial,
    actualLabor,
    actualExpense,
    actualCost,
    actualProfit,
    actualMargin: marginPct(estRevenue, actualCost),
    costVariance: actualCost - estCost,
    marginDelta: marginPct(estRevenue, actualCost) - marginPct(estRevenue, estCost),
    hasEstimateCosts: estCost > 0,
  };
}

export async function listExpenses(): Promise<Expense[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .order("date", { ascending: false })
    .limit(200);
  return (data ?? []) as Expense[];
}

export interface PipelineForecast {
  workInHand: number; // sold work not yet invoiced (jobs in progress/scheduled)
  openQuoteValue: number; // total value of quotes sent, not yet won/lost
  winRate: number; // historical approved / (approved + declined)
  weightedPipeline: number; // openQuoteValue × winRate
  arSoon: number; // receivables likely to land soon (0–60 days)
  projected30: number; // best estimate of cash arriving in ~30 days
  trailingNet: number; // last 30 days net, as a sanity run-rate
}

/**
 * A forward look: cash already earned but uncollected, sold work still to be
 * invoiced, and open quotes weighted by how often you win. Deliberately simple
 * and explainable — every input is shown on the dashboard.
 */
export async function getPipelineForecast(): Promise<PipelineForecast> {
  const supabase = await createClient();

  // 1) Sold work not yet invoiced (jobs that aren't completed/cancelled).
  const jobs = await getJobProfitability();
  const workInHand = jobs
    .filter((j) =>
      ["unscheduled", "scheduled", "in_progress"].includes(j.status),
    )
    .reduce((s, j) => s + Math.max(0, j.quotedRevenue - j.billed), 0);

  // 2) Win rate from decided estimates.
  const { data: decided } = await supabase
    .from("estimates")
    .select("status")
    .in("status", ["approved", "declined"]);
  const won = (decided ?? []).filter((e) => e.status === "approved").length;
  const lost = (decided ?? []).filter((e) => e.status === "declined").length;
  const winRate = won + lost > 0 ? won / (won + lost) : 0.3; // sensible default

  // 3) Value of quotes still open (status = sent).
  const { data: sent } = await supabase
    .from("estimates")
    .select("id, accepted_option_id")
    .eq("status", "sent");
  let openQuoteValue = 0;
  if (sent && sent.length) {
    const estIds = sent.map((e) => e.id as string);
    // Pick an option per estimate: the accepted one, else the first.
    const { data: opts } = await supabase
      .from("estimate_options")
      .select("id, estimate_id, position")
      .in("estimate_id", estIds)
      .order("position", { ascending: true });
    const optionByEstimate = new Map<string, string>();
    for (const e of sent) {
      const acc = e.accepted_option_id as string | null;
      if (acc) optionByEstimate.set(e.id as string, acc);
    }
    for (const o of opts ?? []) {
      const eid = o.estimate_id as string;
      if (!optionByEstimate.has(eid)) optionByEstimate.set(eid, o.id as string);
    }
    const useOptionIds = [...optionByEstimate.values()];
    if (useOptionIds.length) {
      const { data: lineData } = await supabase
        .from("estimate_line_items")
        .select(
          "option_id, line_type, sqft, length_in, width_in, measure_unit, material_rate, labor_rate, installed_rate, flat_amount, waste_pct, quantity",
        )
        .in("option_id", useOptionIds);
      const byOption = new Map<string, CalcLine[]>();
      for (const l of (lineData ?? []) as (CalcLine & { option_id: string })[]) {
        const arr = byOption.get(l.option_id) ?? [];
        arr.push(l);
        byOption.set(l.option_id, arr);
      }
      for (const oid of useOptionIds) {
        openQuoteValue += optionTotals(byOption.get(oid) ?? [], 0).subtotal;
      }
    }
  }

  const weightedPipeline = openQuoteValue * winRate;

  const ar = await getOutstandingAR();
  const arSoon = ar.current + ar.d30;

  // Trailing 30-day net as a run-rate sanity check.
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 29 * 86400000)
    .toISOString()
    .slice(0, 10);
  const trailing = await getPeriodSummary(start, end);

  // ~30-day cash: most of near-term AR + a slice of work-in-hand + a slice of
  // weighted pipeline (only part of it closes & collects within the month).
  const projected30 =
    arSoon * 0.8 + workInHand * 0.5 + weightedPipeline * 0.25;

  return {
    workInHand,
    openQuoteValue,
    winRate,
    weightedPipeline,
    arSoon,
    projected30,
    trailingNet: trailing.net,
  };
}
