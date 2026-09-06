/**
 * F4 manual bank reconciliation foundation (pure).
 */
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface ReconCashLine {
  journalLineId: string;
  accountId: string;
  entryDate: string;
  debit: number;
  credit: number;
  /** Credit memos / non-cash must not appear — filter upstream. */
  isCashAccount: boolean;
}

export function listCashMovementsForRecon(args: {
  cashAccountIds: string[];
  lines: {
    journalLineId: string;
    accountId: string;
    entryDate: string;
    debit: number;
    credit: number;
    entryStatus: string;
  }[];
  startDate: string;
  endDate: string;
}): ReconCashLine[] {
  const set = new Set(args.cashAccountIds);
  return args.lines
    .filter(
      (l) =>
        l.entryStatus === "posted" &&
        set.has(l.accountId) &&
        l.entryDate >= args.startDate &&
        l.entryDate <= args.endDate,
    )
    .map((l) => ({
      journalLineId: l.journalLineId,
      accountId: l.accountId,
      entryDate: l.entryDate,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      isCashAccount: true,
    }));
}

export function computeReconciliation(args: {
  openingBalance: number;
  statementEndingBalance: number;
  lines: ReconCashLine[];
  clearedLineIds: Set<string>;
}): {
  deposits: number;
  withdrawals: number;
  clearedNet: number;
  unclearedCount: number;
  calculatedEndingBalance: number;
  difference: number;
  canComplete: boolean;
} {
  let deposits = 0;
  let withdrawals = 0;
  let unclearedCount = 0;
  for (const l of args.lines) {
    const cleared = args.clearedLineIds.has(l.journalLineId);
    if (!cleared) {
      unclearedCount += 1;
      continue;
    }
    deposits = round2(deposits + l.debit);
    withdrawals = round2(withdrawals + l.credit);
  }
  const clearedNet = round2(deposits - withdrawals);
  const calculatedEndingBalance = round2(args.openingBalance + clearedNet);
  const difference = round2(
    args.statementEndingBalance - calculatedEndingBalance,
  );
  return {
    deposits,
    withdrawals,
    clearedNet,
    unclearedCount,
    calculatedEndingBalance,
    difference,
    canComplete: Math.abs(difference) <= 0.005,
  };
}

export function assessCompleteReconciliation(difference: number): {
  ok: true;
} | { ok: false; error: string } {
  if (Math.abs(round2(difference)) > 0.005) {
    return {
      ok: false,
      error: `Cannot complete reconciliation with nonzero difference ($${round2(difference).toFixed(2)}).`,
    };
  }
  return { ok: true };
}
