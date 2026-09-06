import { requireRole } from "@/lib/auth";
import { REPORT_LABELS } from "@/lib/accounting/control-center";
import { fetchTrialBalance, todayIso } from "@/lib/data/accounting-reports";
import { BooksStatusBanner } from "../components/books-status-banner";
import { ReportDateForm } from "../components/report-date-form";
import { MoneyTable } from "../components/money-table";
import { formatMoney } from "@/lib/format";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  await requireRole(["admin", "office"]);
  const sp = await searchParams;
  const asOf = sp.asOf || todayIso();
  const report = await fetchTrialBalance(asOf);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {REPORT_LABELS.trialBalance}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Posted journals through {asOf}.
        </p>
      </div>
      <BooksStatusBanner
        books={report.books}
        source={report.source}
        fallbackReason={report.fallbackReason}
      />
      <ReportDateForm mode="asOf" asOf={asOf} actionPath="/accounting/trial-balance" />
      {report.criticalError ? (
        <p className="text-sm text-destructive">{report.criticalError}</p>
      ) : (
        <p className="text-sm text-emerald-700">
          Balanced · Debits {formatMoney(report.totalDebits)} · Credits{" "}
          {formatMoney(report.totalCredits)}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        <a
          className="underline"
          href={`/accounting/export?report=trial-balance&asOf=${asOf}`}
        >
          Export CSV
        </a>
      </p>
      <MoneyTable
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Account" },
          { key: "debit", label: "Debit", align: "right", money: true },
          { key: "credit", label: "Credit", align: "right", money: true },
        ]}
        rows={report.rows.map((r) => ({
          code: r.code,
          name: r.name,
          debit: r.totalDebit || "",
          credit: r.totalCredit || "",
        }))}
        emptyMessage="No posted journal activity yet."
      />
    </div>
  );
}
