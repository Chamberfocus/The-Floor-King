import { requireRole } from "@/lib/auth";
import {
  agingBucketLabels,
  REPORT_LABELS,
  type AgingBucketKey,
} from "@/lib/accounting/control-center";
import { fetchApAging, todayIso } from "@/lib/data/accounting-reports";
import { BooksStatusBanner } from "../components/books-status-banner";
import { ReportDateForm } from "../components/report-date-form";
import { MoneyTable } from "../components/money-table";
import { formatMoney } from "@/lib/format";

export default async function ApAgingPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  await requireRole(["admin", "office"]);
  const sp = await searchParams;
  const asOf = sp.asOf || todayIso();
  const report = await fetchApAging(asOf);
  const buckets = Object.keys(agingBucketLabels) as AgingBucketKey[];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {REPORT_LABELS.apAging}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open AP as of {asOf}.
        </p>
      </div>
      <BooksStatusBanner
        books={report.books}
        source={report.source}
        fallbackReason={report.fallbackReason}
      />
      <ReportDateForm mode="asOf" asOf={asOf} actionPath="/accounting/ap-aging" />
      <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-6 text-sm">
        {buckets.map((b) => (
          <div key={b} className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">
              {agingBucketLabels[b]}
            </div>
            <div className="font-medium">{formatMoney(report.totals[b])}</div>
          </div>
        ))}
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="font-medium">{formatMoney(report.total)}</div>
        </div>
      </div>
      <MoneyTable
        columns={[
          { key: "reference", label: "Bill" },
          { key: "dueDate", label: "Due" },
          { key: "bucket", label: "Bucket" },
          { key: "days", label: "Days", align: "right" },
          { key: "balance", label: "Balance", align: "right", money: true },
        ]}
        rows={report.rows.map((r) => ({
          reference: r.reference,
          dueDate: r.dueDate,
          bucket: agingBucketLabels[r.bucket] ?? r.bucket,
          days: r.daysPastDue,
          balance: r.balance,
        }))}
        emptyMessage="No open AP."
      />
    </div>
  );
}
