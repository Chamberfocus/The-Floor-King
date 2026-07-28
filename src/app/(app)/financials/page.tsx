import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt, Activity } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import {
  getPeriodSummary,
  getOutstandingAR,
  getJobProfitability,
} from "@/lib/data/finance";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Financials" };
export const dynamic = "force-dynamic";

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const profile = await requireProfile();
  // Profit, expenses, and P&L are owner & admin only.
  if (profile.role !== "admin") redirect("/");

  const sp = await searchParams;
  const today = new Date();
  const end = sp.end || isoDay(today);
  const start = sp.start || isoDay(new Date(today.getTime() - 29 * 86400000));

  const [summary, ar, jobs] = await Promise.all([
    getPeriodSummary(start, end),
    getOutstandingAR(),
    getJobProfitability(),
  ]);

  const stats = [
    { label: "Collected", value: summary.collected, hint: "Payments received" },
    { label: "Billed", value: summary.billed, hint: "Invoiced in period" },
    { label: "Expenses", value: summary.expenses, hint: "Recorded spend" },
    {
      label: "Net cash",
      value: summary.net,
      hint: "Collected − expenses − POs − crew pay",
    },
  ];

  return (
    <div>
      <PageHeader
        title="Financials"
        description="How the business is doing — money in, money out, and what's owed."
      >
        <div className="flex gap-2">
          <Link
            href="/pulse"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <Activity className="size-4" /> Business Pulse
          </Link>
          <Link
            href="/financials/expenses"
            className={buttonVariants({ variant: "ghost", size: "lg" })}
          >
            <Receipt className="size-4" /> Expenses
          </Link>
        </div>
      </PageHeader>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">From</label>
          <DateField name="start" defaultValue={start} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">To</label>
          <DateField name="end" defaultValue={end} />
        </div>
        <Button type="submit" variant="outline">
          Update
        </Button>
      </form>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={
                  s.label === "Net cash" && s.value < 0
                    ? "text-2xl font-semibold text-destructive"
                    : "text-2xl font-semibold"
                }
              >
                {formatMoney(s.value)}
              </div>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* AR aging */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            Outstanding receivables — {formatMoney(ar.total)} ({ar.count})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">0–30 days</div>
              <div className="font-semibold">{formatMoney(ar.current)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">31–60 days</div>
              <div className="font-semibold">{formatMoney(ar.d30)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">61–90 days</div>
              <div className="font-semibold">{formatMoney(ar.d60)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">90+ days</div>
              <div className="font-semibold text-destructive">
                {formatMoney(ar.d90plus)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Job profitability */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Job profitability</CardTitle>
          <Link
            href="/financials/scorecard"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Estimated vs actual scorecard →
          </Link>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No jobs with linked estimates yet. Profit shows here as you create
              jobs from approved estimates and record material costs (POs) and
              expenses.
            </p>
          ) : (
            <>
              {/* Phone: stacked cards */}
              <div className="space-y-2 md:hidden">
                {jobs.map((j) => (
                  <div key={j.jobId} className="rounded-lg border p-3">
                    <div className="font-medium">
                      <Link
                        href={`/jobs/${j.jobId}`}
                        className="hover:underline"
                      >
                        {j.customer ? `${j.customer} — ` : ""}
                        {j.title}
                      </Link>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Revenue
                        </div>
                        <div className="font-medium">
                          {formatMoney(j.revenue)}
                          {!j.revenueIsActual ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (estimated)
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Material
                        </div>
                        <div className="font-medium">
                          {formatMoney(j.materialCost)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Crew pay
                        </div>
                        <div className="font-medium">
                          {formatMoney(j.laborCost)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Other
                        </div>
                        <div className="font-medium">
                          {formatMoney(j.otherCost)}
                        </div>
                      </div>
                      {j.fuelCost > 0 ? (
                        <div>
                          <div className="text-xs text-muted-foreground">Fuel</div>
                          <div className="font-medium">{formatMoney(j.fuelCost)}</div>
                        </div>
                      ) : null}
                      {j.carCost > 0 ? (
                        <div>
                          <div className="text-xs text-muted-foreground">Car allowance</div>
                          <div className="font-medium">{formatMoney(j.carCost)}</div>
                        </div>
                      ) : null}
                      {j.commissionCost > 0 ? (
                        <div>
                          <div className="text-xs text-muted-foreground">Commission</div>
                          <div className="font-medium">{formatMoney(j.commissionCost)}</div>
                        </div>
                      ) : null}
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Profit
                        </div>
                        <div
                          className={
                            j.profit < 0
                              ? "font-medium text-destructive"
                              : "font-medium"
                          }
                        >
                          {formatMoney(j.profit)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Margin
                        </div>
                        <div className="font-medium">
                          {Math.round(j.margin)}%
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Larger screens: table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Material</TableHead>
                      <TableHead className="text-right">Crew pay</TableHead>
                      <TableHead className="text-right">Other</TableHead>
                      <TableHead className="text-right">Fuel</TableHead>
                      <TableHead className="text-right">Car</TableHead>
                      <TableHead className="text-right">Comm.</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {jobs.map((j) => (
                    <TableRow key={j.jobId}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/jobs/${j.jobId}`}
                          className="hover:underline"
                        >
                          {j.customer ? `${j.customer} — ` : ""}
                          {j.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(j.revenue)}
                        {!j.revenueIsActual ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (estimated)
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatMoney(j.materialCost)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatMoney(j.laborCost)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatMoney(j.otherCost)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {j.fuelCost > 0 ? formatMoney(j.fuelCost) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {j.carCost > 0 ? formatMoney(j.carCost) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {j.commissionCost > 0 ? formatMoney(j.commissionCost) : "—"}
                      </TableCell>
                      <TableCell
                        className={
                          j.profit < 0
                            ? "text-right font-medium text-destructive"
                            : "text-right font-medium"
                        }
                      >
                        {formatMoney(j.profit)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {Math.round(j.margin)}%
                      </TableCell>
                    </TableRow>
                  ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
