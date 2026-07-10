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
import { getWinLossReport, type WinLossGroup } from "@/lib/data/reports";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Win / Loss" };
export const dynamic = "force-dynamic";

const ALLOWED = ["admin", "office", "sales_manager"];

export default async function WinLossPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const profile = await requireProfile();
  if (!ALLOWED.includes(profile.role)) redirect("/");

  const sp = await searchParams;
  const r = await getWinLossReport(sp.start || undefined, sp.end || undefined);
  const decided = r.won + r.lost;

  return (
    <div>
      <Link
        href="/reports"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to reports
      </Link>
      <PageHeader
        title="Win / Loss"
        description="Quoted deals you won vs. lost — by salesperson and lead source, with the reasons you lost. (Approved estimate = won, declined = lost.)"
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">Decided from</label>
          <DateField name="start" defaultValue={sp.start ?? ""} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">To</label>
          <DateField name="end" defaultValue={sp.end ?? ""} />
        </div>
        <Button type="submit" variant="outline">Update</Button>
      </form>

      {/* Headline */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Win rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {decided > 0 ? `${Math.round(r.winRate)}%` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {r.won} won of {decided} decided
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Won</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-emerald-600">{formatMoney(r.wonValue)}</div>
            <p className="text-xs text-muted-foreground">{r.won} job{r.won === 1 ? "" : "s"} signed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Lost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-destructive">{formatMoney(r.lostValue)}</div>
            <p className="text-xs text-muted-foreground">{r.lost} walked away</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Still open</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{formatMoney(r.openValue)}</div>
            <p className="text-xs text-muted-foreground">{r.open} quote{r.open === 1 ? "" : "s"} out now</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GroupCard title="By salesperson" rows={r.bySalesman} />
        <GroupCard title="By lead source" rows={r.bySource} />
      </div>

      {/* Lost reasons */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Why we lost ({r.lostDeals.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {r.lostDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lost deals in this range.</p>
          ) : (
            <>
              {/* Phone: stacked cards */}
              <div className="space-y-2 md:hidden">
                {r.lostDeals.map((d) => (
                  <div key={d.estimateId} className="rounded-lg border p-3">
                    <div className="font-medium">
                      <Link href={`/estimates/${d.estimateId}`} className="hover:underline">
                        {d.customer ? `${d.customer} — ` : ""}{d.title}
                      </Link>
                    </div>
                    <div className="text-xs text-muted-foreground">{d.source}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.salesman ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.reason || <span className="italic">no reason recorded</span>}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Value</div>
                        <div className="font-medium">{formatMoney(d.value)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Lost</div>
                        <div className="font-medium">
                          {d.decidedAt ? formatDate(d.decidedAt) : "—"}
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
                      <TableHead>Deal</TableHead>
                      <TableHead>Salesperson</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Lost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.lostDeals.map((d) => (
                      <TableRow key={d.estimateId}>
                        <TableCell className="font-medium">
                          <Link href={`/estimates/${d.estimateId}`} className="hover:underline">
                            {d.customer ? `${d.customer} — ` : ""}{d.title}
                          </Link>
                          <span className="block text-xs text-muted-foreground">{d.source}</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{d.salesman ?? "—"}</TableCell>
                        <TableCell className="text-right">{formatMoney(d.value)}</TableCell>
                        <TableCell className="max-w-xs text-sm text-muted-foreground">
                          {d.reason || <span className="italic">no reason recorded</span>}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {d.decidedAt ? formatDate(d.decidedAt) : "—"}
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

function GroupCard({ title, rows }: { title: string; rows: WinLossGroup[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decided deals yet.</p>
        ) : (
          <>
            {/* Phone: stacked cards */}
            <div className="space-y-2 md:hidden">
              {rows.map((g) => (
                <div key={g.key} className="rounded-lg border p-3">
                  <div className="font-medium">{g.label}</div>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Won</div>
                      <div className="font-medium text-emerald-600">{g.won}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Lost</div>
                      <div className="font-medium text-destructive">{g.lost}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Win rate</div>
                      <div
                        className={cn(
                          "font-medium",
                          g.winRate < 50 ? "text-amber-600" : "text-emerald-600",
                        )}
                      >
                        {Math.round(g.winRate)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Won $</div>
                      <div className="font-medium">{formatMoney(g.wonValue)}</div>
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
                    <TableHead>{title.includes("source") ? "Source" : "Rep"}</TableHead>
                    <TableHead className="text-right">Won</TableHead>
                    <TableHead className="text-right">Lost</TableHead>
                    <TableHead className="text-right">Win rate</TableHead>
                    <TableHead className="text-right">Won $</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="font-medium">{g.label}</TableCell>
                      <TableCell className="text-right text-emerald-600">{g.won}</TableCell>
                      <TableCell className="text-right text-destructive">{g.lost}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium",
                          g.winRate < 50 ? "text-amber-600" : "text-emerald-600",
                        )}
                      >
                        {Math.round(g.winRate)}%
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatMoney(g.wonValue)}
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
  );
}
