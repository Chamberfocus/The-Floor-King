import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { getCompletedJobScorecard } from "@/lib/data/finance";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Job Scorecard" };
export const dynamic = "force-dynamic";

const money = (n: number) => `${n < 0 ? "-" : ""}${formatMoney(Math.abs(n))}`;

export default async function ScorecardPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const sp = await searchParams;
  const { jobs, bySalesman, totals } = await getCompletedJobScorecard(
    sp.start || undefined,
    sp.end || undefined,
  );

  return (
    <div>
      <Link
        href="/financials"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to financials
      </Link>
      <PageHeader
        title="Job scorecard — estimated vs actual"
        description="What each finished job was quoted to make vs. what it actually made, by the salesperson who quoted it. A miss means the estimate cost us."
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">Completed from</label>
          <Input type="date" name="start" defaultValue={sp.start ?? ""} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">To</label>
          <Input type="date" name="end" defaultValue={sp.end ?? ""} />
        </div>
        <Button type="submit" variant="outline">Update</Button>
      </form>

      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No completed jobs in this range yet. Once jobs are marked complete with
          their real costs recorded, the estimated-vs-actual tally builds here.
        </p>
      ) : (
        <>
          {/* Running tally */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Completed jobs" value={String(totals.jobs)} sub={`${totals.beat} beat · ${totals.missed} missed the quote`} />
            <Stat label="Quoted profit" value={money(totals.quotedProfit)} sub="What the estimates promised" />
            <Stat label="Actual profit" value={money(totals.actualProfit)} sub="What the work really made" tone={totals.actualProfit < 0 ? "bad" : undefined} />
            <Stat
              label="Variance"
              value={money(totals.variance)}
              sub={totals.variance < 0 ? "Estimates cost us this much" : "Beat the estimates by this"}
              tone={totals.variance < 0 ? "bad" : "good"}
            />
          </div>

          {/* By salesperson — the accountability view */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">By salesperson</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Phone: stacked cards */}
              <div className="space-y-2 md:hidden">
                {bySalesman.map((s) => (
                  <div key={s.salesmanId ?? "none"} className="rounded-lg border p-3">
                    <div className="font-medium">{s.salesman}</div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Jobs</div>
                        <div className="font-medium">{s.jobs}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Beat / missed</div>
                        <div className="font-medium">
                          {s.beat} / {s.missed}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Quoted profit</div>
                        <div className="font-medium">{money(s.quotedProfit)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Actual profit</div>
                        <div className="font-medium">{money(s.actualProfit)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Variance</div>
                        <div className={cn("font-medium", s.variance < 0 ? "text-destructive" : "text-emerald-600")}>
                          {money(s.variance)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Avg margin</div>
                        <div className="font-medium">{Math.round(s.avgActualMargin)}%</div>
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
                      <TableHead>Salesperson</TableHead>
                      <TableHead className="text-right">Jobs</TableHead>
                      <TableHead className="text-right">Beat / missed</TableHead>
                      <TableHead className="text-right">Quoted profit</TableHead>
                      <TableHead className="text-right">Actual profit</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Avg margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bySalesman.map((s) => (
                      <TableRow key={s.salesmanId ?? "none"}>
                        <TableCell className="font-medium">{s.salesman}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{s.jobs}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {s.beat} / {s.missed}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{money(s.quotedProfit)}</TableCell>
                        <TableCell className="text-right">{money(s.actualProfit)}</TableCell>
                        <TableCell className={cn("text-right font-medium", s.variance < 0 ? "text-destructive" : "text-emerald-600")}>
                          {money(s.variance)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{Math.round(s.avgActualMargin)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Per job — worst miss first */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Every completed job</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Phone: stacked cards */}
              <div className="space-y-2 md:hidden">
                {jobs.map((j) => {
                  const variance = j.profit - j.estProfit;
                  return (
                    <div key={j.jobId} className="rounded-lg border p-3">
                      <div className="font-medium">
                        <Link href={`/jobs/${j.jobId}`} className="hover:underline">
                          {j.customer ? `${j.customer} — ` : ""}{j.title}
                        </Link>
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">Salesperson</div>
                          <div className="font-medium">{j.salesman ?? "—"}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Margin (est→act)</div>
                          <div className="font-medium">
                            {Math.round(j.estMargin)}% → {Math.round(j.margin)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Quoted profit</div>
                          <div className="font-medium">{money(j.estProfit)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Actual profit</div>
                          <div className="font-medium">{money(j.profit)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Variance</div>
                          <div className={cn("font-medium", variance < -0.5 ? "text-destructive" : variance > 0.5 ? "text-emerald-600" : "")}>
                            {variance > 0 ? "+" : ""}{money(variance)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Larger screens: table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Salesperson</TableHead>
                      <TableHead className="text-right">Quoted profit</TableHead>
                      <TableHead className="text-right">Actual profit</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Margin (est→act)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((j) => {
                      const variance = j.profit - j.estProfit;
                      return (
                        <TableRow key={j.jobId}>
                          <TableCell className="font-medium">
                            <Link href={`/jobs/${j.jobId}`} className="hover:underline">
                              {j.customer ? `${j.customer} — ` : ""}{j.title}
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{j.salesman ?? "—"}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{money(j.estProfit)}</TableCell>
                          <TableCell className="text-right">{money(j.profit)}</TableCell>
                          <TableCell className={cn("text-right font-medium", variance < -0.5 ? "text-destructive" : variance > 0.5 ? "text-emerald-600" : "")}>
                            {variance > 0 ? "+" : ""}{money(variance)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {Math.round(j.estMargin)}% → {Math.round(j.margin)}%
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "bad";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "text-2xl font-semibold",
            tone === "bad" && "text-destructive",
            tone === "good" && "text-emerald-600",
          )}
        >
          {value}
        </div>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
