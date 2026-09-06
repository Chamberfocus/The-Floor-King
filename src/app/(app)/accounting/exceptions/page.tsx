import { requireRole } from "@/lib/auth";
import {
  exceptionSeverityOrder,
  exceptionSeverityRank,
  REPORT_LABELS,
} from "@/lib/accounting/control-center";
import { fetchExceptions, fetchRecons, todayIso } from "@/lib/data/accounting-reports";
import { BooksStatusBanner } from "../components/books-status-banner";
import Link from "next/link";

export default async function ExceptionsPage() {
  await requireRole(["admin", "office"]);
  const [report, recons] = await Promise.all([
    fetchExceptions(),
    fetchRecons(todayIso()),
  ]);
  const sorted = [...report.exceptions].sort(
    (a, b) => exceptionSeverityRank(a.severity) - exceptionSeverityRank(b.severity),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {REPORT_LABELS.exceptions}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Integrity + control recon exceptions as of {report.asOf}.
        </p>
      </div>
      <BooksStatusBanner
        books={report.books}
        source={report.source}
        fallbackReason={report.fallbackReason}
      />
      <p className="text-sm">
        <Link href="/accounting" className="underline">
          Control Center
        </Link>
      </p>
      <div className="grid gap-2 sm:grid-cols-4 text-sm">
        {exceptionSeverityOrder.map((sev) => {
          const key =
            sev === "EXPECTED_NOT_ACTIVE"
              ? "expected_not_active"
              : (sev.toLowerCase() as "critical" | "high" | "warning");
          const count =
            sev === "EXPECTED_NOT_ACTIVE"
              ? report.counts.expected_not_active
              : report.counts[key];
          return (
            <div key={sev} className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{sev}</div>
              <div className="font-medium">{count}</div>
            </div>
          );
        })}
      </div>
      <ul className="space-y-2 text-sm">
        {sorted.map((e, i) => (
          <li key={`${e.code}-${i}`} className="rounded-md border px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{e.code}</span>
              <span className="text-xs text-muted-foreground">{e.severity}</span>
            </div>
            <p className="mt-1 text-xs">{e.message}</p>
          </li>
        ))}
        {sorted.length === 0 ? (
          <li className="text-muted-foreground">No exceptions.</li>
        ) : null}
      </ul>
      <section className="rounded-lg border p-4 text-sm space-y-2">
        <h2 className="font-medium">Control recons</h2>
        <ul className="grid gap-1 text-xs md:grid-cols-2">
          <li>
            AR: {String(recons.ar?.status ?? "—")}
          </li>
          <li>
            AP: {String(recons.ap?.status ?? "—")}
          </li>
          <li>
            Inventory: {String(recons.inventory?.status ?? "—")}
          </li>
          <li>
            Cash: {String(recons.cash?.status ?? "—")}
          </li>
        </ul>
      </section>
    </div>
  );
}
