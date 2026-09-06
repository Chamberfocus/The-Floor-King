/**
 * F3 journal validation — pure double-entry rules (no DB).
 */
import {
  DOUBLE_REVERSAL_MESSAGE,
  JOURNAL_IMMUTABLE_MESSAGE,
  PERIOD_CLOSED_MESSAGE,
  PERIOD_LOCKED_MESSAGE,
  UNBALANCED_JOURNAL_MESSAGE,
  type AccountingPeriodStatus,
  type JournalEntryKind,
  type JournalLineInput,
} from "@/lib/accounting/types";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function lineDebit(line: JournalLineInput): number {
  return round2(Math.max(0, Number(line.debit) || 0));
}

export function lineCredit(line: JournalLineInput): number {
  return round2(Math.max(0, Number(line.credit) || 0));
}

export function sumDebits(lines: JournalLineInput[]): number {
  return round2(lines.reduce((s, l) => s + lineDebit(l), 0));
}

export function sumCredits(lines: JournalLineInput[]): number {
  return round2(lines.reduce((s, l) => s + lineCredit(l), 0));
}

export function assessJournalLine(
  line: JournalLineInput,
): { ok: true } | { ok: false; error: string } {
  if (!line.accountId) {
    return { ok: false, error: "Journal line requires an account." };
  }
  const d = lineDebit(line);
  const c = lineCredit(line);
  if (d < 0 || c < 0) {
    return { ok: false, error: "Journal line amounts cannot be negative." };
  }
  if (d === 0 && c === 0) {
    return { ok: false, error: "Journal line must have a debit or credit amount." };
  }
  if (d > 0 && c > 0) {
    return {
      ok: false,
      error: "Journal line cannot debit and credit simultaneously.",
    };
  }
  return { ok: true };
}

export function assessJournalBalance(
  lines: JournalLineInput[],
): { ok: true; debits: number; credits: number } | { ok: false; error: string } {
  if (lines.length < 2) {
    return { ok: false, error: "Journal requires at least two lines." };
  }
  for (const line of lines) {
    const gate = assessJournalLine(line);
    if (!gate.ok) return gate;
  }
  const debits = sumDebits(lines);
  const credits = sumCredits(lines);
  if (debits <= 0) {
    return { ok: false, error: "Journal total must be greater than zero." };
  }
  if (Math.abs(debits - credits) > 0.005) {
    return {
      ok: false,
      error: `${UNBALANCED_JOURNAL_MESSAGE} Debits ${debits.toFixed(2)} ≠ credits ${credits.toFixed(2)}.`,
    };
  }
  return { ok: true, debits, credits };
}

export function assessPeriodPosting(args: {
  periodStatus: AccountingPeriodStatus | null | undefined;
  /** Kept for call-site compatibility; closed/locked block all kinds. */
  entryKind: JournalEntryKind;
}): { ok: true } | { ok: false; error: string } {
  const status = args.periodStatus;
  if (!status) {
    return { ok: false, error: "No accounting period covers this entry date." };
  }
  // Strict policy: closed/locked periods accept NO posts — including reversals.
  // Reverse into an OPEN period date (typically today) so history is not rewritten.
  if (status === "locked") {
    return { ok: false, error: PERIOD_LOCKED_MESSAGE };
  }
  if (status === "closed") {
    return { ok: false, error: PERIOD_CLOSED_MESSAGE };
  }
  return { ok: true };
}

export function assessPostedImmutability(args: {
  status: string;
  operation: "update" | "delete";
}): { ok: true } | { ok: false; error: string } {
  if (args.status === "posted") {
    return { ok: false, error: JOURNAL_IMMUTABLE_MESSAGE };
  }
  return { ok: true };
}

export function buildReversalLines(
  originalLines: JournalLineInput[],
): JournalLineInput[] {
  return originalLines.map((l) => ({
    accountId: l.accountId,
    debit: lineCredit(l) || undefined,
    credit: lineDebit(l) || undefined,
    memo: l.memo ? `Reversal: ${l.memo}` : "Reversal",
    customerId: l.customerId,
    vendorId: l.vendorId,
    jobId: l.jobId,
    invoiceId: l.invoiceId,
    billId: l.billId,
  }));
}

export function assessReversal(args: {
  originalStatus: string;
  alreadyReversed: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (args.originalStatus !== "posted") {
    return { ok: false, error: "Only posted journals can be reversed." };
  }
  if (args.alreadyReversed) {
    return { ok: false, error: DOUBLE_REVERSAL_MESSAGE };
  }
  return { ok: true };
}

export function periodContainsDate(
  period: { start_date: string; end_date: string },
  entryDate: string,
): boolean {
  return entryDate >= period.start_date && entryDate <= period.end_date;
}

export function findPeriodForDate<
  T extends { start_date: string; end_date: string; status: AccountingPeriodStatus },
>(periods: T[], entryDate: string): T | null {
  return (
    periods.find((p) => periodContainsDate(p, entryDate)) ?? null
  );
}
