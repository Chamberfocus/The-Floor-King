/**
 * F5 per-family accounting pilot readiness (pure).
 * books_of_record stays NOT_READY until external gates pass.
 */
export type PilotFamily =
  | "PAYMENTS"
  | "INVOICES"
  | "CREDITS"
  | "AP"
  | "EXPENSES"
  | "DEPOSITS"
  | "INVENTORY"
  | "INSTALLER";

export type FamilyPilotResult =
  | "NOT_READY"
  | "READY_FOR_PILOT"
  | "BLOCKED_REVIEW";

export interface FamilyPilotInput {
  sourceOutboxGuaranteed: boolean;
  lifecycleComplete: boolean;
  requiredMappingsComplete: boolean;
  reviewRequiredCount: number;
  failedOutboxCount: number;
  ambiguousCount: number;
  extraBlockers?: string[];
}

export function assessFamilyPilotReadiness(
  input: FamilyPilotInput,
): { result: FamilyPilotResult; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.sourceOutboxGuaranteed) {
    reasons.push("Source+outbox same-TX guarantee missing.");
  }
  if (!input.lifecycleComplete) {
    reasons.push("Event lifecycle incomplete (issue/void/apply/payment).");
  }
  if (!input.requiredMappingsComplete) {
    reasons.push("Required account mappings incomplete.");
  }
  if (input.reviewRequiredCount > 0) {
    reasons.push(`${input.reviewRequiredCount} review_required event(s).`);
  }
  if (input.failedOutboxCount > 0) {
    reasons.push(`${input.failedOutboxCount} failed outbox event(s).`);
  }
  if (input.ambiguousCount > 0) {
    reasons.push(`${input.ambiguousCount} ambiguous/unclassified item(s).`);
  }
  for (const b of input.extraBlockers ?? []) reasons.push(b);

  if (reasons.length > 0) {
    const blocked = reasons.some(
      (r) =>
        r.includes("review_required") ||
        r.includes("ambiguous") ||
        r.includes("guarantee missing"),
    );
    return {
      result: blocked || !input.sourceOutboxGuaranteed
        ? reasons.some((r) => r.includes("review_required") || r.includes("ambiguous"))
          ? "BLOCKED_REVIEW"
          : "NOT_READY"
        : "NOT_READY",
      reasons,
    };
  }
  return { result: "READY_FOR_PILOT", reasons: [] };
}

export interface AccountingPilotBoardInput {
  payments: FamilyPilotInput;
  invoices: FamilyPilotInput;
  credits: FamilyPilotInput;
  ap: FamilyPilotInput;
  expenses: FamilyPilotInput;
  deposits: FamilyPilotInput;
  inventory: FamilyPilotInput;
  installer: FamilyPilotInput;
  openingBalancesEntered: boolean;
  cutoverDateSet: boolean;
  backupPitrConfirmedByOwner: boolean;
  accountantValidated: boolean;
  booksOfRecord: boolean;
}

export function assessAccountingPilotReadiness(input: AccountingPilotBoardInput): {
  families: Record<
    PilotFamily,
    { result: FamilyPilotResult; reasons: string[] }
  >;
  booksOfRecordReady: false;
  globalBlockers: string[];
} {
  const families = {
    PAYMENTS: assessFamilyPilotReadiness(input.payments),
    INVOICES: assessFamilyPilotReadiness(input.invoices),
    CREDITS: assessFamilyPilotReadiness(input.credits),
    AP: assessFamilyPilotReadiness(input.ap),
    EXPENSES: assessFamilyPilotReadiness(input.expenses),
    DEPOSITS: assessFamilyPilotReadiness(input.deposits),
    INVENTORY: assessFamilyPilotReadiness(input.inventory),
    INSTALLER: assessFamilyPilotReadiness(input.installer),
  } as const;

  const globalBlockers: string[] = [];
  if (!input.openingBalancesEntered) {
    globalBlockers.push("Opening balances not entered.");
  }
  if (!input.cutoverDateSet) globalBlockers.push("Cutover date not set.");
  if (!input.backupPitrConfirmedByOwner) {
    globalBlockers.push("Backup/PITR not confirmed by owner.");
  }
  if (!input.accountantValidated) {
    globalBlockers.push("Accountant validation not recorded.");
  }
  if (input.booksOfRecord) {
    globalBlockers.push("books_of_record unexpectedly true.");
  }

  return {
    families: { ...families },
    booksOfRecordReady: false,
    globalBlockers,
  };
}

/** Recommended eventual pilot order based on risk (not an activation). */
export function recommendedPilotSequence(families: {
  PAYMENTS: FamilyPilotResult;
  CREDITS: FamilyPilotResult;
  INVOICES: FamilyPilotResult;
  EXPENSES: FamilyPilotResult;
  AP: FamilyPilotResult;
  DEPOSITS: FamilyPilotResult;
  INSTALLER: FamilyPilotResult;
  INVENTORY: FamilyPilotResult;
}): PilotFamily[] {
  const order: PilotFamily[] = [
    "PAYMENTS",
    "CREDITS",
    "INVOICES",
    "EXPENSES",
    "AP",
    "DEPOSITS",
    "INSTALLER",
    "INVENTORY",
  ];
  return order.filter((f) => families[f] === "READY_FOR_PILOT");
}
