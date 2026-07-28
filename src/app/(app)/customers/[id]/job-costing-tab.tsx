"use client";

import { Fragment, useState } from "react";
import { ChevronRight, Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { JobStatusBadge } from "@/components/job-status-badge";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomerCosting, CostComponent } from "@/lib/data/job-costing";
import type { JobProfit } from "@/lib/data/finance";

const NOT_COSTED = "Not yet costed";

/** The owner-only profit view for one job (fuel/car/commission are internal). */
export type JobProfitLite = Pick<
  JobProfit,
  | "revenue"
  | "revenueIsActual"
  | "billed"
  | "quotedRevenue"
  | "materialCost"
  | "laborCost"
  | "otherCost"
  | "fuelCost"
  | "carCost"
  | "commissionCost"
  | "cost"
  | "profit"
  | "margin"
>;

function tone(v: number | null): string {
  if (v == null || v === 0) return "text-muted-foreground";
  return v < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";
}
function money(v: number): string {
  return `${v > 0 ? "+" : ""}${formatMoney(v)}`;
}
function pctLabel(v: number | null): string {
  if (v == null) return "N/A";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

/** One "estimated | actual | variance" trio for the 2×2 breakdown. */
function Trio({ label, c }: { label: string; c: CostComponent }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div>
          <div className="text-[11px] text-muted-foreground">Estimated</div>
          <div className="font-semibold tabular-nums">{formatMoney(c.estimated)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Actual</div>
          <div className="font-semibold tabular-nums">
            {c.actual == null ? (
              <span className="text-muted-foreground">Not costed</span>
            ) : (
              formatMoney(c.actual)
            )}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Variance</div>
          <div className={cn("font-semibold tabular-nums", tone(c.variance))}>
            {c.variance == null ? <span className="text-muted-foreground">—</span> : money(c.variance)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function JobCostingTab({
  data,
  profit,
}: {
  data: CustomerCosting;
  /** Per-job profit breakdown, keyed by job id. Owner-only (omit for others). */
  profit?: Record<string, JobProfitLite>;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [profitJob, setProfitJob] = useState<string | null>(null);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { rows, summary } = data;
  const activeProfit = profitJob ? profit?.[profitJob] : null;
  const activeTitle = profitJob
    ? (rows.find((r) => r.jobId === profitJob)?.title ?? "Job")
    : "";

  return (
    <Card id="costing" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="text-base">Job costing — estimated vs actual</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary strip across this customer's costed jobs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-card p-4 text-center shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total estimated
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums">
              {formatMoney(summary.totalEstimated)}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4 text-center shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total actual
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums">
              {formatMoney(summary.totalActual)}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4 text-center shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total variance
            </div>
            <div className={cn("mt-1 text-xl font-bold tabular-nums", tone(summary.totalVariance))}>
              {money(summary.totalVariance)}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4 text-center shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Avg variance %
            </div>
            <div
              className={cn(
                "mt-1 text-xl font-bold tabular-nums",
                summary.avgVariancePct == null ? "text-muted-foreground" : tone(summary.avgVariancePct),
              )}
            >
              {pctLabel(summary.avgVariancePct)}
            </div>
          </div>
        </div>
        {summary.totalJobs > 0 ? (
          <p className="-mt-2 text-xs text-muted-foreground">
            Summary across {summary.costedJobs} costed{" "}
            {summary.costedJobs === 1 ? "job" : "jobs"} of {summary.totalJobs}.
          </p>
        ) : null}

        {/* Per-job table */}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs for this customer yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Estimated</th>
                  <th className="px-3 py-2 text-right font-medium">Actual</th>
                  <th className="px-3 py-2 text-right font-medium">Variance ($)</th>
                  <th className="px-3 py-2 text-right font-medium">Variance (%)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = open.has(r.jobId);
                  return (
                    <Fragment key={r.jobId}>
                      <tr
                        className="cursor-pointer border-b align-top last:border-b-0 hover:bg-muted/30"
                        onClick={() => toggle(r.jobId)}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5 font-medium">
                            <ChevronRight
                              className={cn(
                                "size-4 shrink-0 text-muted-foreground transition-transform",
                                isOpen && "rotate-90",
                              )}
                            />
                            {r.title}
                          </div>
                          {profit?.[r.jobId] ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-1.5 h-7 gap-1 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                setProfitJob(r.jobId);
                              }}
                            >
                              <Calculator className="size-3.5" /> Cost vs profit
                            </Button>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5">
                          <JobStatusBadge status={r.status} />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {formatMoney(r.estimatedTotal)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {r.hasActual ? (
                            formatMoney(r.actualTotal ?? 0)
                          ) : (
                            <span className="text-muted-foreground">{NOT_COSTED}</span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right tabular-nums",
                            r.hasActual && tone(r.varianceDollars),
                          )}
                        >
                          {r.hasActual ? (
                            money(r.varianceDollars ?? 0)
                          ) : (
                            <span className="text-muted-foreground">{NOT_COSTED}</span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right tabular-nums",
                            r.hasActual && r.variancePct != null && tone(r.variancePct),
                          )}
                        >
                          {r.hasActual ? (
                            pctLabel(r.variancePct)
                          ) : (
                            <span className="text-muted-foreground">{NOT_COSTED}</span>
                          )}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="border-b bg-muted/20 last:border-b-0">
                          <td colSpan={6} className="px-3 py-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Trio label="Materials" c={r.materials} />
                              <Trio label="Labor" c={r.labor} />
                            </div>
                            {r.modifiedBillLines.length ? (
                              <div className="mt-4">
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Changed installer bill lines
                                </div>
                                <ul className="space-y-1.5">
                                  {r.modifiedBillLines.map((l, i) => (
                                    <li key={i} className="text-sm">
                                      <span className="font-medium">{l.description}</span>
                                      {l.change_reason ? (
                                        <span className="text-muted-foreground"> — {l.change_reason}</span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Owner-only cost → profit breakdown for one job */}
      <Dialog open={profitJob != null} onOpenChange={(o) => !o && setProfitJob(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cost vs profit — {activeTitle}</DialogTitle>
            <DialogDescription>
              The real math on this job: revenue minus every cost, including fuel,
              vehicle, and commission. Internal only — never shown to the customer.
            </DialogDescription>
          </DialogHeader>
          {activeProfit ? <ProfitBreakdown p={activeProfit} /> : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** A single cost line in the waterfall (shown as a subtraction). */
function CostLine({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 text-xs text-muted-foreground/70">{hint}</span> : null}
      </span>
      <span className="tabular-nums">
        {value > 0 ? "−" : ""}
        {formatMoney(Math.abs(value))}
      </span>
    </div>
  );
}

/** Revenue → costs → profit waterfall, with the internal overheads broken out
 *  so the owner sees exactly what's left after fuel, vehicle, and commission. */
function ProfitBreakdown({ p }: { p: JobProfitLite }) {
  const profitable = p.profit >= 0;
  return (
    <div className="space-y-3">
      {/* Revenue */}
      <div className="flex items-baseline justify-between gap-3 rounded-md bg-muted/50 px-3 py-2">
        <span className="text-sm font-medium">
          Revenue
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {p.revenueIsActual ? "(invoiced)" : "(quoted)"}
          </span>
        </span>
        <span className="text-lg font-semibold tabular-nums">{formatMoney(p.revenue)}</span>
      </div>

      {/* Direct job costs */}
      <div className="border-b pb-2">
        <CostLine label="Material" value={p.materialCost} />
        <CostLine label="Labor" value={p.laborCost} />
        {p.otherCost !== 0 ? <CostLine label="Other expenses" value={p.otherCost} /> : null}
      </div>

      {/* Internal overheads — the lines the owner asked to see */}
      <div className="border-b pb-2">
        <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Internal (hidden from customer)
        </div>
        <CostLine label="Fuel" value={p.fuelCost} />
        <CostLine label="Vehicle / car" value={p.carCost} />
        <CostLine label="Commission" value={p.commissionCost} hint="% of revenue" />
      </div>

      {/* Totals */}
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">Total cost</span>
        <span className="tabular-nums">{formatMoney(p.cost)}</span>
      </div>
      <div
        className={cn(
          "flex items-baseline justify-between gap-3 rounded-md px-3 py-2",
          profitable
            ? "bg-emerald-50 dark:bg-emerald-500/10"
            : "bg-destructive/10",
        )}
      >
        <span className="text-sm font-semibold">Profit</span>
        <span
          className={cn(
            "text-lg font-bold tabular-nums",
            profitable ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
          )}
        >
          {formatMoney(p.profit)}
          <span className="ml-2 text-sm font-medium">
            {p.margin.toFixed(1)}%
          </span>
        </span>
      </div>
    </div>
  );
}
