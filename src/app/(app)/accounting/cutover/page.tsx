import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { REPORT_LABELS } from "@/lib/accounting/control-center";
import { fetchCutoverSnapshot } from "@/lib/data/accounting-reports";
import { BooksStatusBanner } from "../components/books-status-banner";

export default async function CutoverPage() {
  await requireRole(["admin", "office"]);
  const report = await fetchCutoverSnapshot();

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {REPORT_LABELS.cutover}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only readiness — does not enable posting or books-of-record.
        </p>
      </div>
      <BooksStatusBanner
        books={report.books}
        source={report.source}
        fallbackReason={report.fallbackReason}
      />
      <p className="text-sm">
        Verdict:{" "}
        <strong
          className={
            report.verdict === "NOT_READY"
              ? "text-destructive"
              : "text-amber-700"
          }
        >
          {report.verdict}
        </strong>
        {" · "}
        <Link href="/accounting" className="underline">
          Control Center
        </Link>
      </p>
      {report.blockers.length > 0 ? (
        <div className="rounded-lg border border-destructive/30 p-4 text-sm">
          <h2 className="font-medium text-destructive">Blockers</h2>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {report.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.warnings.length > 0 ? (
        <div className="rounded-lg border p-4 text-sm">
          <h2 className="font-medium">Warnings</h2>
          <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded-lg border p-4 text-sm">
        <h2 className="font-medium">Checklist</h2>
        <ul className="mt-2 grid gap-1 text-xs md:grid-cols-2">
          {Object.entries(report.checklist).map(([k, v]) => (
            <li key={k}>
              {k}: <strong>{String(v)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
