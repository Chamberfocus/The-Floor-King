/**
 * F4 cutover / period-close / inventory readiness (pure).
 */
export type CutoverReadiness =
  | "NOT_READY"
  | "READY_FOR_PILOT"
  | "READY_FOR_CUTOVER";

export type ReadinessTraffic = "green" | "yellow" | "red";

export interface CutoverCheckInput {
  systemMappingsComplete: boolean;
  paymentMethodMappingsComplete: boolean;
  cutoverDateSet: boolean;
  openingBalancesEntered: boolean;
  trialBalanceBalanced: boolean;
  balanceSheetBalanced: boolean;
  failedOutboxCount: number;
  pendingCriticalOutboxCount: number;
  taxReviewRequiredCount: number;
  unclassifiedDepositsCount: number;
  billsNeedingCategoryCount: number;
  installerAmbiguityResolved: boolean;
  inventoryPostingEnabled: boolean;
  inventoryReady: boolean;
  booksOfRecord: boolean;
  postingEnabled: boolean;
  /** External owner confirmation — cannot be inferred from repo. */
  backupPitrConfirmedByOwner: boolean;
  accountantSignOff: boolean;
}

export function assessAccountingCutoverReadiness(
  input: CutoverCheckInput,
): {
  result: CutoverReadiness;
  blockers: string[];
  warnings: string[];
  traffic: ReadinessTraffic;
} {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!input.systemMappingsComplete) blockers.push("System account mappings incomplete.");
  if (!input.paymentMethodMappingsComplete) {
    blockers.push("Payment method mappings incomplete.");
  }
  if (!input.cutoverDateSet) blockers.push("Cutover date not set.");
  if (!input.openingBalancesEntered) blockers.push("Opening balances not entered.");
  if (!input.trialBalanceBalanced) blockers.push("Trial Balance unbalanced.");
  if (!input.balanceSheetBalanced) blockers.push("Balance Sheet unbalanced.");
  if (input.failedOutboxCount > 0) {
    blockers.push(`${input.failedOutboxCount} failed accounting outbox event(s).`);
  }
  if (input.pendingCriticalOutboxCount > 0) {
    blockers.push(
      `${input.pendingCriticalOutboxCount} pending critical outbox event(s).`,
    );
  }
  if (input.taxReviewRequiredCount > 0) {
    blockers.push(
      `${input.taxReviewRequiredCount} tax-review-required credit event(s).`,
    );
  }
  if (input.unclassifiedDepositsCount > 0) {
    blockers.push(
      `${input.unclassifiedDepositsCount} unclassified deposit(s).`,
    );
  }
  if (input.billsNeedingCategoryCount > 0) {
    blockers.push(
      `${input.billsNeedingCategoryCount} vendor bill(s) need accounting category.`,
    );
  }
  if (!input.installerAmbiguityResolved) {
    warnings.push(
      "Installer labor SoT: keep installer_posting_enabled=false until installer_bills-only rule is activated.",
    );
  }
  if (input.inventoryPostingEnabled && !input.inventoryReady) {
    blockers.push("Inventory posting enabled but readiness failed.");
  }
  if (!input.backupPitrConfirmedByOwner) {
    warnings.push("Backup/PITR owner confirmation still required (external).");
  }
  if (input.booksOfRecord) {
    blockers.push(
      "books_of_record is already true — unexpected during readiness evaluation.",
    );
  }

  if (blockers.length > 0) {
    return { result: "NOT_READY", blockers, warnings, traffic: "red" };
  }

  // Technical checks pass → pilot possible; cutover needs accountant sign-off
  if (!input.accountantSignOff) {
    return {
      result: "READY_FOR_PILOT",
      blockers,
      warnings: [
        ...warnings,
        "Accountant/owner sign-off required before READY_FOR_CUTOVER.",
      ],
      traffic: "yellow",
    };
  }

  if (!input.postingEnabled) {
    warnings.push("posting_enabled is still false — enable only for controlled pilot.");
  }

  return {
    result: "READY_FOR_CUTOVER",
    blockers,
    warnings,
    traffic: "green",
  };
}

export function assessPeriodCloseReadiness(args: {
  failedOutboxCount: number;
  pendingOutboxCount: number;
  trialBalanceBalanced: boolean;
  balanceSheetBalanced: boolean;
  cashReconciledOrWaived: boolean;
  taxReviewComplete: boolean;
}): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (args.failedOutboxCount > 0) blockers.push("Failed accounting events exist.");
  if (args.pendingOutboxCount > 0) blockers.push("Pending accounting events exist.");
  if (!args.trialBalanceBalanced) blockers.push("Trial Balance unbalanced.");
  if (!args.balanceSheetBalanced) blockers.push("Balance Sheet unbalanced.");
  if (!args.cashReconciledOrWaived) {
    blockers.push("Cash accounts not reconciled (or waived).");
  }
  if (!args.taxReviewComplete) blockers.push("Tax review incomplete.");
  return { ready: blockers.length === 0, blockers };
}

export type InventoryReadiness = "READY" | "NOT_READY" | "REVIEW_REQUIRED";

export function assessInventoryAccountingReadiness(args: {
  itemsHaveIdentity: boolean;
  quantitiesReliable: boolean;
  actualCostsAvailable: boolean;
  receiptDatesPresent: boolean;
  vendorBillLinksPresent: boolean;
  consumptionTracked: boolean;
  returnsAdjustmentsTracked: boolean;
  unitCostConsistent: boolean;
}): { result: InventoryReadiness; reasons: string[] } {
  const reasons: string[] = [];
  if (!args.itemsHaveIdentity) reasons.push("Item identity incomplete.");
  if (!args.quantitiesReliable) reasons.push("Quantities not reliable.");
  if (!args.actualCostsAvailable) reasons.push("Actual costs missing.");
  if (!args.receiptDatesPresent) reasons.push("Receipt dates incomplete.");
  if (!args.vendorBillLinksPresent) reasons.push("Vendor bill links incomplete.");
  if (!args.consumptionTracked) reasons.push("Consumption not fully tracked.");
  if (!args.returnsAdjustmentsTracked) {
    reasons.push("Returns/adjustments incomplete.");
  }
  if (!args.unitCostConsistent) reasons.push("Unit cost consistency failed.");

  if (reasons.length === 0) return { result: "READY", reasons };
  if (
    !args.quantitiesReliable ||
    !args.actualCostsAvailable ||
    !args.itemsHaveIdentity
  ) {
    return { result: "NOT_READY", reasons };
  }
  return { result: "REVIEW_REQUIRED", reasons };
}

export function assessBooksOfRecordForCutover(args: {
  requested: boolean;
  readiness: CutoverReadiness;
  accountantSignOff: boolean;
  openingBalancesEntered: boolean;
  cutoverDateSet: boolean;
  postingEnabled: boolean;
}): { ok: true; booksOfRecord: boolean } | { ok: false; error: string; booksOfRecord: false } {
  if (!args.requested) return { ok: true, booksOfRecord: false };
  if (args.readiness !== "READY_FOR_CUTOVER") {
    return {
      ok: false,
      error: "Cutover readiness is not READY_FOR_CUTOVER.",
      booksOfRecord: false,
    };
  }
  if (!args.accountantSignOff || !args.openingBalancesEntered || !args.cutoverDateSet) {
    return {
      ok: false,
      error: "Owner/accountant cutover prerequisites incomplete.",
      booksOfRecord: false,
    };
  }
  if (!args.postingEnabled) {
    return {
      ok: false,
      error: "posting_enabled must be true before books_of_record.",
      booksOfRecord: false,
    };
  }
  return { ok: true, booksOfRecord: true };
}
