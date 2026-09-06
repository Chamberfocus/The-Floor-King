/**
 * F4 durable outbox rebuild contract (pure).
 * Workers must reconstruct journals from outbox payload + optional DB source,
 * never from request-local / React state.
 */
import type { AccountingEventKind } from "@/lib/accounting/event-status";
import type { BuiltJournalEntry, JournalLineInput } from "@/lib/accounting/types";
import { assessJournalBalance, buildReversalLines } from "@/lib/accounting/journal";
import {
  buildBillPaymentJournal,
  buildCreditApplicationJournal,
  buildPaymentJournal,
  buildRefundJournal,
} from "@/lib/accounting/builders";

export type RebuildStrategy =
  | "source_reload"
  | "immutable_outbox_snapshot";

/** Minimal immutable posting basis captured at economic event time. */
export interface AccountingOutboxSnapshot {
  schemaVersion: 1;
  eventKind: AccountingEventKind;
  /** Economic event date (YYYY-MM-DD) — NEVER processing/retry date. */
  economicEventDate: string;
  rebuildStrategy: RebuildStrategy;
  sourceType: string;
  sourceId: string;
  amount: number;
  invoiceId?: string | null;
  customerId?: string | null;
  jobId?: string | null;
  billId?: string | null;
  creditMemoId?: string | null;
  paymentMethod?: string | null;
  /** Frozen GL accounts at event time (mapping-change safety). */
  cashAccountId?: string | null;
  arAccountId?: string | null;
  liabilityAccountId?: string | null;
  apAccountId?: string | null;
  expenseAccountId?: string | null;
  /** For void/reversal events: original posted journal. */
  originalJournalEntryId?: string | null;
  originalIdempotencyKey?: string | null;
  taxReviewRequired?: boolean;
  /** Optional full frozen lines for complex / tax-aware cases. */
  frozenLines?: JournalLineInput[];
  description?: string | null;
}

export function rebuildStrategyForKind(
  kind: AccountingEventKind,
): RebuildStrategy {
  switch (kind) {
    case "payment":
    case "payment_void":
    case "credit_application":
    case "refund":
    case "refund_void":
    case "bill_payment":
      // Identity from source; GL classification frozen in snapshot.
      return "immutable_outbox_snapshot";
    default:
      return "immutable_outbox_snapshot";
  }
}

export function parseOutboxSnapshot(
  payload: unknown,
):
  | { ok: true; snapshot: AccountingOutboxSnapshot }
  | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Outbox payload missing; cannot rebuild." };
  }
  const p = payload as Record<string, unknown>;
  if (Number(p.schemaVersion) !== 1) {
    return { ok: false, error: "Unsupported outbox snapshot schemaVersion." };
  }
  if (!p.eventKind || !p.economicEventDate || !p.sourceType || !p.sourceId) {
    return {
      ok: false,
      error: "Outbox snapshot missing required identity fields.",
    };
  }
  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      eventKind: p.eventKind as AccountingEventKind,
      economicEventDate: String(p.economicEventDate),
      rebuildStrategy:
        (p.rebuildStrategy as RebuildStrategy) ?? "immutable_outbox_snapshot",
      sourceType: String(p.sourceType),
      sourceId: String(p.sourceId),
      amount: Number(p.amount) || 0,
      invoiceId: (p.invoiceId as string | null) ?? null,
      customerId: (p.customerId as string | null) ?? null,
      jobId: (p.jobId as string | null) ?? null,
      billId: (p.billId as string | null) ?? null,
      creditMemoId: (p.creditMemoId as string | null) ?? null,
      paymentMethod: (p.paymentMethod as string | null) ?? null,
      cashAccountId: (p.cashAccountId as string | null) ?? null,
      arAccountId: (p.arAccountId as string | null) ?? null,
      liabilityAccountId: (p.liabilityAccountId as string | null) ?? null,
      apAccountId: (p.apAccountId as string | null) ?? null,
      expenseAccountId: (p.expenseAccountId as string | null) ?? null,
      originalJournalEntryId:
        (p.originalJournalEntryId as string | null) ?? null,
      originalIdempotencyKey:
        (p.originalIdempotencyKey as string | null) ?? null,
      taxReviewRequired: Boolean(p.taxReviewRequired),
      frozenLines: Array.isArray(p.frozenLines)
        ? (p.frozenLines as JournalLineInput[])
        : undefined,
      description: (p.description as string | null) ?? null,
    },
  };
}

/**
 * Rebuild a balanced journal from durable snapshot alone.
 * Optional sourceReload may fill missing identity fields but must not
 * override frozen account IDs or economicEventDate.
 */
export function rebuildAccountingEventFromSnapshot(args: {
  snapshot: AccountingOutboxSnapshot;
  /** Optional authoritative amounts from DB (source reload). */
  sourceReload?: {
    amount?: number;
    invoiceId?: string | null;
    customerId?: string | null;
    jobId?: string | null;
    billId?: string | null;
    status?: string | null;
  };
  /** Original journal lines when reversing (loaded by worker from DB). */
  originalJournalLines?: JournalLineInput[];
}):
  | { ok: true; entry: BuiltJournalEntry }
  | { ok: false; code: string; error: string } {
  const snap = args.snapshot;
  if (snap.taxReviewRequired) {
    return {
      ok: false,
      code: "tax_review_required",
      error: "Tax decomposition unresolved; do not auto-post.",
    };
  }

  if (snap.frozenLines && snap.frozenLines.length >= 2) {
    const entry: BuiltJournalEntry = {
      entryDate: snap.economicEventDate,
      description:
        snap.description ??
        `${snap.eventKind} ${snap.sourceId} (frozen snapshot)`,
      sourceType: snap.sourceType,
      sourceId: snap.sourceId,
      entryKind: snap.eventKind.includes("void") ? "reversal" : "post",
      idempotencyKey: journalIdempotencyKey(snap),
      lines: snap.frozenLines,
      reversalOfId: snap.originalJournalEntryId ?? null,
    };
    const bal = assessJournalBalance(entry.lines);
    if (!bal.ok) return { ok: false, code: "unbalanced", error: bal.error };
    return { ok: true, entry };
  }

  const amount = Number(args.sourceReload?.amount ?? snap.amount);
  const invoiceId =
    args.sourceReload?.invoiceId ?? snap.invoiceId ?? undefined;
  const customerId =
    args.sourceReload?.customerId ?? snap.customerId ?? undefined;
  const jobId = args.sourceReload?.jobId ?? snap.jobId ?? undefined;
  const billId = args.sourceReload?.billId ?? snap.billId ?? undefined;

  try {
    switch (snap.eventKind) {
      case "payment": {
        if (!snap.cashAccountId || !snap.arAccountId) {
          return {
            ok: false,
            code: "missing_account_mapping",
            error: "Payment snapshot missing frozen cash/AR accounts.",
          };
        }
        if (!invoiceId) {
          return {
            ok: false,
            code: "source_missing",
            error: "Payment snapshot missing invoiceId.",
          };
        }
        const entry = buildPaymentJournal({
          paymentId: snap.sourceId,
          invoiceId,
          amount,
          entryDate: snap.economicEventDate,
          mappings: {
            cash_operating: snap.cashAccountId,
            undeposited_funds: snap.cashAccountId,
            accounts_receivable: snap.arAccountId,
          },
          cashPreference: "undeposited",
          cashAccountId: snap.cashAccountId,
          arAccountId: snap.arAccountId,
          customerId,
          jobId,
        });
        return { ok: true, entry };
      }
      case "payment_void":
      case "refund_void": {
        if (!args.originalJournalLines?.length) {
          if (snap.originalJournalEntryId) {
            return {
              ok: false,
              code: "source_missing",
              error:
                "Original journal lines required to rebuild void reversal.",
            };
          }
          return {
            ok: false,
            code: "reversal_mismatch",
            error: "No original journal to reverse for void event.",
          };
        }
        const lines = buildReversalLines(args.originalJournalLines);
        const entry: BuiltJournalEntry = {
          entryDate: snap.economicEventDate,
          description:
            snap.description ?? `Void reversal ${snap.sourceId}`,
          sourceType: snap.sourceType,
          sourceId: snap.sourceId,
          entryKind: "reversal",
          idempotencyKey: journalIdempotencyKey(snap),
          lines,
          reversalOfId: snap.originalJournalEntryId ?? null,
          reversalReason: "Operational void",
        };
        const bal = assessJournalBalance(entry.lines);
        if (!bal.ok) return { ok: false, code: "unbalanced", error: bal.error };
        return { ok: true, entry };
      }
      case "credit_application": {
        if (!snap.liabilityAccountId || !snap.arAccountId || !invoiceId) {
          return {
            ok: false,
            code: "missing_account_mapping",
            error: "Credit application snapshot incomplete.",
          };
        }
        const entry = buildCreditApplicationJournal({
          applicationId: snap.sourceId,
          amount,
          entryDate: snap.economicEventDate,
          invoiceId,
          mappings: {
            customer_credit_liability: snap.liabilityAccountId,
            accounts_receivable: snap.arAccountId,
          },
          liabilityAccountId: snap.liabilityAccountId,
          arAccountId: snap.arAccountId,
          customerId,
        });
        return { ok: true, entry };
      }
      case "refund": {
        if (!snap.liabilityAccountId || !snap.cashAccountId) {
          return {
            ok: false,
            code: "missing_account_mapping",
            error: "Refund snapshot missing frozen accounts.",
          };
        }
        const entry = buildRefundJournal({
          refundId: snap.sourceId,
          amount,
          entryDate: snap.economicEventDate,
          mappings: {
            customer_credit_liability: snap.liabilityAccountId,
            cash_operating: snap.cashAccountId,
            undeposited_funds: snap.cashAccountId,
          },
          cashPreference: "cash",
          cashAccountId: snap.cashAccountId,
          liabilityAccountId: snap.liabilityAccountId,
          customerId,
        });
        return { ok: true, entry };
      }
      case "bill_payment": {
        if (!snap.apAccountId || !snap.cashAccountId || !billId) {
          return {
            ok: false,
            code: "missing_account_mapping",
            error: "Bill payment snapshot incomplete.",
          };
        }
        const entry = buildBillPaymentJournal({
          billPaymentId: snap.sourceId,
          billId,
          amount,
          entryDate: snap.economicEventDate,
          mappings: {
            accounts_payable: snap.apAccountId,
            cash_operating: snap.cashAccountId,
            undeposited_funds: snap.cashAccountId,
          },
          cashAccountId: snap.cashAccountId,
          apAccountId: snap.apAccountId,
        });
        return { ok: true, entry };
      }
      case "bill_payment_void":
      case "invoice_void":
      case "credit_void":
      case "customer_deposit_void": {
        if (!args.originalJournalLines?.length) {
          return {
            ok: false,
            code: snap.originalJournalEntryId
              ? "source_missing"
              : "reversal_mismatch",
            error: "Original journal lines required for void rebuild.",
          };
        }
        const lines = buildReversalLines(args.originalJournalLines);
        const entry: BuiltJournalEntry = {
          entryDate: snap.economicEventDate,
          description: snap.description ?? `Void ${snap.sourceId}`,
          sourceType: snap.sourceType,
          sourceId: snap.sourceId,
          entryKind: "reversal",
          idempotencyKey: journalIdempotencyKey(snap),
          lines,
          reversalOfId: snap.originalJournalEntryId ?? null,
          reversalReason: "Operational void",
        };
        const bal = assessJournalBalance(entry.lines);
        if (!bal.ok) return { ok: false, code: "unbalanced", error: bal.error };
        return { ok: true, entry };
      }
      case "invoice_issue":
      case "credit_memo_issue":
      case "vendor_bill":
      case "direct_expense":
      case "customer_deposit":
      case "deposit_apply": {
        return {
          ok: false,
          code: "payload_invalid",
          error: `${snap.eventKind} requires frozenLines in durable snapshot.`,
        };
      }
      default:
        return {
          ok: false,
          code: "unsupported",
          error: `No durable rebuild for event kind ${snap.eventKind}.`,
        };
    }
  } catch (e) {
    return {
      ok: false,
      code: "rebuild_failed",
      error: e instanceof Error ? e.message : "Rebuild failed.",
    };
  }
}

export function journalIdempotencyKey(snap: AccountingOutboxSnapshot): string {
  switch (snap.eventKind) {
    case "payment":
      return `payment:${snap.sourceId}:post`;
    case "payment_void":
      return `payment:${snap.sourceId}:void`;
    case "credit_application":
      return `credit_application:${snap.sourceId}:post`;
    case "refund":
      return `refund:${snap.sourceId}:post`;
    case "refund_void":
      return `refund:${snap.sourceId}:void`;
    case "bill_payment":
      return `bill_payment:${snap.sourceId}:post`;
    case "bill_payment_void":
      return `bill_payment:${snap.sourceId}:void`;
    case "invoice_issue":
      return `invoice:${snap.sourceId}:issue`;
    case "invoice_void":
      return `invoice:${snap.sourceId}:void`;
    case "credit_memo_issue":
      return `credit_memo:${snap.sourceId}:issue`;
    case "credit_void":
      return `credit_memo:${snap.sourceId}:void`;
    case "vendor_bill":
      return `vendor_bill:${snap.sourceId}:post`;
    case "direct_expense":
      return `expense:${snap.sourceId}:post`;
    case "customer_deposit":
      return `customer_deposit:${snap.sourceId}:post`;
    case "customer_deposit_void":
      return `customer_deposit:${snap.sourceId}:void`;
    case "deposit_apply":
      return `deposit_application:${snap.sourceId}:post`;
    case "deposit_apply_void":
      return `deposit_application:${snap.sourceId}:void`;
    case "credit_application_void":
      return `credit_application:${snap.sourceId}:void`;
    case "invoice_write_off":
      return `invoice_write_off:${snap.sourceId}:post`;
    case "invoice_write_off_void":
      return `invoice_write_off:${snap.sourceId}:void`;
    default:
      return `outbox:${snap.sourceType}:${snap.sourceId}:${snap.eventKind}`;
  }
}

/** Build a payment snapshot at event time (immutable accounts). */
export function buildPaymentOutboxSnapshot(args: {
  paymentId: string;
  invoiceId: string;
  amount: number;
  economicEventDate: string;
  paymentMethod: string | null;
  cashAccountId: string;
  arAccountId: string;
  customerId?: string | null;
  jobId?: string | null;
}): AccountingOutboxSnapshot {
  return {
    schemaVersion: 1,
    eventKind: "payment",
    economicEventDate: args.economicEventDate,
    rebuildStrategy: "immutable_outbox_snapshot",
    sourceType: "payment",
    sourceId: args.paymentId,
    amount: args.amount,
    invoiceId: args.invoiceId,
    customerId: args.customerId ?? null,
    jobId: args.jobId ?? null,
    paymentMethod: args.paymentMethod,
    cashAccountId: args.cashAccountId,
    arAccountId: args.arAccountId,
  };
}
