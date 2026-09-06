/**
 * F4 payment-method → cash account mapping (pure).
 */
import { ACCOUNTING_FAILURE } from "@/lib/accounting/event-status";

export type PaymentMethodKey =
  | "card"
  | "cash"
  | "check"
  | "echeck"
  | "financing"
  | "link"
  | "other";

export function resolvePaymentCashAccount(args: {
  method: string | null | undefined;
  mappings: Record<string, string>;
  fallbackUndepositedId?: string | null;
}):
  | { ok: true; accountId: string }
  | { ok: false; code: string; message: string } {
  const method = (args.method ?? "other").toLowerCase();
  const mapped = args.mappings[method];
  if (mapped) return { ok: true, accountId: mapped };
  if (args.fallbackUndepositedId) {
    return { ok: true, accountId: args.fallbackUndepositedId };
  }
  return {
    ok: false,
    code: ACCOUNTING_FAILURE.MISSING_PAYMENT_METHOD_MAPPING,
    message: `No accounting mapping for payment method "${method}".`,
  };
}

export function paymentMethodMappingsComplete(
  methods: PaymentMethodKey[],
  mappings: Record<string, string>,
): { complete: boolean; missing: string[] } {
  const missing = methods.filter((m) => !mappings[m]);
  return { complete: missing.length === 0, missing };
}
