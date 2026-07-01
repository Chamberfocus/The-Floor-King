import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, TrendingUp, TrendingDown, PackageX } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  getProductPerformance,
  getDeadStock,
} from "@/lib/data/product-performance";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Product performance" };
export const dynamic = "force-dynamic";

export default async function ProductPerformancePage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const [perf, dead] = await Promise.all([
    getProductPerformance(),
    getDeadStock(90),
  ]);

  const topSellers = [...perf].slice(0, 15);
  const worstMargin = [...perf]
    .filter((p) => p.revenue > 0)
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 10);
  const deadValue = dead.reduce((s, d) => s + d.value, 0);

  return (
    <div>
      <Link
        href="/reports"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to reports
      </Link>
      <PageHeader
        title="Product performance"
        description="What actually sells and earns — from products used on real jobs — plus stock that's tying up cash."
      />

      {perf.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No sold products yet. Once you create jobs from estimates that use
            catalog products, your best and worst sellers show up here.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Top sellers */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4 text-emerald-600" /> Top sellers by
                revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Phone: stacked cards */}
              <div className="space-y-2 md:hidden">
                {topSellers.map((p) => (
                  <div key={p.productId} className="rounded-lg border p-3">
                    <div className="font-medium">
                      {p.name}
                      {p.manufacturer ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {p.manufacturer}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Jobs</div>
                        <div className="font-medium">{p.jobs}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Units
                        </div>
                        <div className="font-medium">{Math.round(p.units)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Margin
                        </div>
                        <div className="font-medium">
                          {Math.round(p.margin)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Revenue
                        </div>
                        <div className="font-medium">
                          {formatMoney(p.revenue)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Profit
                        </div>
                        <div className="font-medium">
                          {formatMoney(p.profit)}
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
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Jobs</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topSellers.map((p) => (
                      <TableRow key={p.productId}>
                        <TableCell className="font-medium">
                          {p.name}
                          {p.manufacturer ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              {p.manufacturer}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {p.jobs}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {Math.round(p.units)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(p.revenue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(p.profit)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {Math.round(p.margin)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Worst margin */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingDown className="size-4 text-amber-600" /> Lowest-margin
                sellers — price these up or drop them
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Phone: stacked cards */}
              <div className="space-y-2 md:hidden">
                {worstMargin.map((p) => (
                  <div key={p.productId} className="rounded-lg border p-3">
                    <div className="font-medium">{p.name}</div>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Revenue
                        </div>
                        <div className="font-medium">
                          {formatMoney(p.revenue)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Cost</div>
                        <div className="font-medium">{formatMoney(p.cost)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Margin
                        </div>
                        <div
                          className={
                            p.margin < 20
                              ? "font-medium text-destructive"
                              : "font-medium text-amber-600"
                          }
                        >
                          {Math.round(p.margin)}%
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
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {worstMargin.map((p) => (
                      <TableRow key={p.productId}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatMoney(p.revenue)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatMoney(p.cost)}
                        </TableCell>
                        <TableCell
                          className={
                            p.margin < 20
                              ? "text-right font-medium text-destructive"
                              : "text-right font-medium text-amber-600"
                          }
                        >
                          {Math.round(p.margin)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Dead stock */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageX className="size-4 text-destructive" /> Dead stock —{" "}
            {formatMoney(deadValue)} tied up
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dead.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tracked stock has been sitting longer than 90 days. Nice.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                Tracked stock with no movement in 90+ days. Consider marking it
                clearance to move it and free up cash.
              </p>
              {/* Phone: stacked cards */}
              <div className="space-y-2 md:hidden">
                {dead.map((d) => (
                  <div key={d.product.id} className="rounded-lg border p-3">
                    <div className="font-medium">
                      <Link
                        href={`/inventory/${d.product.id}`}
                        className="hover:underline"
                      >
                        {d.product.name}
                      </Link>
                      {d.product.clearance ? (
                        <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">
                          clearance
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">
                          On hand
                        </div>
                        <div className="font-medium">{d.product.on_hand}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Idle days
                        </div>
                        <div className="font-medium">{d.idleDays}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Cash tied up
                        </div>
                        <div className="font-medium">{formatMoney(d.value)}</div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <Link
                        href={`/inventory/${d.product.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        Manage
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
              {/* Larger screens: table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Idle days</TableHead>
                      <TableHead className="text-right">Cash tied up</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dead.map((d) => (
                      <TableRow key={d.product.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/inventory/${d.product.id}`}
                            className="hover:underline"
                          >
                            {d.product.name}
                          </Link>
                          {d.product.clearance ? (
                            <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">
                              clearance
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {d.product.on_hand}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {d.idleDays}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(d.value)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/inventory/${d.product.id}`}
                            className="text-sm font-medium hover:underline"
                          >
                            Manage
                          </Link>
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
