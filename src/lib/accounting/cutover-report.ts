/**
 * F6-P1 read-only cutover readiness report (does not activate anything).
 */
import { assessAccountingCutoverReadiness } from "@/lib/accounting/cutover-readiness";
import { assessMappingReadiness } from "@/lib/accounting/mapping-readiness";
import type { AccountMappingDict } from "@/lib/accounting/types";

export interface CutoverReadinessReportInput {
  mappings: AccountMappingDict;
  paymentMethodMappings: Record<string, string>;
  settings: {
    posting_enabled: boolean;
    books_of_record: boolean;
    cutover_date: string | null;
    opening_balances_entered: boolean;
    accountant_validated: boolean;
    backup_pitr_confirmed_at?: string | null;
  };
  counts: {
    failedOutbox: number;
    pendingCriticalOutbox: number;
    taxReviewRequired: number;
    unclassifiedDeposits: number;
    billsNeedingCategory: number;
    legacyDepositAmbiguous: number;
  };
  financials: {
    trialBalanceBalanced: boolean;
    balanceSheetBalanced: boolean;
    bankReconComplete: boolean;
  };
}

export interface CutoverReadinessReport {
  verdict: "NOT_READY" | "READY_FOR_PILOT" | "READY_FOR_CUTOVER";
  traffic: "green" | "yellow" | "red";
  blockers: string[];
  warnings: string[];
  checklist: {
    backupPitrConfirmed: boolean;
    mappingsComplete: boolean;
    openingBalancesPrepared: boolean;
    openingBalancesEntered: boolean;
    trialBalanceBalanced: boolean;
    balanceSheetBalanced: boolean;
    bankReconciliationReady: boolean;
    legacyDepositAmbiguities: number;
    postingEnabled: boolean;
    booksOfRecord: boolean;
    cutoverDateSet: boolean;
    accountantValidated: boolean;
  };
  label: "CUTOVER_READINESS_REPORT";
}

export function buildCutoverReadinessReport(
  input: CutoverReadinessReportInput,
): CutoverReadinessReport {
  const mapping = assessMappingReadiness({
    mappings: input.mappings,
    paymentMethodMappings: input.paymentMethodMappings,
  });

  const assessment = assessAccountingCutoverReadiness({
    systemMappingsComplete: mapping.systemMappingsComplete,
    paymentMethodMappingsComplete: mapping.paymentMethodMappingsComplete,
    cutoverDateSet: Boolean(input.settings.cutover_date),
    openingBalancesEntered: input.settings.opening_balances_entered,
    trialBalanceBalanced: input.financials.trialBalanceBalanced,
    balanceSheetBalanced: input.financials.balanceSheetBalanced,
    failedOutboxCount: input.counts.failedOutbox,
    pendingCriticalOutboxCount: input.counts.pendingCriticalOutbox,
    taxReviewRequiredCount: input.counts.taxReviewRequired,
    unclassifiedDepositsCount: input.counts.unclassifiedDeposits,
    billsNeedingCategoryCount: input.counts.billsNeedingCategory,
    installerAmbiguityResolved: true,
    inventoryPostingEnabled: false,
    inventoryReady: true,
    booksOfRecord: input.settings.books_of_record,
    postingEnabled: input.settings.posting_enabled,
    backupPitrConfirmedByOwner: Boolean(input.settings.backup_pitr_confirmed_at),
    accountantSignOff: input.settings.accountant_validated,
  });

  const blockers = [...mapping.blockers, ...assessment.blockers];
  if (input.counts.legacyDepositAmbiguous > 0) {
    blockers.push(
      `${input.counts.legacyDepositAmbiguous} legacy ambiguous deposit(s) require review.`,
    );
  }

  return {
    verdict:
      blockers.length > 0
        ? "NOT_READY"
        : assessment.result === "READY_FOR_CUTOVER"
          ? "READY_FOR_CUTOVER"
          : "READY_FOR_PILOT",
    traffic: blockers.length > 0 ? "red" : assessment.traffic,
    blockers,
    warnings: assessment.warnings,
    checklist: {
      backupPitrConfirmed: Boolean(input.settings.backup_pitr_confirmed_at),
      mappingsComplete: mapping.readyForPilot,
      openingBalancesPrepared: input.financials.trialBalanceBalanced,
      openingBalancesEntered: input.settings.opening_balances_entered,
      trialBalanceBalanced: input.financials.trialBalanceBalanced,
      balanceSheetBalanced: input.financials.balanceSheetBalanced,
      bankReconciliationReady: input.financials.bankReconComplete,
      legacyDepositAmbiguities: input.counts.legacyDepositAmbiguous,
      postingEnabled: input.settings.posting_enabled,
      booksOfRecord: input.settings.books_of_record,
      cutoverDateSet: Boolean(input.settings.cutover_date),
      accountantValidated: input.settings.accountant_validated,
    },
    label: "CUTOVER_READINESS_REPORT",
  };
}
