/**
 * Payment void must go through void_invoice_payment_safe.
 * A missing function must not flip the payment row to void.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_VOID_RPC_REQUIRED_MESSAGE,
  paymentVoidRpcUnavailable,
} from "@/lib/payment-safety";

const actions = readFileSync("src/app/(app)/invoices/actions.ts", "utf8");

function voidPaymentSource(): string {
  const start = actions.indexOf("export async function voidPayment");
  const end = actions.indexOf("export async function deletePayment");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return actions.slice(start, end);
}

describe("payment void fail-closed", () => {
  it("recognizes a missing safe void function", () => {
    expect(
      paymentVoidRpcUnavailable(
        "Could not find the function public.void_invoice_payment_safe(uuid, uuid, text) in the schema cache",
      ),
    ).toBe(true);
    expect(paymentVoidRpcUnavailable("Cannot void an invoice with active payments.")).toBe(
      false,
    );
    expect(paymentVoidRpcUnavailable(null)).toBe(false);
    expect(PAYMENT_VOID_RPC_REQUIRED_MESSAGE).toContain("was not changed");
  });

  it("does not update the payment row when the safe function is missing", () => {
    const body = voidPaymentSource();
    expect(body).toContain("void_invoice_payment_safe");
    expect(body).toContain("paymentVoidRpcUnavailable");
    expect(body).toContain("PAYMENT_VOID_RPC_REQUIRED_MESSAGE");
    expect(body).not.toMatch(/from\("payments"\)\s*\.update/);
    expect(body).not.toContain("pre-0163");
    const rpcAt = body.indexOf("void_invoice_payment_safe");
    const recomputeAt = body.indexOf("recomputeStatus");
    expect(recomputeAt).toBeGreaterThan(rpcAt);
  });
});
