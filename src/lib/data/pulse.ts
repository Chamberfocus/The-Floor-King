import {
  getPeriodSummary,
  getOutstandingAR,
  getJobProfitability,
  type PeriodSummary,
  type ARBuckets,
  type JobProfit,
} from "@/lib/data/finance";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { marginPct } from "@/lib/estimate-calc";
import type { BusinessSettings } from "@/lib/types";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthRange(year: number, month0: number): { start: string; end: string } {
  const start = new Date(Date.UTC(year, month0, 1));
  const end = new Date(Date.UTC(year, month0 + 1, 0)); // last day of month
  return { start: isoDay(start), end: isoDay(end) };
}

export interface BusinessPulse {
  settings: BusinessSettings;
  // Period summaries
  thisMonth: PeriodSummary;
  lastMonth: PeriodSummary;
  monthLabel: string;
  // Derived headline numbers
  netDelta: number; // this month net − last month net
  marginThisMonth: number; // net margin % of collected
  goalProgressPct: number | null; // collected vs monthly_revenue_goal
  // Receivables
  ar: ARBuckets;
  // Jobs
  jobs: JobProfit[];
  losingJobs: JobProfit[]; // completed/in-progress jobs with negative profit
  belowTargetJobs: JobProfit[]; // profitable but under target margin
  jobsMissingLabor: JobProfit[]; // completed jobs with no subcontractor cost recorded
  avgJobMargin: number;
}

export async function getBusinessPulse(): Promise<BusinessPulse> {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisR = monthRange(y, m);
  const lastR = monthRange(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1);

  const [settings, thisMonth, lastMonth, ar, jobs] = await Promise.all([
    getBusinessSettings(),
    getPeriodSummary(thisR.start, thisR.end),
    getPeriodSummary(lastR.start, lastR.end),
    getOutstandingAR(),
    getJobProfitability(),
  ]);

  const target = settings.target_gross_margin_pct;

  // A job "counts" for profit review once it has real revenue or is past sale.
  const realized = jobs.filter(
    (j) => j.revenue > 0 && (j.status === "completed" || j.revenueIsActual),
  );
  const losingJobs = realized
    .filter((j) => j.profit < -0.5)
    .sort((a, b) => a.profit - b.profit);
  const belowTargetJobs = realized
    .filter((j) => j.profit >= 0 && j.margin < target)
    .sort((a, b) => a.margin - b.margin);
  const jobsMissingLabor = jobs
    .filter(
      (j) =>
        j.status === "completed" &&
        j.revenue > 0 &&
        j.laborCost === 0 &&
        j.materialCost > 0,
    )
    .sort((a, b) => b.revenue - a.revenue);

  const avgJobMargin =
    realized.length > 0
      ? realized.reduce((s, j) => s + j.margin, 0) / realized.length
      : 0;

  const monthLabel = now.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return {
    settings,
    thisMonth,
    lastMonth,
    monthLabel,
    netDelta: thisMonth.net - lastMonth.net,
    marginThisMonth: marginPct(
      thisMonth.collected,
      thisMonth.collected - thisMonth.net,
    ),
    goalProgressPct:
      settings.monthly_revenue_goal > 0
        ? (thisMonth.collected / settings.monthly_revenue_goal) * 100
        : null,
    ar,
    jobs,
    losingJobs,
    belowTargetJobs,
    jobsMissingLabor,
    avgJobMargin,
  };
}
