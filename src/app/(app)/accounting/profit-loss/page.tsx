import { requireRole } from "@/lib/auth";
import { REPORT_LABELS } from "@/lib/accounting/control-center";
import {
  fetchPnL,
  monthStartIso,
  todayIso,
} from "@/lib/data/accounting-reports";
import { BooksStatusBanner } from "../components/books-status-banner";
import { ReportDateForm } from "../components/report-date-form";
import { formatMoney } from "@/lib/format";

export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  await requireRole(["admin", "office"]);
  const sp = await searchParams;
  const today = todayIso();
  const start = sp.start || monthStartIso(today);
  const end = sp.end || today;
  const report = await fetchPnL(start, end);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {REPORT_LABELS.profitLoss}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Accounting P&amp;L from posted journals — not Operations / Pulse.
        </p>
      </div>
      <BooksStatusBanner
        books={report.books}
        source={report.source}
        fallbackReason={report.fallbackReason}
      />
      <ReportDateForm
        mode="range"
        start={start}
        end={end}
        actionPath="/accounting/profit-loss"
      />
      <dl className="max-w-md space-y-2 rounded-lg border p-4 text-sm">
        <div className="flex justify-between">
          <dt>Revenue</dt>
          <dd>{formatMoney(report.revenue)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>COGS</dt>
          <dd>{formatMoney(report.cogs)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Gross profit</dt>
          <dd>{formatMoney(report.grossProfit)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Operating expenses</dt>
          <dd>{formatMoney(report.operatingExpenses)}</dd>
        </div>
        <div className="flex justify-between font-medium border-t pt-2">
          <dt>Net income</dt>
          <dd>{formatMoney(report.netIncome)}</dd>
        </div>
      </dl>
    </div>
  );
}
