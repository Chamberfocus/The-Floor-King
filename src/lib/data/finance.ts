import { createClient } from "@/lib/supabase/server";
import { listInvoices, amountPaid } from "@/lib/data/invoices";
import { invoiceTotals } from "@/lib/invoice-calc";
import { listPurchaseOrders } from "@/lib/data/purchase-orders";
import { poTotal } from "@/lib/po-calc";
import { listJobs } from "@/lib/data/jobs";
import { optionTotals, optionCostTotals, marginPct } from "@/lib/estimate-calc";
import type { CalcLine } from "@/lib/estimate-calc";
import type { Expense, LineType } from "@/lib/types";

export interface PeriodSummary {
  collected: number;
  billed: number;
  expenses: number;
  poSpend: number;
  net: number;
}

export async function getPeriodSummary(
  start: string,
  end: string,
): Promise<PeriodSummary> {
  const supabase = await createClient();

  const { data: pays } = await supabase
    .from("payments")
    .select("amount, paid_at")
    .gte("paid_at", start)
    .lte("paid_at", end);
  const collected = (pays ?? []).reduce(
    (s, p) => s + (Number(p.amount) || 0),
    0,
  );

  const { data: exps } = await supabase
    .from("expenses")
    .select("amount, date")
    .gte("date", start)
    .lte("date", end);
  const expenses = (exps ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const invoices = await listInvoices();
  const billed = invoices
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

  return { collected, billed, expenses, poSpend, net: collected - expenses };
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
  revenue: number;
  materialCost: number;
  otherCost: number;
  profit: number;
}

export async function getJobProfitability(): Promise<JobProfit[]> {
  const supabase = await createClient();
  const jobs = (await listJobs()).filter((j) => j.option_id);
  if (!jobs.length) return [];

  const optionIds = [...new Set(jobs.map((j) => j.option_id))] as string[];
  const { data: lineData } = await supabase
    .from("estimate_line_items")
    .select(
      "option_id, sqft, length_in, width_in, measure_unit, material_rate, labor_rate, installed_rate, flat_amount, line_type",
    )
    .in("option_id", optionIds);
  const lines = (lineData ?? []) as {
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
  }[];
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

  const { data: expData } = await supabase
    .from("expenses")
    .select("job_id, amount")
    .in("job_id", jobs.map((j) => j.id));
  const expByJob = new Map<string, number>();
  for (const e of expData ?? []) {
    if (e.job_id) {
      expByJob.set(
        e.job_id as string,
        (expByJob.get(e.job_id as string) ?? 0) + (Number(e.amount) || 0),
      );
    }
  }

  return jobs.map((j) => {
    const revenue = j.option_id ? (subtotalByOption.get(j.option_id) ?? 0) : 0;
    const materialCost = j.estimate_id
      ? (poByEstimate.get(j.estimate_id) ?? 0)
      : 0;
    const otherCost = expByJob.get(j.id) ?? 0;
    return {
      jobId: j.id,
      title: j.title ?? "Job",
      customer: j.customer_name,
      revenue,
      materialCost,
      otherCost,
      profit: revenue - materialCost - otherCost,
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
  const actualMaterial = pos
    .filter((p) => p.estimate_id && p.estimate_id === job.estimate_id)
    .reduce((s, p) => s + poTotal(p.items ?? []), 0);

  const { data: expData } = await supabase
    .from("expenses")
    .select("amount")
    .eq("job_id", jobId);
  const actualExpense = (expData ?? []).reduce(
    (s, e) => s + (Number(e.amount) || 0),
    0,
  );
  const actualCost = actualMaterial + actualExpense;
  const actualProfit = estRevenue - actualCost;

  return {
    estRevenue,
    estMaterial: ct.material,
    estLabor: ct.labor,
    estCost,
    estProfit,
    estMargin: marginPct(estRevenue, estCost),
    actualMaterial,
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
