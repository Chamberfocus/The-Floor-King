"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JobStatusBadge } from "@/components/job-status-badge";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomerCosting, CostComponent } from "@/lib/data/job-costing";

const NOT_COSTED = "Not yet costed";

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

export function JobCostingTab({ data }: { data: CustomerCosting }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { rows, summary } = data;

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
    </Card>
  );
}
