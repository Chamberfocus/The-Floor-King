/**
 * Deterministic deposit → invoice application (pure).
 *
 * Precedence for a target invoice:
 * 1. deposits whose job_id matches the invoice job
 * 2. deposits whose estimate_id matches (and job is unset or matches)
 * 3. customer-level deposits (job_id and estimate_id both null)
 *
 * Never apply a deposit tagged to a different job.
 * Oldest received_on, then id, wins within a tier.
 * Unapplied remainder after a capped apply stays on the deposit.
 */
export type DepositApplyCandidate = {
  id: string;
  customerId: string;
  jobId: string | null;
  estimateId: string | null;
  amount: number;
  unapplied: number;
  receivedOn: string;
  status: string;
};

export function depositEligibleForInvoice(args: {
  deposit: Pick<DepositApplyCandidate, "status" | "jobId" | "estimateId" | "unapplied">;
  invoiceJobId: string | null;
  invoiceEstimateId: string | null;
}): boolean {
  if (args.deposit.status !== "unapplied") return false;
  if (args.deposit.unapplied <= 0.005) return false;
  if (args.deposit.jobId) {
    return !!args.invoiceJobId && args.deposit.jobId === args.invoiceJobId;
  }
  if (args.deposit.estimateId) {
    return (
      !!args.invoiceEstimateId &&
      args.deposit.estimateId === args.invoiceEstimateId
    );
  }
  return true;
}

function tier(d: DepositApplyCandidate, invoiceJobId: string | null): number {
  if (invoiceJobId && d.jobId === invoiceJobId) return 0;
  if (d.estimateId) return 1;
  return 2;
}

export function orderDepositsForApply(
  deposits: DepositApplyCandidate[],
  invoice: { jobId: string | null; estimateId: string | null },
): DepositApplyCandidate[] {
  return deposits
    .filter((d) =>
      depositEligibleForInvoice({
        deposit: d,
        invoiceJobId: invoice.jobId,
        invoiceEstimateId: invoice.estimateId,
      }),
    )
    .sort((a, b) => {
      const ta = tier(a, invoice.jobId);
      const tb = tier(b, invoice.jobId);
      if (ta !== tb) return ta - tb;
      if (a.receivedOn !== b.receivedOn) {
        return a.receivedOn.localeCompare(b.receivedOn);
      }
      return a.id.localeCompare(b.id);
    });
}

export function depositApplyIdempotencyKey(
  depositId: string,
  invoiceId: string,
): string {
  return `auto-deposit-apply:${depositId}:${invoiceId}`;
}

export type DepositApplyPlanStep = {
  depositId: string;
  amount: number;
  idempotencyKey: string;
};

/**
 * Plan applications against current open AR. Caps each step so due never
 * goes negative. Excess deposit stays unapplied (caller does not create
 * a payment overage).
 */
export function planDepositApplications(args: {
  invoiceId: string;
  openAr: number;
  deposits: DepositApplyCandidate[];
  invoiceJobId: string | null;
  invoiceEstimateId: string | null;
}): { steps: DepositApplyPlanStep[]; remainingDue: number; leftoverUnapplied: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  let due = round2(Math.max(0, args.openAr));
  const steps: DepositApplyPlanStep[] = [];
  let leftover = 0;
  const ordered = orderDepositsForApply(args.deposits, {
    jobId: args.invoiceJobId,
    estimateId: args.invoiceEstimateId,
  });
  for (const d of ordered) {
    leftover = round2(leftover + d.unapplied);
    if (due <= 0.005) continue;
    const apply = round2(Math.min(d.unapplied, due));
    if (apply <= 0.005) continue;
    steps.push({
      depositId: d.id,
      amount: apply,
      idempotencyKey: depositApplyIdempotencyKey(d.id, args.invoiceId),
    });
    due = round2(due - apply);
    leftover = round2(leftover - apply);
  }
  return {
    steps,
    remainingDue: due,
    leftoverUnapplied: leftover,
  };
}
