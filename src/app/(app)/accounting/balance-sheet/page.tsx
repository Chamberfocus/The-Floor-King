import { requireRole } from "@/lib/auth";
import { REPORT_LABELS } from "@/lib/accounting/control-center";
import { fetchBalanceSheet, todayIso } from "@/lib/data/accounting-reports";
import { BooksStatusBanner } from "../components/books-status-banner";
import { ReportDateForm } from "../components/report-date-form";
import { formatMoney } from "@/lib/format";

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  await requireRole(["admin", "office"]);
  const sp = await searchParams;
  const asOf = sp.asOf || todayIso();
  const report = await fetchBalanceSheet(asOf);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {REPORT_LABELS.balanceSheet}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          As of {asOf}. Equity includes net income to date.
        </p>
      </div>
      <BooksStatusBanner
        books={report.books}
        source={report.source}
        fallbackReason={report.fallbackReason}
      />
      <ReportDateForm
        mode="asOf"
        asOf={asOf}
        actionPath="/accounting/balance-sheet"
      />
      {report.criticalError ? (
        <p className="text-sm text-destructive">{report.criticalError}</p>
      ) : (
        <p className="text-sm text-emerald-700">In balance</p>
      )}
      <dl className="max-w-md space-y-2 rounded-lg border p-4 text-sm">
        <div className="flex justify-between">
          <dt>Assets</dt>
          <dd>{formatMoney(report.assets)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Liabilities</dt>
          <dd>{formatMoney(report.liabilities)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Equity</dt>
          <dd>{formatMoney(report.equity)}</dd>
        </div>
        <div className="flex justify-between font-medium border-t pt-2">
          <dt>Equity (+ NI)</dt>
          <dd>{formatMoney(report.equityWithIncome)}</dd>
        </div>
      </dl>
    </div>
  );
}
