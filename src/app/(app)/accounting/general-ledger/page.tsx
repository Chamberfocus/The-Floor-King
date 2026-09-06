import { requireRole } from "@/lib/auth";
import { REPORT_LABELS } from "@/lib/accounting/control-center";
import {
  fetchGeneralLedger,
  monthStartIso,
  todayIso,
} from "@/lib/data/accounting-reports";
import { listGlAccounts } from "@/lib/data/accounting";
import Link from "next/link";
import { BooksStatusBanner } from "../components/books-status-banner";
import { MoneyTable } from "../components/money-table";
import { formatMoney } from "@/lib/format";

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    start?: string;
    end?: string;
    accountId?: string;
    offset?: string;
  }>;
}) {
  await requireRole(["admin", "office"]);
  const sp = await searchParams;
  const today = todayIso();
  const start = sp.start || monthStartIso(today);
  const end = sp.end || today;
  const accountId = sp.accountId || null;
  const offset = Number(sp.offset || 0) || 0;
  const accounts = await listGlAccounts();
  const report = await fetchGeneralLedger({
    startDate: start,
    endDate: end,
    accountId,
    limit: 100,
    offset,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {REPORT_LABELS.generalLedger}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Posted journal lines only.
        </p>
      </div>
      <BooksStatusBanner
        books={report.books}
        source={report.source}
        fallbackReason={report.fallbackReason}
      />
      <form
        method="get"
        action="/accounting/general-ledger"
        className="flex flex-wrap items-end gap-3 text-sm"
      >
        <label className="block">
          Start
          <input
            type="date"
            name="start"
            defaultValue={start}
            className="mt-1 block rounded-md border px-2 py-1"
            required
          />
        </label>
        <label className="block">
          End
          <input
            type="date"
            name="end"
            defaultValue={end}
            className="mt-1 block rounded-md border px-2 py-1"
            required
          />
        </label>
        <label className="block">
          Account
          <select
            name="accountId"
            defaultValue={accountId ?? ""}
            className="mt-1 block min-w-[12rem] rounded-md border px-2 py-1"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id as string} value={a.id as string}>
                {(a.code as string) + " — " + (a.name as string)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-foreground px-3 py-1.5 text-background"
        >
          Run
        </button>
        <Link href="/accounting" className="underline text-muted-foreground">
          Control Center
        </Link>
      </form>
      <p className="text-xs text-muted-foreground">
        Showing {report.rows.length} of {report.pagination.total} ·{" "}
        <a
          className="underline"
          href={`/accounting/export?report=general-ledger&start=${start}&end=${end}${
            accountId ? `&accountId=${accountId}` : ""
          }`}
        >
          Export CSV
        </a>
      </p>
      <MoneyTable
        columns={[
          { key: "entryDate", label: "Date" },
          { key: "code", label: "Code" },
          { key: "name", label: "Account" },
          { key: "memo", label: "Memo" },
          { key: "debit", label: "Debit", align: "right", money: true },
          { key: "credit", label: "Credit", align: "right", money: true },
        ]}
        rows={report.rows.map((r) => ({
          entryDate: r.entryDate,
          code: r.accountCode,
          name: r.accountName,
          memo: r.memo,
          debit: r.debit || "",
          credit: r.credit || "",
        }))}
        emptyMessage="No posted GL activity in this range."
      />
      {report.pagination.hasMore ? (
        <a
          className="text-sm underline"
          href={`/accounting/general-ledger?start=${start}&end=${end}&offset=${
            offset + report.pagination.limit
          }${accountId ? `&accountId=${accountId}` : ""}`}
        >
          Next page
        </a>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Debit total (page):{" "}
        {formatMoney(report.rows.reduce((s, r) => s + r.debit, 0))}
      </p>
    </div>
  );
}
