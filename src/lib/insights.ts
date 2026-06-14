import type { BusinessPulse } from "@/lib/data/pulse";
import { formatMoney } from "@/lib/format";

export type InsightTone = "danger" | "warning" | "opportunity" | "good";

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  impact: number; // dollar magnitude — used to rank
  href?: string;
  cta?: string;
}

const pct = (n: number) => `${n.toFixed(0)}%`;

/**
 * Turn the business pulse into a ranked, plain-English action list.
 * Rule-based and deterministic — every suggestion carries a dollar impact so the
 * biggest levers float to the top.
 */
export function buildInsights(p: BusinessPulse): Insight[] {
  const out: Insight[] = [];
  const target = p.settings.target_gross_margin_pct;

  // 1) Jobs that LOST money — the loudest alarm.
  for (const j of p.losingJobs.slice(0, 5)) {
    out.push({
      id: `loss-${j.jobId}`,
      tone: "danger",
      title: `${j.title} lost ${formatMoney(Math.abs(j.profit))}`,
      detail: `${j.customer ?? "Job"} brought in ${formatMoney(
        j.revenue,
      )} but cost ${formatMoney(j.cost)} (material ${formatMoney(
        j.materialCost,
      )}, labor ${formatMoney(j.laborCost)}, other ${formatMoney(
        j.otherCost,
      )}). Find out what went over and price the next one to cover it.`,
      impact: Math.abs(j.profit) + 100000, // always rank losses first
      href: `/jobs/${j.jobId}`,
      cta: "Review job",
    });
  }

  // 2) AR you're owed — money already earned, sitting uncollected.
  if (p.ar.d90plus > 0) {
    out.push({
      id: "ar-90",
      tone: "danger",
      title: `${formatMoney(p.ar.d90plus)} is 90+ days overdue`,
      detail:
        "This is money you already earned. Chase these invoices today — the older they get, the less likely they're paid.",
      impact: p.ar.d90plus,
      href: "/invoices",
      cta: "Collect now",
    });
  }
  if (p.ar.d60 > 0) {
    out.push({
      id: "ar-60",
      tone: "warning",
      title: `${formatMoney(p.ar.d60)} is 60–90 days out`,
      detail: "Send a reminder before these slip into the 90-day bucket.",
      impact: p.ar.d60,
      href: "/invoices",
      cta: "Send reminders",
    });
  }

  // 3) Jobs under your target margin — leaving money on the table.
  for (const j of p.belowTargetJobs.slice(0, 5)) {
    const lift = j.revenue * ((target - j.margin) / 100);
    out.push({
      id: `margin-${j.jobId}`,
      tone: "warning",
      title: `${j.title} ran at ${pct(j.margin)} margin (target ${pct(target)})`,
      detail: `Hitting your ${pct(target)} target on a job this size would have added about ${formatMoney(
        lift,
      )}. Check whether material or labor came in high, or the quote was too low.`,
      impact: lift,
      href: `/jobs/${j.jobId}`,
      cta: "Review job",
    });
  }

  // 4) Profit is overstated because labor cost is missing.
  if (p.jobsMissingLabor.length > 0) {
    const rev = p.jobsMissingLabor.reduce((s, j) => s + j.revenue, 0);
    out.push({
      id: "missing-labor",
      tone: "warning",
      title: `${p.jobsMissingLabor.length} completed job${
        p.jobsMissingLabor.length === 1 ? "" : "s"
      } missing crew pay`,
      detail:
        "These jobs show no subcontractor cost, so their profit looks better than it is. Record what you paid the crew to see your real numbers.",
      impact: rev * 0.25, // rough labor share of revenue
      href: `/jobs/${p.jobsMissingLabor[0].jobId}`,
      cta: "Add crew pay",
    });
  }

  // 5) Month-over-month trend.
  if (p.lastMonth.net !== 0 || p.thisMonth.net !== 0) {
    if (p.netDelta < 0) {
      out.push({
        id: "trend-down",
        tone: "warning",
        title: `Profit is down ${formatMoney(Math.abs(p.netDelta))} vs last month`,
        detail: `This month's net is ${formatMoney(
          p.thisMonth.net,
        )} versus ${formatMoney(
          p.lastMonth.net,
        )} last month. Watch costs and push to close open quotes.`,
        impact: Math.abs(p.netDelta),
      });
    } else if (p.netDelta > 0) {
      out.push({
        id: "trend-up",
        tone: "good",
        title: `Profit is up ${formatMoney(p.netDelta)} vs last month`,
        detail: `Net is ${formatMoney(
          p.thisMonth.net,
        )} this month. Keep doing what's working.`,
        impact: p.netDelta,
      });
    }
  }

  // 6) Pace toward the monthly revenue goal.
  if (p.goalProgressPct !== null) {
    const goal = p.settings.monthly_revenue_goal;
    const remaining = Math.max(0, goal - p.thisMonth.collected);
    if (p.goalProgressPct >= 100) {
      out.push({
        id: "goal-hit",
        tone: "good",
        title: `Monthly goal hit — ${formatMoney(p.thisMonth.collected)} collected`,
        detail: `You're past your ${formatMoney(goal)} goal for the month.`,
        impact: p.thisMonth.collected,
      });
    } else {
      out.push({
        id: "goal-pace",
        tone: "opportunity",
        title: `${formatMoney(remaining)} to go to hit this month's goal`,
        detail: `Collected ${formatMoney(
          p.thisMonth.collected,
        )} of your ${formatMoney(goal)} goal (${pct(p.goalProgressPct)}).`,
        impact: remaining,
      });
    }
  }

  // Rank by dollar impact, biggest first.
  return out.sort((a, b) => b.impact - a.impact);
}
