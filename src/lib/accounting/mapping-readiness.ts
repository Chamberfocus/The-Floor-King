/**
 * F6-P1 accounting mapping readiness validator (pure).
 */
import {
  SYSTEM_ACCOUNT_KEYS,
  type AccountMappingDict,
  type SystemAccountKey,
} from "@/lib/accounting/types";
import { paymentMethodMappingsComplete, type PaymentMethodKey } from "@/lib/accounting/payment-method-map";

const REQUIRED_FOR_PILOT: SystemAccountKey[] = [
  "accounts_receivable",
  "accounts_payable",
  "sales_tax_payable",
  "cash_operating",
  "undeposited_funds",
  "customer_deposits",
  "customer_credit_liability",
  "default_sales_revenue",
  "opening_balance_equity",
  "bad_debt_expense",
];

const PAYMENT_METHODS: PaymentMethodKey[] = [
  "card",
  "cash",
  "check",
  "echeck",
  "financing",
  "link",
  "other",
];

export interface MappingReadinessResult {
  systemMappingsComplete: boolean;
  missingSystemKeys: SystemAccountKey[];
  paymentMethodMappingsComplete: boolean;
  missingPaymentMethods: string[];
  readyForPilot: boolean;
  blockers: string[];
}

export function assessMappingReadiness(args: {
  mappings: AccountMappingDict;
  paymentMethodMappings?: Record<string, string>;
}): MappingReadinessResult {
  const missingSystemKeys = REQUIRED_FOR_PILOT.filter((k) => !args.mappings[k]);
  const pm = paymentMethodMappingsComplete(
    PAYMENT_METHODS,
    args.paymentMethodMappings ?? {},
  );
  const blockers: string[] = [];
  if (missingSystemKeys.length) {
    blockers.push(
      `Missing system account mappings: ${missingSystemKeys.join(", ")}`,
    );
  }
  if (!pm.complete) {
    blockers.push(`Missing payment method mappings: ${pm.missing.join(", ")}`);
  }
  return {
    systemMappingsComplete: missingSystemKeys.length === 0,
    missingSystemKeys,
    paymentMethodMappingsComplete: pm.complete,
    missingPaymentMethods: pm.missing,
    readyForPilot: blockers.length === 0,
    blockers,
  };
}

/** All known system keys for documentation / completeness checks. */
export function allSystemAccountKeys(): readonly SystemAccountKey[] {
  return SYSTEM_ACCOUNT_KEYS;
}
