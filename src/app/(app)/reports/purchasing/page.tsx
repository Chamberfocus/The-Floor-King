import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Building2, Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireProfile } from "@/lib/auth";
import { getPurchasingSpend, type SpendRow } from "@/lib/data/purchase-orders";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Purchasing spend" };
export const dynamic = "force-dynamic";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function SpendTable({
  title,
  icon: Icon,
  rows,
  unit,
}: {
  title: string;
  icon: typeof Building2;
  rows: SpendRow[];
  unit: string;
}) {
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" /> {title}
      </h2>
      {rows.length === 0 ? (
        <EmptyState title={`No ${unit} spend in this period`} className="py-8" />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{unit}</th>
                <th className="px-3 py-2 text-right">POs</th>
                <th className="px-3 py-2 text-right">Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.key} className="tabular-nums">
                  <td className="px-3 py-2 text-left">
                    <span className="font-medium">{r.label}</span>
                    {r.kind ? (
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {r.kind}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">{r.pos}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(r.spend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default async function PurchasingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const profile = await requireProfile();
  if (!["admin", "office", "sales_manager"].includes(profile.role)) redirect("/");

  const sp = await searchParams;
  const today = new Date();
  const end = sp.end || isoDay(today);
  const start = sp.start || isoDay(new Date(today.getFullYear(), today.getMonth(), 1));

  const { byVendor, byManufacturer, total } = await getPurchasingSpend(
    `${start}T00:00:00`,
    `${end}T23:59:59`,
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/reports"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Reports
      </Link>
      <PageHeader
        title="Purchasing spend"
        description="Two different questions: how much you paid each VENDOR, and how much of each MANUFACTURER's product you moved. Issued (non-void) POs only."
      />

      <form method="get" className="mb-5 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">From</label>
          <DateField name="start" defaultValue={start} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">To</label>
          <DateField name="end" defaultValue={end} />
        </div>
        <Button type="submit" variant="outline">Update</Button>
        <div className="ml-auto self-center text-sm">
          <span className="text-muted-foreground">Total purchased: </span>
          <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
        </div>
      </form>

      <div className="space-y-8">
        <SpendTable title="Spend by vendor (who we paid)" icon={Building2} rows={byVendor} unit="Vendor" />
        <SpendTable
          title="Spend by manufacturer (whose product we moved)"
          icon={Factory}
          rows={byManufacturer}
          unit="Manufacturer"
        />
      </div>
    </div>
  );
}
