"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";

type Lens = "cash" | "job";

/**
 * Net-profit headline with two lenses you can flip between:
 *  - Cash basis: money collected this month minus money spent this month.
 *  - By completed job: each job's revenue matched to its own costs, counted in
 *    the month it was finished (tells you if the WORK made money).
 */
export function ProfitLensCard({
  cashNet,
  cashDelta,
  jobProfit,
  jobDelta,
  completedJobs,
}: {
  cashNet: number;
  cashDelta: number;
  jobProfit: number;
  jobDelta: number;
  completedJobs: number;
}) {
  const [lens, setLens] = useState<Lens>("cash");
  const value = lens === "cash" ? cashNet : jobProfit;
  const delta = lens === "cash" ? cashDelta : jobDelta;
  const up = delta >= 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <span className="text-sm font-medium text-muted-foreground">
          {lens === "cash" ? "Net profit (cash)" : "Profit by completed job"}
        </span>
        <div className="flex rounded-md border p-0.5">
          {(
            [
              ["cash", "Cash"],
              ["job", "By job"],
            ] as [Lens, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setLens(v)}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                lens === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-semibold", value < 0 && "text-destructive")}>
          {formatMoney(value)}
        </div>
        <p
          className={cn(
            "mt-1 inline-flex items-center gap-1 text-xs",
            up ? "text-emerald-600" : "text-destructive",
          )}
        >
          {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          {formatMoney(Math.abs(delta))} vs last month
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {lens === "cash"
            ? "Money in minus money out this month."
            : completedJobs > 0
              ? `${completedJobs} job${completedJobs === 1 ? "" : "s"} completed this month, revenue vs. their real costs.`
              : "No jobs completed this month yet."}
        </p>
      </CardContent>
    </Card>
  );
}
