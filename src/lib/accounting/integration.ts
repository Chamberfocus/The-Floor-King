/**
 * F4 canonical financial-event → accounting orchestration (pure decision layer).
 * DB posting/outbox are invoked by callers; this module never guesses ambiguous events.
 */
import type { BuiltJournalEntry } from "@/lib/accounting/types";
import {
  ACCOUNTING_FAILURE,
  assessAccountingGate,
  classifyAtomicity,
  type AccountingEventKind,
  type AccountingPostStatus,
  type AtomicityClass,
  type EventFlagSettings,
} from "@/lib/accounting/event-status";
import { outboxIdempotencyKey } from "@/lib/accounting/outbox-policy";

export interface AccountingIntegrationPlan {
  kind: AccountingEventKind;
  atomicity: AtomicityClass;
  action:
    | "skip_disabled"
    | "skip_legacy"
    | "skip_unsupported"
    | "not_guaranteed"
    | "post_atomic"
    | "enqueue_outbox"
    | "review_required";
  status: AccountingPostStatus;
  idempotencyKey: string;
  message?: string;
  code?: string;
  /** True only when classifyAtomicity === fully_atomic AND action is post_atomic. */
  fullyAtomicVerified: boolean;
}

export function planAccountingIntegration(args: {
  kind: AccountingEventKind;
  sourceType: string;
  sourceId: string;
  entryDate: string;
  flags: EventFlagSettings;
  reviewRequired?: boolean;
  unsupported?: boolean;
}): AccountingIntegrationPlan {
  const key = outboxIdempotencyKey(args.sourceType, args.sourceId, args.kind);
  const atomicity = classifyAtomicity(args.kind);

  if (args.unsupported || atomicity === "unsupported_ambiguous") {
    return {
      kind: args.kind,
      atomicity,
      action: "skip_unsupported",
      status: "not_applicable",
      idempotencyKey: key,
      message: "Event type is ambiguous or unsupported for automatic posting.",
      fullyAtomicVerified: false,
    };
  }

  if (args.reviewRequired) {
    return {
      kind: args.kind,
      atomicity,
      action: "review_required",
      status: "review_required",
      idempotencyKey: key,
      message: "Accounting review required before posting.",
      fullyAtomicVerified: false,
    };
  }

  const gate = assessAccountingGate({
    kind: args.kind,
    flags: args.flags,
    entryDate: args.entryDate,
  });
  if (!gate.ok) {
    return {
      kind: args.kind,
      atomicity,
      action:
        gate.status === "legacy_pre_cutover" ? "skip_legacy" : "skip_disabled",
      status: gate.status,
      idempotencyKey: key,
      message: gate.message,
      code: gate.code,
      fullyAtomicVerified: false,
    };
  }

  // Honest: separate Supabase calls are NOT atomic. Refuse auto-path.
  if (atomicity === "not_yet_guaranteed") {
    return {
      kind: args.kind,
      atomicity,
      action: "not_guaranteed",
      status: "review_required",
      idempotencyKey: key,
      message:
        "Source mutation and accounting are not yet in one DB transaction. Pilot flag must stay OFF.",
      code: ACCOUNTING_FAILURE.NOT_YET_GUARANTEED,
      fullyAtomicVerified: false,
    };
  }

  if (atomicity === "outbox_guaranteed") {
    return {
      kind: args.kind,
      atomicity,
      action: "enqueue_outbox",
      status: "pending",
      idempotencyKey: key,
      fullyAtomicVerified: false,
    };
  }

  // fully_atomic (manual / opening only today)
  return {
    kind: args.kind,
    atomicity,
    action: "post_atomic",
    status: "pending",
    idempotencyKey: key,
    fullyAtomicVerified: true,
  };
}

/**
 * After operational success: never claim posted if plan says otherwise.
 * Callers must persist status / outbox / journal according to plan.action.
 *
 * When posting_enabled=false: do NOT create outbox backlog for later posting.
 */
export function assertNoSilentAccountingGap(args: {
  postingEnabled: boolean;
  plan: AccountingIntegrationPlan;
  journalPosted: boolean;
  outboxEnqueued: boolean;
  statusRecorded: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!args.postingEnabled) {
    if (args.outboxEnqueued) {
      return {
        ok: false,
        error:
          "Posting disabled must not enqueue outbox backlog for later auto-post.",
      };
    }
    if (!args.statusRecorded) {
      return {
        ok: false,
        error: "Posting disabled but accounting status was not recorded.",
      };
    }
    return { ok: true };
  }
  if (args.plan.action === "not_guaranteed") {
    if (args.journalPosted) {
      return {
        ok: false,
        error: "not_yet_guaranteed event must not auto-post journals.",
      };
    }
    if (!args.statusRecorded) {
      return { ok: false, error: "not_yet_guaranteed requires visible status." };
    }
    return { ok: true };
  }
  if (
    args.plan.action === "post_atomic" &&
    !args.journalPosted &&
    !args.outboxEnqueued
  ) {
    return {
      ok: false,
      error: "Atomic post required but no journal and no outbox were created.",
    };
  }
  if (
    args.plan.action === "enqueue_outbox" &&
    !args.outboxEnqueued &&
    !args.journalPosted
  ) {
    return {
      ok: false,
      error: "Outbox-guaranteed event missing outbox and journal.",
    };
  }
  if (!args.statusRecorded) {
    return {
      ok: false,
      error: "Accounting status must be visible on the source.",
    };
  }
  return { ok: true };
}

export type { BuiltJournalEntry };
