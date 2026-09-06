import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  fetchGeneralLedger,
  fetchTrialBalance,
  monthStartIso,
  todayIso,
} from "@/lib/data/accounting-reports";

export const dynamic = "force-dynamic";

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Thin CSV export for Trial Balance / General Ledger.
 * Admin/office only — warehouse never reaches this route via nav.
 */
export async function GET(request: Request) {
  await requireRole(["admin", "office"]);
  const url = new URL(request.url);
  const report = url.searchParams.get("report") || "trial-balance";
  const today = todayIso();

  if (report === "trial-balance") {
    const asOf = url.searchParams.get("asOf") || today;
    const tb = await fetchTrialBalance(asOf);
    const lines = [
      ["code", "name", "account_type", "debit", "credit", "balance"].join(","),
      ...tb.rows.map((r) =>
        [
          csvEscape(r.code),
          csvEscape(r.name),
          csvEscape(r.accountType),
          r.totalDebit,
          r.totalCredit,
          r.balance,
        ].join(","),
      ),
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="trial-balance-${asOf}.csv"`,
      },
    });
  }

  if (report === "general-ledger") {
    const start = url.searchParams.get("start") || monthStartIso(today);
    const end = url.searchParams.get("end") || today;
    const accountId = url.searchParams.get("accountId");
    const gl = await fetchGeneralLedger({
      startDate: start,
      endDate: end,
      accountId: accountId || null,
      limit: 1000,
      offset: 0,
    });
    const lines = [
      [
        "entry_date",
        "journal_entry_id",
        "account_code",
        "account_name",
        "debit",
        "credit",
        "memo",
      ].join(","),
      ...gl.rows.map((r) =>
        [
          csvEscape(r.entryDate),
          csvEscape(r.journalEntryId),
          csvEscape(r.accountCode),
          csvEscape(r.accountName),
          r.debit,
          r.credit,
          csvEscape(r.memo),
        ].join(","),
      ),
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="general-ledger-${start}-${end}.csv"`,
      },
    });
  }

  return NextResponse.json(
    { error: "Unknown report. Use trial-balance or general-ledger." },
    { status: 400 },
  );
}
