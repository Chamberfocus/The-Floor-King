/**
 * F4 vendor bill / AP category mapping (pure).
 */
import { ACCOUNTING_FAILURE } from "@/lib/accounting/event-status";
import type { AccountMappingDict, SystemAccountKey } from "@/lib/accounting/types";
import { requireMappedAccount } from "@/lib/accounting/builders";

export type BillAccountingCategory =
  | "material_purchase"
  | "installer_labor"
  | "freight"
  | "operating_expense"
  | "inventory_asset"
  | "other_mapped"
  | "review_required";

export function resolveBillDebitAccount(args: {
  category: BillAccountingCategory | null | undefined;
  mappings: AccountMappingDict;
  inventoryPostingEnabled: boolean;
}):
  | { ok: true; accountId: string; mappingKey: SystemAccountKey }
  | { ok: false; code: string; message: string; reviewRequired: boolean } {
  const cat = args.category ?? "review_required";
  if (cat === "review_required" || !args.category) {
    return {
      ok: false,
      code: ACCOUNTING_FAILURE.AP_CATEGORY_MISSING,
      message: "Vendor bill requires an accounting category before posting.",
      reviewRequired: true,
    };
  }
  const key: SystemAccountKey =
    cat === "material_purchase"
      ? "material_cogs"
      : cat === "installer_labor"
        ? "installer_labor_cogs"
        : cat === "freight"
          ? "default_expense"
          : cat === "inventory_asset"
            ? "inventory_asset"
            : "default_expense";
  if (cat === "inventory_asset" && !args.inventoryPostingEnabled) {
    return {
      ok: false,
      code: ACCOUNTING_FAILURE.AP_CATEGORY_MISSING,
      message: "Inventory asset bill category requires inventory posting enabled.",
      reviewRequired: true,
    };
  }
  try {
    return {
      ok: true,
      accountId: requireMappedAccount(args.mappings, key),
      mappingKey: key,
    };
  } catch (e) {
    return {
      ok: false,
      code: ACCOUNTING_FAILURE.MISSING_ACCOUNT_MAPPING,
      message: e instanceof Error ? e.message : "Missing mapping",
      reviewRequired: true,
    };
  }
}

/** Installer SoT: only installer_bills may post labor AP when enabled. */
export function installerAccountingSourceOfTruth(): "installer_bills" {
  return "installer_bills";
}

export function jobLaborMayAutoPost(): false {
  return false;
}
