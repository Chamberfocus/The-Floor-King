/**
 * F6-P2C bank reconciliation — pure matching, suggestions, and server-math mirror.
 * Aligned with hardened 0173 bank_reconciliation_compute_package.
 */
import { isEligibleCashAccountSubtype } from "@/lib/accounting/f5-rpc-auth";
import { isEconomicBankImportLine } from "@/lib/accounting/bank-import";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type BankReconStatus =
  | "draft"
  | "in_progress"
  | "reconciled"
  | "void"
  | "open"
  | "completed"
  | "cancelled";

export interface BankImportLineView {
  id: string;
  sourceRowNo: number;
  transactionDate: string | null;
  description: string;
  amount: number;
  direction: "deposit" | "withdrawal";
  duplicateStatus: string;
  reviewStatus: string;
  matchedAmount: number;
}

export interface JournalBankLineView {
  journalLineId: string;
  entryDate: string;
  debit: number;
  credit: number;
  memo?: string | null;
  matchedAmount: number;
}

export interface BankMatchView {
  id: string;
  importLineId: string;
  journalLineId: string;
  allocatedAmount: number;
  status: string;
  sessionId?: string;
  sessionStatus?: string;
}

export interface ReconciliationPackage {
  openingBalance: number;
  endingBalance: number;
  bankDeposits: number;
  bankWithdrawals: number;
  statementCalculatedEnding: number;
  statementEquationDifference: number;
  matchedDebit: number;
  matchedCredit: number;
  calculatedEndingFromCleared: number;
  legacyMatchedDifference: number;
  remainingBankDeposits: number;
  remainingBankWithdrawals: number;
  outstandingBookDebit: number;
  outstandingBookCredit: number;
  glBalanceThroughEnd: number;
  adjustedBankBalance: number;
  bookVsAdjustedDifference: number;
  /** Alias of bookVsAdjustedDifference for UI compatibility. */
  reconciliationDifference: number;
  unmatchedBankDeposits: number;
  unmatchedBankWithdrawals: number;
  unresolvedPossibleDuplicates: number;
  unresolvedRejected: number;
  rejectedCount: number;
  canFinalize: boolean;
}

export function bankReconStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "in_progress":
    case "open":
      return "In progress";
    case "reconciled":
    case "completed":
      return "Reconciled";
    case "void":
      return "Void";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function isBankReconEditable(status: string): boolean {
  return ["draft", "in_progress", "open"].includes(status);
}

/** Successfully finalized — blocks overlapping replacement. */
export function isBankReconSuccessfullyFinalized(status: string): boolean {
  return ["reconciled", "completed"].includes(status);
}

/** Terminal void/cancel — history only; does NOT block replacement. */
export function isBankReconTerminal(status: string): boolean {
  return ["void", "cancelled"].includes(status);
}

/**
 * Mirror of prevent_finalized_bank_recon_mutation void-gate:
 * reconciled/completed → void requires prior_status = old.status and void metadata.
 */
export function assessFinalizedVoidTransition(args: {
  old: {
    status: string;
    accountId: string;
    statementStart: string;
    statementEnd: string;
    openingBalance: number;
    endingBalance: number;
    importBatchId: string | null;
    finalSnapshot: unknown;
    calculatedEndingBalance: number | null;
    difference: number | null;
    idempotencyKey: string | null;
    createdBy: string | null;
    completedBy: string | null;
    completedAt: string | null;
    notes: string | null;
  };
  next: {
    status: string;
    priorStatus: string | null;
    accountId: string;
    statementStart: string;
    statementEnd: string;
    openingBalance: number;
    endingBalance: number;
    importBatchId: string | null;
    finalSnapshot: unknown;
    calculatedEndingBalance: number | null;
    difference: number | null;
    idempotencyKey: string | null;
    createdBy: string | null;
    completedBy: string | null;
    completedAt: string | null;
    notes: string | null;
    voidReason: string | null;
    voidedBy: string | null;
    voidedAt: string | null;
  };
  booksOfRecord: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!isBankReconSuccessfullyFinalized(args.old.status)) {
    return { ok: false, error: "Only finalized reconciliations void to void status." };
  }
  if (args.booksOfRecord) {
    return {
      ok: false,
      error:
        "Cannot void reconciliations after books_of_record is enabled without a controlled reversal workflow.",
    };
  }
  if (args.next.status !== "void") {
    return { ok: false, error: "Void transition must set status to void." };
  }
  if (args.next.priorStatus !== args.old.status) {
    return {
      ok: false,
      error: "prior_status must equal the finalized status being vacated.",
    };
  }
  const immutableEqual =
    args.next.accountId === args.old.accountId &&
    args.next.statementStart === args.old.statementStart &&
    args.next.statementEnd === args.old.statementEnd &&
    args.next.openingBalance === args.old.openingBalance &&
    args.next.endingBalance === args.old.endingBalance &&
    args.next.importBatchId === args.old.importBatchId &&
    args.next.finalSnapshot === args.old.finalSnapshot &&
    args.next.calculatedEndingBalance === args.old.calculatedEndingBalance &&
    args.next.difference === args.old.difference &&
    args.next.idempotencyKey === args.old.idempotencyKey &&
    args.next.createdBy === args.old.createdBy &&
    args.next.completedBy === args.old.completedBy &&
    args.next.completedAt === args.old.completedAt &&
    args.next.notes === args.old.notes;
  if (!immutableEqual) {
    return { ok: false, error: "Finalized reconciliation evidence is immutable." };
  }
  if (!args.next.voidReason?.trim()) {
    return { ok: false, error: "Void reason is required." };
  }
  if (!args.next.voidedBy || !args.next.voidedAt) {
    return { ok: false, error: "voided_by and voided_at are required." };
  }
  return { ok: true };
}

/** After void, further mutation of history/void metadata remains blocked. */
export function assessPostVoidImmutability(args: {
  field: string;
  attemptedChange: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (args.attemptedChange) {
    return {
      ok: false,
      error: `Cannot mutate ${args.field} after finalized void.`,
    };
  }
  return { ok: true };
}

/** @deprecated use isBankReconSuccessfullyFinalized / isBankReconTerminal */
export function isBankReconFinal(status: string): boolean {
  return isBankReconSuccessfullyFinalized(status) || isBankReconTerminal(status);
}

export function isEligibleBankReconAccount(args: {
  accountType: string;
  subtype: string | null;
  isActive: boolean;
  mappedAsCashOperating?: boolean;
  mappedAsUndeposited?: boolean;
}): boolean {
  if (!args.isActive) return false;
  if (args.mappedAsCashOperating || args.mappedAsUndeposited) return true;
  if (args.accountType !== "asset") return false;
  return isEligibleCashAccountSubtype(args.subtype);
}

/** void/cancelled parents preserve matches but do not reserve capacity. */
export function isEffectiveMatchParentStatus(status: string): boolean {
  return !isBankReconTerminal(status);
}

/** Effective active match for allocation/clearing (mirrors 0173 SQL). */
export function isEffectiveActiveMatch(
  match: BankMatchView,
  currentSessionId?: string,
): boolean {
  if (match.status !== "active") return false;
  const parentStatus = match.sessionStatus;
  if (parentStatus == null) {
    return (
      currentSessionId == null ||
      match.sessionId == null ||
      match.sessionId === currentSessionId
    );
  }
  if (!isEffectiveMatchParentStatus(parentStatus)) return false;
  if (isBankReconSuccessfullyFinalized(parentStatus)) return true;
  return (
    currentSessionId != null &&
    match.sessionId === currentSessionId &&
    isBankReconEditable(parentStatus)
  );
}

export function effectiveAllocatedByImport(
  matches: BankMatchView[],
  importLineId: string,
  currentSessionId?: string,
): number {
  return round2(
    matches
      .filter(
        (m) =>
          m.importLineId === importLineId &&
          isEffectiveActiveMatch(m, currentSessionId),
      )
      .reduce((s, m) => s + m.allocatedAmount, 0),
  );
}

export function effectiveAllocatedByJournal(
  matches: BankMatchView[],
  journalLineId: string,
  currentSessionId?: string,
): number {
  return round2(
    matches
      .filter(
        (m) =>
          m.journalLineId === journalLineId &&
          isEffectiveActiveMatch(m, currentSessionId),
      )
      .reduce((s, m) => s + m.allocatedAmount, 0),
  );
}

export function journalBankImpact(args: {
  debit: number;
  credit: number;
}): { ok: true; amount: number; side: "debit" | "credit" } | { ok: false; error: string } {
  const d = round2(args.debit);
  const c = round2(args.credit);
  if (d > 0 && c > 0) {
    return { ok: false, error: "Journal line must be one-sided." };
  }
  if (d <= 0 && c <= 0) {
    return { ok: false, error: "Journal line has zero bank impact." };
  }
  if (d > 0) return { ok: true, amount: d, side: "debit" };
  return { ok: true, amount: c, side: "credit" };
}

export function computeReconciliationPackage(args: {
  openingBalance: number;
  endingBalance: number;
  bankLines: BankImportLineView[];
  journalLines: JournalBankLineView[];
  matches: BankMatchView[];
  /** Optional full GL balance through statement end (defaults to sum of journalLines). */
  glBalanceThroughEnd?: number;
  /** Current reconciliation session id for effective-allocation math. */
  currentSessionId?: string;
}): ReconciliationPackage {
  const currentSessionId = args.currentSessionId;
  const effectiveMatches = args.matches.filter((m) =>
    isEffectiveActiveMatch(m, currentSessionId),
  );
  const currentSessionMatches = args.matches.filter(
    (m) =>
      m.status === "active" &&
      (currentSessionId == null ||
        m.sessionId == null ||
        m.sessionId === currentSessionId),
  );
  const matchedByImport = new Map<string, number>();
  const matchedByJournal = new Map<string, number>();
  for (const m of effectiveMatches) {
    matchedByImport.set(
      m.importLineId,
      round2((matchedByImport.get(m.importLineId) ?? 0) + m.allocatedAmount),
    );
    matchedByJournal.set(
      m.journalLineId,
      round2((matchedByJournal.get(m.journalLineId) ?? 0) + m.allocatedAmount),
    );
  }

  let bankDeposits = 0;
  let bankWithdrawals = 0;
  let remainingBankDeposits = 0;
  let remainingBankWithdrawals = 0;
  let unmatchedBankDeposits = 0;
  let unmatchedBankWithdrawals = 0;
  let unresolvedPossibleDuplicates = 0;
  let unresolvedRejected = 0;
  let rejectedCount = 0;
  let matchedDebit = 0;
  let matchedCredit = 0;

  for (const line of args.bankLines) {
    if (line.duplicateStatus === "rejected") {
      rejectedCount += 1;
      if (line.reviewStatus !== "excluded") unresolvedRejected += 1;
      continue;
    }
    if (
      line.duplicateStatus === "possible_duplicate" &&
      line.reviewStatus === "pending"
    ) {
      unresolvedPossibleDuplicates += 1;
    }
    if (!isEconomicBankImportLine(line)) continue;

    const allocated = matchedByImport.get(line.id) ?? 0;
    const remaining = round2(line.amount - allocated);

    if (line.direction === "deposit") {
      bankDeposits = round2(bankDeposits + line.amount);
      if (remaining > 0.004) {
        remainingBankDeposits = round2(remainingBankDeposits + remaining);
        unmatchedBankDeposits = remainingBankDeposits;
      }
    } else {
      bankWithdrawals = round2(bankWithdrawals + line.amount);
      if (remaining > 0.004) {
        remainingBankWithdrawals = round2(remainingBankWithdrawals + remaining);
        unmatchedBankWithdrawals = remainingBankWithdrawals;
      }
    }
  }

  for (const m of currentSessionMatches) {
    const bank = args.bankLines.find((b) => b.id === m.importLineId);
    if (!bank || !isEconomicBankImportLine(bank)) continue;
    if (bank.direction === "deposit") {
      matchedDebit = round2(matchedDebit + m.allocatedAmount);
    } else {
      matchedCredit = round2(matchedCredit + m.allocatedAmount);
    }
  }

  let outstandingBookDebit = 0;
  let outstandingBookCredit = 0;
  for (const jl of args.journalLines) {
    const impact = journalBankImpact({ debit: jl.debit, credit: jl.credit });
    if (!impact.ok) continue;
    const alloc = matchedByJournal.get(jl.journalLineId) ?? 0;
    const remaining = round2(impact.amount - alloc);
    if (remaining <= 0.004) continue;
    if (impact.side === "debit") {
      outstandingBookDebit = round2(outstandingBookDebit + remaining);
    } else {
      outstandingBookCredit = round2(outstandingBookCredit + remaining);
    }
  }

  const statementCalculatedEnding = round2(
    args.openingBalance + bankDeposits - bankWithdrawals,
  );
  const statementEquationDifference = round2(
    statementCalculatedEnding - args.endingBalance,
  );
  const calculatedEndingFromCleared = round2(
    args.openingBalance + matchedDebit - matchedCredit,
  );
  const legacyMatchedDifference = round2(
    args.endingBalance - calculatedEndingFromCleared,
  );
  const glBalanceThroughEnd =
    args.glBalanceThroughEnd !== undefined
      ? round2(args.glBalanceThroughEnd)
      : round2(args.journalLines.reduce((s, l) => round2(s + l.debit - l.credit), 0));
  const adjustedBankBalance = round2(
    args.endingBalance + outstandingBookDebit - outstandingBookCredit,
  );
  const bookVsAdjustedDifference = round2(glBalanceThroughEnd - adjustedBankBalance);

  const canFinalize =
    Math.abs(statementEquationDifference) <= 0.005 &&
    Math.abs(bookVsAdjustedDifference) <= 0.005 &&
    remainingBankDeposits <= 0.005 &&
    remainingBankWithdrawals <= 0.005 &&
    unresolvedPossibleDuplicates === 0 &&
    unresolvedRejected === 0;

  return {
    openingBalance: args.openingBalance,
    endingBalance: args.endingBalance,
    bankDeposits,
    bankWithdrawals,
    statementCalculatedEnding,
    statementEquationDifference,
    matchedDebit,
    matchedCredit,
    calculatedEndingFromCleared,
    legacyMatchedDifference,
    remainingBankDeposits,
    remainingBankWithdrawals,
    outstandingBookDebit,
    outstandingBookCredit,
    glBalanceThroughEnd,
    adjustedBankBalance,
    bookVsAdjustedDifference,
    reconciliationDifference: bookVsAdjustedDifference,
    unmatchedBankDeposits,
    unmatchedBankWithdrawals,
    unresolvedPossibleDuplicates,
    unresolvedRejected,
    rejectedCount,
    canFinalize,
  };
}

export interface MatchSuggestion {
  importLineId: string;
  journalLineId: string;
  allocatedAmount: number;
  score: number;
  reasons: string[];
}

/** Deterministic suggestions — never auto-applied. */
export function suggestBankMatches(args: {
  bankLines: BankImportLineView[];
  journalLines: JournalBankLineView[];
  matches: BankMatchView[];
  currentSessionId?: string;
  statementEnd?: string;
}): MatchSuggestion[] {
  const suggestions: MatchSuggestion[] = [];
  const matchedByImport = new Map<string, number>();
  const matchedByJournal = new Map<string, number>();
  for (const m of args.matches.filter((x) => x.status === "active")) {
    if (!isEffectiveActiveMatch(m, args.currentSessionId)) continue;
    matchedByImport.set(
      m.importLineId,
      round2((matchedByImport.get(m.importLineId) ?? 0) + m.allocatedAmount),
    );
    matchedByJournal.set(
      m.journalLineId,
      round2((matchedByJournal.get(m.journalLineId) ?? 0) + m.allocatedAmount),
    );
  }

  for (const bank of args.bankLines) {
    if (!isEconomicBankImportLine(bank)) continue;
    if (
      bank.duplicateStatus === "possible_duplicate" &&
      bank.reviewStatus === "pending"
    ) {
      continue;
    }
    const bankAlloc = matchedByImport.get(bank.id) ?? 0;
    const bankRemaining = round2(bank.amount - bankAlloc);
    if (bankRemaining <= 0.004) continue;

    for (const jl of args.journalLines) {
      const impact = journalBankImpact({ debit: jl.debit, credit: jl.credit });
      if (!impact.ok) continue;
      if (bank.direction === "deposit" && impact.side !== "debit") continue;
      if (bank.direction === "withdrawal" && impact.side !== "credit") continue;
      if (args.statementEnd && jl.entryDate > args.statementEnd) continue;

      const jlAlloc = matchedByJournal.get(jl.journalLineId) ?? 0;
      const jlRemaining = round2(impact.amount - jlAlloc);
      if (jlRemaining <= 0.004) continue;

      const reasons: string[] = [];
      let score = 0;
      const alloc = round2(Math.min(bankRemaining, jlRemaining));

      if (Math.abs(impact.amount - bank.amount) <= 0.004) {
        score += 50;
        reasons.push("Exact amount");
      } else if (Math.abs(alloc - bankRemaining) <= 0.004) {
        score += 30;
        reasons.push("Fills remaining bank amount");
      } else {
        continue;
      }

      score += 30;
      reasons.push("Direction matches");

      if (bank.transactionDate && jl.entryDate === bank.transactionDate) {
        score += 20;
        reasons.push("Same date");
      } else if (
        bank.transactionDate &&
        Math.abs(
          new Date(jl.entryDate).getTime() -
            new Date(bank.transactionDate).getTime(),
        ) <=
          3 * 86400000
      ) {
        score += 5;
        reasons.push("Date within 3 days");
      }

      const desc = bank.description.toLowerCase();
      const memo = (jl.memo ?? "").toLowerCase();
      if (desc && memo && (desc.includes(memo) || memo.includes(desc))) {
        score += 10;
        reasons.push("Description similarity");
      }

      if (score >= 80) {
        suggestions.push({
          importLineId: bank.id,
          journalLineId: jl.journalLineId,
          allocatedAmount: alloc,
          score,
          reasons,
        });
      }
    }
  }

  return suggestions.sort((a, b) => b.score - a.score);
}

export function assessMatchDirection(args: {
  bankDirection: "deposit" | "withdrawal";
  journalDebit: number;
  journalCredit: number;
}): { ok: true } | { ok: false; error: string } {
  const impact = journalBankImpact({
    debit: args.journalDebit,
    credit: args.journalCredit,
  });
  if (!impact.ok) return impact;
  if (args.bankDirection === "deposit" && impact.side !== "debit") {
    return {
      ok: false,
      error: "Bank deposit must match a bank-account debit (inflow).",
    };
  }
  if (args.bankDirection === "withdrawal" && impact.side !== "credit") {
    return {
      ok: false,
      error: "Bank withdrawal must match a bank-account credit (outflow).",
    };
  }
  return { ok: true };
}

export function assessMatchAllocation(args: {
  bankLineAmount: number;
  bankAlreadyAllocated: number;
  journalAvailable: number;
  journalAlreadyAllocated: number;
  proposed: number;
}): { ok: true } | { ok: false; error: string } {
  const p = round2(args.proposed);
  if (p <= 0) return { ok: false, error: "Allocation must be positive." };
  if (round2(args.bankAlreadyAllocated + p) > round2(args.bankLineAmount) + 0.0001) {
    return { ok: false, error: "Bank line overallocation." };
  }
  if (round2(args.journalAlreadyAllocated + p) > round2(args.journalAvailable) + 0.0001) {
    return { ok: false, error: "Journal line overallocation." };
  }
  return { ok: true };
}

export function assessIdempotencyContext(args: {
  existing: Record<string, unknown>;
  expected: Record<string, unknown>;
}): { ok: true; duplicate: true } | { ok: false; error: string } {
  for (const [k, v] of Object.entries(args.expected)) {
    if (args.existing[k] !== v) {
      return {
        ok: false,
        error: "Idempotency key already used with a different context.",
      };
    }
  }
  return { ok: true, duplicate: true };
}

export function assessCreateReconciliationIdempotency(args: {
  existing: {
    accountId: string;
    statementStart: string;
    statementEnd: string;
    openingBalance: number;
    endingBalance: number;
  };
  expected: {
    accountId: string;
    statementStart: string;
    statementEnd: string;
    openingBalance: number;
    endingBalance: number;
  };
}): { ok: true; duplicate: true } | { ok: false; error: string } {
  return assessIdempotencyContext({
    existing: args.existing as unknown as Record<string, unknown>,
    expected: args.expected as unknown as Record<string, unknown>,
  });
}

/** Parse mapped CSV rows client-side before RPC (decimal-safe strings). */
export function mapCsvRowsToImportPayload(args: {
  headers: string[];
  rows: string[][];
  mapping: {
    date: string;
    description?: string;
    amount?: string;
    debit?: string;
    credit?: string;
    reference?: string;
  };
}):
  | {
      ok: true;
      rows: {
        date: string;
        description: string;
        amount: string;
        sourceRef: string;
      }[];
    }
  | { ok: false; error: string } {
  const col = (name: string | undefined) =>
    name ? args.headers.indexOf(name) : -1;
  const dateCol = col(args.mapping.date);
  if (dateCol < 0) return { ok: false, error: "Date column is required." };

  const descCol = col(args.mapping.description);
  const amountCol = col(args.mapping.amount);
  const debitCol = col(args.mapping.debit);
  const creditCol = col(args.mapping.credit);
  const refCol = col(args.mapping.reference);

  if (amountCol < 0 && (debitCol < 0 || creditCol < 0)) {
    return { ok: false, error: "Map either Amount or Debit/Credit columns." };
  }

  const out: {
    date: string;
    description: string;
    amount: string;
    sourceRef: string;
  }[] = [];

  for (let i = 0; i < args.rows.length; i++) {
    const row = args.rows[i]!;
    const date = (row[dateCol] ?? "").trim();
    if (!date) continue;
    const description = descCol >= 0 ? (row[descCol] ?? "").trim() : "";
    const reference = refCol >= 0 ? (row[refCol] ?? "").trim() : String(i + 1);

    let amountStr = "";
    if (amountCol >= 0) {
      amountStr = (row[amountCol] ?? "").trim().replace(/[$,]/g, "");
    } else {
      const debit = parseMoneyString(row[debitCol] ?? "");
      const credit = parseMoneyString(row[creditCol] ?? "");
      if (debit > 0 && credit > 0) continue;
      const net = debit > 0 ? debit : -credit;
      amountStr = net.toFixed(2);
    }
    if (!amountStr) continue;
    out.push({
      date,
      description,
      amount: amountStr,
      sourceRef: reference || String(i + 1),
    });
  }

  if (out.length === 0) return { ok: false, error: "No importable rows found." };
  if (out.length > 5000) {
    return { ok: false, error: "Import exceeds maximum of 5000 rows." };
  }
  return { ok: true, rows: out };
}

function parseMoneyString(raw: string): number {
  const cleaned = raw.trim().replace(/[$,]/g, "");
  if (!cleaned) return 0;
  const neg = cleaned.startsWith("(") && cleaned.endsWith(")");
  const n = Number(neg ? `-${cleaned.slice(1, -1)}` : cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsvPreview(text: string, maxRows = 8): {
  headers: string[];
  rows: string[][];
} {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]!);
  const rows = lines.slice(1, 1 + maxRows).map(splitCsvLine);
  return { headers, rows };
}
